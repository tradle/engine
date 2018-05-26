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
      if (watched.indexOf(address) === -1) {
        watched.push(value)
        if (watched.length === 1) sync()
      }

      return
    }
  })

  let stopped
  let timeout
  let batchTimeout
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

    const groupedByNetwork = utils.groupBy(watched, getChainName)
    const groups = Object
      .keys(groupedByNetwork)
      .map(id => {
        const items = groupedByNetwork[id]
        const { blockchain, networkName } = items[0]
        const chain = { blockchain, networkName }
        const { api } = getBlockchainAdapter(chain)
        if (!api) {
          myDebug(`missing blockchain adapter: "${getChainName(chain)}`)
          return
        }

        return {
          api,
          chain,
          items,
        }
      })
      .filter(group => group)

    if (!groups.length) return reschedule()

    const afterSync = () => {
      if (queued) {
        queued = false
        sync()
      } else {
        // schedule next sync
        reschedule()
      }
    }

    const processGroupResults = results => {
      const errors = results
        .filter(r => r.error)
        .map(r => r.error)

      if (errors.length) {
        myDebug('experienced errors syncing', errors.map(e => e.message).join('\n'))
      }

      const txInfos = results
        .filter(r => r.value)
        .map(r => r.value)
        // flatten
        .reduce((all, some) => all.concat(some), [])

      syncing = false
      if (txInfos.length) {
        myDebug(`synced ${txInfos.length} addresses`)
        emitter.emit('sync', txInfos)
      }
    }

    syncing = true
    async.parallel(groups.map(group => async.reflect(cb => {
      // myDebug(`syncing ${watched.join(', ')}`)
      async.waterfall([
        cb => getHeight(group.api, cb),
        (height, cb) => syncAddresses(utils.extend({ height }, group), cb),
      ], cb)
    })), function (err, results) {
      if (err) {
        myDebug('failed to sync: ' + err.message)
      } else {
        processGroupResults(results)
      }

      afterSync()
    })
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

  function syncAddresses (opts, cb) {
    const { items } = opts
    const batches = utils.chunk(items.map(item => item.address), batchSize)
    const tasks = []
    let results = []
    batches.forEach(batch => {
      tasks.push(done => {
        syncBatch(utils.extend({ batch }, opts), function (err, txInfos) {
          if (err) return done(err)

          clearTimeout(batchTimeout)
          batchTimeout = utils.timeout(() => {
            results = results.concat(txInfos)
            done()
          }, interBatchTimeout)
        })
      })
    })

    async.series(tasks, function (err) {
      if (err) return cb(err)

      cb(null, results)
    })
  }

  function syncBatch (opts, cb) {
    const { api, chain, batch, height } = opts
    myDebug(`syncing ${batch.length} addresses on ${getChainName(chain)}`)
    api.addresses.transactions(batch, function (err, txInfos) {
      if (err) return cb(err)

      txInfos.forEach(info => {
        utils.extend(info, chain)
        if (typeof info.confirmations !== 'number' && typeof info.blockHeight === 'number') {
          info.confirmations = height - info.blockHeight
        }
      })

      async.each(txInfos, processTx, function (err) {
        if (err) cb(err)
        else cb(null, txInfos)
      })
    })
  }

  // function maybeEmitErr (err) {
  //   if (err) emitter.emit('error', err)
  // }

  function processTx (txInfo, cb) {
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
