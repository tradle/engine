'use strict'

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('tradle:sealwatch')
const thunky = require('thunky')
const typeforce = require('./typeforce')
const async = require('async')
const constants = require('./constants')
const utils = require('./utils')
const types = require('./types')

module.exports = function sealwatch (opts) {
  typeforce({
    blockchain: types.blockchain,
    networkName: typeforce.String,
    watches: typeforce.Object,
    objects: typeforce.Object,
    actions: typeforce.Object,
    // chaintracker: typeforce.Object,
    syncInterval: typeforce.Number,
    confirmedAfter: typeforce.Number
  }, opts)

  const emitter = new EventEmitter()
  const myDebug = opts.name ? utils.subdebugger(debug, opts.name) : debug

  const blockchain = opts.blockchain
  const networkName = opts.networkName
  const actions = opts.actions
  const confirmedAfter = opts.confirmedAfter
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
      addrs.push(addr)
      if (addrs.length === 1) sync()
    }
  })

  let interval
  let syncing
  let queued
  emitter.sync = function (cb) {
    init(() => sync())
    if (cb) {
      emitter.once('sync', txInfos => cb(null, txInfos))
    }
  }

  emitter.start =
  emitter.resume = function start () {
    if (interval) return
    emitter.sync()
    interval = setInterval(() => emitter.sync(), opts.syncInterval)
  }

  emitter.stop =
  emitter.pause = function stop () {
    if (!interval) return
    clearInterval(interval)
    interval = null
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
    if (syncing) return queued = true
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
      }
    })
  }

  function getHeight (cb) {
    blockchain.blocks.latest(function (err, block) {
      cb(err, block && block.blockHeight)
    })
  }

  function syncAddresses (height, cb) {
    blockchain.addresses.transactions(addrs, function (err, txInfos) {
      if (err) return cb(err)

      txInfos = txInfos.map(function (info) {
        return utils.parseTx(info, networkName)
      })

      txInfos.forEach(info => {
        if (!info.confirmations) {
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
    // myDebug('processing tx: ' + txInfo.txId)
    const toAddrs = txInfo.to.addresses
    const networkName = txInfo.networkName

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
        confirmations: txInfo.confirmations,
        // confirmed: txInfo.confirmations >= confirmedAfter,
        addresses: toAddrs
      }

      if (sealsExistingVersion) return actions.readSeal(data, cb)

      objectsDB.findOne('prevLink', watch.link, function (err, obj) {
        if (obj) {
          const link = obj.link
          const sealAddress = utils.sealAddress(watch.basePubKey, data.link, networkName)
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
