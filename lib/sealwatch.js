/**
 * @module sealwatch
 */

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('tradle:sealwatch')
const thunky = require('thunky')
const typeforce = require('./typeforce')
const async = require('async')
const constants = require('./constants')
const utils = require('./utils')
const types = require('./types')
const TEST = process.env.NODE_ENV === 'test'
const DEFAULT_BATCH_SIZE = Number(process.env.SEALWATCH_BATCH_SIZE) || 50
const DEFAULT_SYNC_INTERVAL = Number(process.env.SEALWATCH_SYNC_INTERVAL) || 600000 // 10 mins
const DEFAULT_INTER_BATCH_TIMEOUT = Number(process.env.SEALWATCH_BATCH_TIMEOUT) || 60000

/**
 * blockchain seal monitor
 * @alias module:sealwatch
 * @param {Object}     opts
 * @param {objectsDB}  opts.objectsDB
 * @param {Actions}    opts.actions
 * @param {Number}     opts.syncInterval
 * @param {Number}     opts.confirmedAfter
 */
module.exports = function sealwatch (opts) {
  typeforce({
    getBlockchainAdapter: typeforce.Function,
    watches: typeforce.Object,
    objects: typeforce.Object,
    actions: typeforce.Object,
    // chaintracker: typeforce.Object,
    syncInterval: typeforce.Number,
    confirmedAfter: typeforce.Number,
    batchSize: typeforce.maybe(typeforce.Number),
    interBatchTimeout: typeforce.maybe(typeforce.Number)
  }, opts)

  const emitter = new EventEmitter()
  const nodeName = opts.name
  const myDebug = nodeName ? utils.subdebugger(debug, opts.name) : debug

  const {
    getBlockchainAdapter,
    actions,
    confirmedAfter,
    batchSize=DEFAULT_BATCH_SIZE,
    interBatchTimeout=DEFAULT_INTER_BATCH_TIMEOUT,
    syncInterval=DEFAULT_SYNC_INTERVAL
  } = opts

  // const chaintracker = opts.chaintracker
  const watchesDB = opts.watches
  const objectsDB = opts.objects
  let watched = []

  init = thunky(init)
  init()

  watchesDB.follow().on('data', function (data) {
    const { type, value } = data
    const { address, blockchain, network, topic } = value
    if (!address) return

    if (type === 'del') {
      watched = watched.filter(existing => existing.address !== address)
      return
    }

    if (topic === 'newwatch') {
      if (!watched.find(existing => existing.address === address)) {
        watched.push(value)
        if (watched.length === 1) sync()
      }

      return
    }
  })

  // ensure a wait in-between calls
  const _throttled = {}
  const throttled = ({ blockchain, networkName }) => {
    const id = getChainName({ blockchain, networkName })
    if (!_throttled[id]) {
      _throttled[id] = utils.throttledQueue(interBatchTimeout)
    }

    return _throttled[id]
  }

  let stopped
  let timeout
  let syncing
  let queued
  let paused
  emitter.sync = function (cb) {
    init(() => sync())
    if (cb) {
      emitter.once('sync', txInfos => cb(null, txInfos))
    }
  }

  emitter.start = function () {
    stopped = false
    paused = false
    queued = false
    emitter.sync()
  }

  emitter.resume = function start () {
    paused = false
    if (queued) {
      queued = false
      emitter.sync()
    }
  }

  emitter.stop = function () {
    stopped = true
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  emitter.pause = function stop () {
    paused = true
  }

  emitter.manualSync = manualSync

  return emitter

  function init (cb) {
    watchesDB.list(function (err, results) {
      if (err) {
        emitter.emit('error', err)
      } else if (results.length) {
        watched = results.concat(watched)
      }

      cb()
    })
  }

  function groupSeals (items) {
    const groupedByNetwork = utils.groupBy(items, getChainName)
    return Object
      .keys(groupedByNetwork)
      .map(id => {
        const items = groupedByNetwork[id]
        const { blockchain, networkName } = items[0]
        const chain = { blockchain, networkName }
        const adapter = getBlockchainAdapter(chain)
        if (!adapter) {
          myDebug(`missing blockchain adapter: "${getChainName(chain)}`)
          return
        }

        const { api } = adapter
        return {
          api,
          chain,
          items,
        }
      })
      .filter(group => group)
  }

  function sync () {
    if (stopped) {
      myDebug('sync canceled, sealwatch already stopped')
      return
    }

    if (paused || syncing) {
      myDebug('sync postponed pending', paused ? 'resume' : 'current sync')
      return queued = true
    }

    if (!watched.length) {
      myDebug('sync skipped, no watched addresses')
      return reschedule()
    }

    syncing = true
    manualSync(watched, defaultProcessTx, function (err, results) {
      syncing = false
      if (err) {
        myDebug('failed to sync: ' + err.message)
      } else if (results && results.length) {
        const txInfos = utils.flatten(results)
        myDebug(`synced ${txInfos.length} addresses`)
        emitter.emit('sync', txInfos)
      }

      if (queued) {
        queued = false
        sync()
      } else {
        // schedule next sync
        reschedule()
      }
    })
  }

  function manualSync (items, processTx, cb) {
    const groups = groupSeals(items)
    if (!groups.length) return cb(null, [])

    const processGroupResults = (group, results, cb) => {
      const { chain, height } = group
      const { errors, values } = results
      if (errors.length) {
        myDebug('experienced errors syncing', errors.map(e => e.message).join('\n'))
      }

      const txInfos = values
        // flatten
        .reduce((all, some) => all.concat(some), [])

      txInfos.forEach(info => {
        utils.extend(info, chain)
        if (!info.confirmations && typeof info.blockHeight === 'number') {
          info.confirmations = height - info.blockHeight
        }
      })

      async.each(txInfos, processTx, function (err) {
        if (err) return cb(err)

        cb(null, txInfos)
      })
    }

    async.parallel(groups.map(group => cb => {
      const { items, chain, api } = group

      getHeight(group.api, (err, height) => {
        if (err) return cb(err)

        group.height = height

        const [haveTxId, noTxId] = utils.partition(items, item => item.txId)
          .map(items => utils.extend({}, group, { items }))

        async.parallel(async.reflectAll([
          // sync those with txIds
          done => syncTxs(haveTxId, done),
          // sync those with only known address
          done => syncAddresses(noTxId, done)
        ]), (err, results) => {
          processGroupResults(group, {
            errors: results.map(r => r.error).filter(e => e),
            values: results.map(r => r.value).filter(v => v),
          }, cb)
        })
      })
    }), cb)
  }

  function reschedule () {
    if (!stopped) {
      clearTimeout(timeout)
      timeout = utils.timeout(sync, syncInterval)
    }
  }

  function getHeight (api, cb) {
    const fn = typeof api.info === 'function'
      ? api.info.bind(api)
      : api.blocks.latest.bind(api.blocks)

    fn(function (err, block) {
      cb(err, block && block.blockHeight)
    })
  }

  function syncTxs (opts, cb) {
    const { api, items } = opts
    if (!items.length) return cb(null, [])

    const batches = utils.chunk(items.map(item => item.txId), batchSize)
    async.concat(batches, (batch, cb) => {
      throttled(opts)(() => api.transactions.get(batch, cb))
    }, (err, results) => {
      if (err) return cb(err)

      cb(null, results.filter(r => r))
    })
  }

  function syncAddresses (opts, cb) {
    const { api, chain, items } = opts
    if (!items.length) return cb(null, [])

    const batches = utils.chunk(items.map(item => item.address), batchSize)
    myDebug(`syncing ${items.length} addresses on ${getChainName(chain)}`)
    async.concat(batches, (batch, done) => {
      throttled(opts)(() => api.addresses.transactions(batch, done))
    }, cb)
  }

  // function maybeEmitErr (err) {
  //   if (err) emitter.emit('error', err)
  // }

  function defaultProcessTx (txInfo, cb) {
    const { blockchain, networkName } = txInfo
    const toAddrs = txInfo.to.addresses

    // check relevant watches
    let watch
    async.find(toAddrs, function iterator (address, done) {
      watchesDB.findOne('address', address, function (err, result) {
        watch = watch ? watch : result
        done(null, err ? null : result)
      })
    }, function (err) {
      if (err || !watch) return cb(err)

      if (watch.txId) {
        if (!txInfo.confirmations || txInfo.confirmations <= watch.confirmations) {
          return cb()
        }
      }

      const sealsExistingVersion = watch.watchType === constants.watchType.thisVersion
      let addressProp, linkProp, headerHashProp
      if (sealsExistingVersion) {
        addressProp = 'sealAddress'
        linkProp = 'link'
        headerHashProp = 'headerHash'
      } else {
        addressProp = 'sealPrevAddress'
        linkProp = 'prevLink'
        headerHashProp = 'prevHeaderHash'
      }

      // TODO: to avoid log-abuse, slim this down if txId is already known (on confirmations)
      const data = {
        blockchain,
        networkName,
        [linkProp]: watch.link,
        [addressProp]: watch.address,
        [headerHashProp]: watch.headerHash,
        // link: watch.link,
        basePubKey: watch.basePubKey,
        txId: txInfo.txId,
        confirmations: txInfo.confirmations || 0,
        // confirmed: txInfo.confirmations >= confirmedAfter,
        addresses: toAddrs
      }

      if (sealsExistingVersion) return actions.readSeal(data, cb)

      objectsDB.findOne('prevLink', watch.link, function (err, object) {
        if (object) {
          const { link, headerHash } = object
          const sealAddress = utils.sealAddress({
            basePubKey: watch.basePubKey,
            headerHash,
            network: getBlockchainAdapter({ blockchain, networkName }).network
          })

          if (toAddrs.indexOf(sealAddress) !== -1) {
            data.link = link
            data.sealAddress = sealAddress
          }

          //   debug('ignoring transaction seals only previous version: ' + )
        }

        actions.readSeal(data, cb)
      })

      // lookup seal and object to figure out if this is
      // a valid seal

      // const uid = utils.sealUID({
      //   networkName: networkName,
      //   [addressProp]: watch.address,
      //   link: watch.link
      // })

      // async.find([
      //   function lookupSeal (done) {
      //     seals.byLink(watch.link, function (err, seals) {
      //       if (err) return done()

      //       const sealed = seals.some(seal => {
      //         const sealAddrs = utils.getSealAddresses(seal)
      //         return sealAddrs.every(addr => toAddrs.indexOf(addr) !== -1)
      //       })

      //       done(null, sealed)
      //     })
      //   }
      // ], cb)

      // actions.readSeal({
      //   link: watch.link,
      //   address
      // })
    })
  }
}

const getChainName = chain => chain.blockchain + ':' + chain.networkName
