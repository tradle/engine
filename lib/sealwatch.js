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
 * @param {Blockchain} opts.blockchain
 * @param {string}     opts.networkName
 * @param {objectsDB}  opts.objectsDB
 * @param {Actions}    opts.actions
 * @param {Number}     opts.syncInterval
 * @param {Number}     opts.confirmedAfter
 */
module.exports = function sealwatch (opts) {
  typeforce({
    blockchain: types.blockchain,
    networkName: typeforce.String,
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
  const myDebug = opts.name ? utils.subdebugger(debug, opts.name) : debug

  const {
    blockchain,
    networkName,
    actions,
    confirmedAfter,
    batchSize=DEFAULT_BATCH_SIZE,
    interBatchTimeout=DEFAULT_INTER_BATCH_TIMEOUT,
    syncInterval=DEFAULT_SYNC_INTERVAL
  } = opts

  // const chaintracker = opts.chaintracker
  const watchesDB = opts.watches
  const objectsDB = opts.objects
  let addrs = []

  init = thunky(init)
  init()

  watchesDB.follow().on('data', function (data) {
    const addr = data.value.address
    if (data.type === 'del') {
      addrs = addrs.filter(existing => addr !== existing)
      return
    }

    const topic = data.value.topic
    if (topic === 'newwatch') {
      if (addrs.indexOf(addr) === -1) {
        addrs.push(addr)
        if (addrs.length === 1) sync()
      }
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
    watchesDB.list(function (err, watches) {
      if (err) {
        emitter.emit('error', err)
      } else if (watches.length) {
        addrs = watches.map(w => w.address).concat(addrs)
      }

      cb()
    })
  }

  function sync () {
    if (stopped) return
    if (paused || syncing) return queued = true
    if (!addrs.length) return myDebug('sync skipped, no watched addresses')

    myDebug(`syncing ${addrs.length} addresses`)
    // myDebug(`syncing ${addrs.join(', ')}`)
    syncing = true
    async.waterfall([
      getHeight,
      syncAddresses,
    ], function (err, txInfos) {
      syncing = false
      if (err) {
        myDebug('failed to sync addresses: ' + err.message)
      } else {
        emitter.emit('sync', txInfos)
      }

      if (queued) {
        queued = false
        sync()
      } else if (!stopped) {
        // schedule next sync
        clearTimeout(timeout)
        timeout = utils.timeout(sync, syncInterval)
      }
    })
  }

  function getHeight (cb) {
    const fn = typeof blockchain.info === 'function'
      ? blockchain.info.bind(blockchain)
      : blockchain.blocks.latest.bind(blockchain.blocks)

    fn(function (err, block) {
      cb(err, block && block.blockHeight)
    })
  }

  function syncAddresses (height, cb) {
    const batches = toBatches(addrs)
    const tasks = []
    let results = []
    batches.forEach(batch => {
      tasks.push(done => {
        syncBatch(batch, height, function (err, txInfos) {
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

  function toBatches (addrs) {
    const batches = []
    let copy = addrs.slice()
    while (copy.length) {
      let thisBatchSize = Math.min(copy.length, batchSize)
      batches.push(copy.slice(0, thisBatchSize))
      copy = copy.slice(thisBatchSize)
    }

    return batches
  }

  function syncBatch (batch, height, cb) {
    // resetInterval()
    blockchain.addresses.transactions(batch, function (err, txInfos) {
      if (err) return cb(err)

      const parsed = txInfos.map(function (info) {
        try {
          return utils.parseTx(info, networkName)
        } catch (err) {
          myDebug('failed to parse blockchain tx', err)
        }
      })
      .filter(txInfo => txInfo)

      parsed.forEach(info => {
        if (!info.confirmations && typeof info.blockHeight === 'number') {
          info.confirmations = height - info.blockHeight
        }
      })

      async.each(parsed, processTx, function (err) {
        if (err) cb(err)
        else cb(null, parsed)
      })
    })
  }

  // function maybeEmitErr (err) {
  //   if (err) emitter.emit('error', err)
  // }

  function processTx (txInfo, cb) {
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
      let addressProp, linkProp
      if (sealsExistingVersion) {
        addressProp = 'sealAddress'
        linkProp = 'link'
      } else {
        addressProp = 'sealPrevAddress'
        linkProp = 'prevLink'
      }

      // TODO: to avoid log-abuse, slim this down if txId is already known (on confirmations)
      const data = {
        [linkProp]: watch.link,
        [addressProp]: watch.address,
        // link: watch.link,
        basePubKey: watch.basePubKey,
        txId: txInfo.txId,
        confirmations: txInfo.confirmations || 0,
        // confirmed: txInfo.confirmations >= confirmedAfter,
        addresses: toAddrs
      }

      if (sealsExistingVersion) return actions.readSeal(data, cb)

      objectsDB.findOne('prevLink', watch.link, function (err, obj) {
        if (obj) {
          const { link } = obj
          const sealAddress = utils.sealAddress(watch.basePubKey, link, networkName)
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
