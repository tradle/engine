'use strict'

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('tradle:sealwatch')
const typeforce = require('typeforce')
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
    syncInterval: typeforce.Number
  }, opts)

  const emitter = new EventEmitter()
  const myDebug = opts.name ? utils.subdebugger(debug, opts.name) : debug

  const blockchain = opts.blockchain
  const networkName = opts.networkName
  const actions = opts.actions
  // const chaintracker = opts.chaintracker
  const watchesDB = opts.watches
  const objectsDB = opts.objects
  let addrs = []

  watchesDB.list(function (err, watches) {
    if (err) return emitter.emit('error', err)
    if (watches.length) {
      addrs = watches.map(w => w.address).concat(addrs)
    }
  })

  watchesDB.follow().on('data', function (data) {
    const topic = data.value.topic
    const addr = data.value.address
    if (data.type === 'del') {
      addrs = addrs.filter(existing => addr !== existing)
    } else {
      if (topic === 'newwatch') {
        addrs.push(addr)
      }
    }
  })

  // const objects = opts.dbs.objects
  // const seals = opts.dbs.seals
  // chaintracker.on('txs', function (txInfos) {
  //   async.each(txInfos, processTx, function (err) {
  //     if (err) debug('failed to process incoming txs', err)
  //   })
  // })

  let interval
  emitter.stop = function stop () {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  }

  emitter.start = function start () {
    if (!interval) {
      interval = setInterval(() => emitter.sync(), opts.syncInterval)
    }
  }

  let syncing
  emitter.sync = function (cb) {
    if (syncing) emitter.once('sync', cb)
    else sync(cb)
  }

  return emitter

  function sync (cb) {
    myDebug('syncing', addrs.join(', '))
    syncing = true
    blockchain.addresses.transactions(addrs, function (err, txInfos) {
      syncing = false
      if (err) return cb(err)

      txInfos = txInfos.map(function (info) {
        return utils.parseTx(info, networkName)
      })

      async.each(txInfos, processTx, function (err) {
        if (cb) return cb(err)

        emitter.emit('sync', txInfos)
      })
    })
  }

  function maybeEmitErr (err) {
    if (err) emitter.emit('error', err)
  }

  function processTx (txInfo, cb) {
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

      const data = {
        [linkProp]: watch.link,
        [addressProp]: watch.address,
        // link: watch.link,
        basePubKey: watch.basePubKey,
        txId: txInfo.txId,
        confirmations: txInfo.confirmations,
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

    // watches.getTxWithID(txInfo.txId, function (err, tx) {
    //   if (tx) {
    //     if (tx.confirmations > MAX_CONFIRMATIONS) return cb()
    //   }

    //   // const confirmed = (txInfo.confirmations || 0) >= CONFIRMATIONS
    //   self.actions.saveTx(txInfo, cb)
    // })

  }
}
