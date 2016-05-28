'use strict'

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('tradle:sealwatch')
const typeforce = require('typeforce')
const async = require('async')
const constants = require('./constants')
const utils = require('./utils')

module.exports = function sealwatch (opts) {
  typeforce({
    watches: typeforce.Object,
    actions: typeforce.Object,
    chaintracker: typeforce.Object,
    syncInterval: typeforce.Number
  }, opts)

  const emitter = new EventEmitter()
  const actions = opts.actions
  const chaintracker = opts.chaintracker
  const watches = opts.watches
  watches.list(function (err, watches) {
    if (err) throw err
    if (!watches.length) return

    const addrs = watches.map(w => w.address)
    chaintracker.watchAddresses(addrs, maybeEmitErr)
  })

  watches.follow().on('data', function (data) {
    if (data.type !== 'del') {
      chaintracker.watchAddresses([data.value.address], maybeEmitErr)
    }
  })

  // const objects = opts.dbs.objects
  // const seals = opts.dbs.seals
  chaintracker.on('txs', function (txInfos) {
    async.each(txInfos, processTx, function (err) {
      if (err) debug('failed to process incoming txs', err)
    })
  })

  let interval
  emitter.stop = function stop () {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  }

  emitter.start = function start () {
    interval = setInterval(chaintracker.sync, opts.syncInterval)
  }

  return emitter

  function maybeEmitErr (err) {
    if (err) emitter.emit('error', err)
  }

  function processTx (txInfo, cb) {
    const toAddrs = txInfo.to.addresses
    const networkName = txInfo.networkName

    // check relevant watches
    let watch
    async.find(toAddrs, function iterator (address, done) {
      watches.first('address', address, function (err, result) {
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

      const addressProp = watch.watchType === constants.watchType.thisVersion
        ? 'sealAddress'
        : 'sealPrevAddress'

      actions.readSeal({
        link: watch.link,
        basePubKey: watch.basePubKey,
        txId: txInfo.txId,
        confirmations: txInfo.confirmations,
        addresses: toAddrs,
        [addressProp]: watch.address,
      }, cb)

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
