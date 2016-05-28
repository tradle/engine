'use strict'

const EventEmitter = require('events').EventEmitter
const typeforce = require('typeforce')
const extend = require('xtend')
const collect = require('stream-collector')
const debug = require('debug')('tradle:db:seals')
const clone = require('xtend')
const subdown = require('subleveldown')
const changeProcessor = require('../change-processor')
const indexer = require('feed-indexer')
const utils = require('../utils')
const topics = require('../topics')
const statuses = require('../status')
const SealStatus = statuses.seal
const types = require('../types')
// const reducer = require('../reducers').seal

/**
 * consumes txs, watches and:
 * 1. monitors/updates fulfilled watches
 * 2.
 * @param  {[type]} opts [description]
 * @return {[type]}      [description]
 */
module.exports = function createSealsDB (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: types.keeper
  }, opts)

  const keeper = opts.keeper
  const syncInterval = opts.syncInterval || 10 * 60000 // 10 mins
  const relevantTopics = [
    topics.readseal,
    topics.wroteseal,
    topics.queueseal
  ]

  const primaryKey = 'uid'
  const indexedDB = indexer({
    feed: opts.changes,
    db: opts.db,
    primaryKey: primaryKey,
    filter: function (val) {
      return relevantTopics.indexOf(val.topic) !== -1
    }
  })

  const indexedProps = ['sealAddress', 'sealPrevAddress', 'link', 'txId', 'status']
  const indexes = {}
  indexedProps.forEach(prop => indexes[prop] = indexedDB.by(prop))

  const emitter = new EventEmitter()
  indexedDB.on('change', function (change, newState) {
    const event = getEvent(change)
    if (event) emitter.emit(event, newState)
  })

  // function worker (change, cb) {
  //   const val = change.value
  //   if (relevantTopics.indexOf(val.topic) === -1) return cb()

  //   const link = val.link
  //   // live === false, because otherwise we'll get a deadlock
  //   indexed.search('link', link, { live: false }, function (err, seals) {
  //     if (seals.length > 1) {
  //       throw new Error('found multiple seals for link: ' + link)
  //     }

  //     const state = seals[0]
  //     if (!state) val.uid = utils.uuid()

  //     const newState = reducer(state, val)
  //     const batch = indexed.batchForChange(state, newState)
  //     saveAndEmit(batch, newState, val, cb)
  //   })
  // }

  // TODO: generalize
  // this code is currently repeated in all dbs
  // function saveAndEmit (batch, newState, changeVal, cb) {
  //   db.batch(batch, function (err) {
  //     if (err) return cb(err)

  //     cb()

  //     let event = getEvent(changeVal)
  //     if (event) emitter.emit(event, newState)
  //   })
  // }

  function getEvent (change) {
    const topic = change.topic
    switch (topic) {
    case topics.readseal:
    case topics.wroteseal:
      return topic
    }
  }

  // function processTx (change, cb) {
  //   const txInfo = change.value
  //   const to = txInfo.to
  //   async.filter(to.addresses, function processAddr (addr) {
  //     addrDB.get(addr, function (err) {
  //       cb(null, !err)
  //     })
  //   }, function (err, newAddrs) {
  //     if (err) return debug(err)

  //     async.each(newAddrs, function checkWatch (addr, done) {
  //       watchDB.get(addr, function (err, link) {
  //         if (err) return done()


  //       })
  //     }, logErr)

  //     batch = addrDB.batch(to.map(addr => {
  //       return {
  //         key: addr,
  //         db: addrDB,
  //         value: txInfo.txId
  //       }
  //     }))
  //     .concat()


  //     batch = utils.encodeBatch(batch)
  //     db.batch(batch, cb)
  //   })
  // }

  // function processTx (change, cb) {
  //   const changeVal = change.value
  //   const uid = changeVal.uid = changeVal.txId
  //   main.get(uid, function (err, state) {
  //     const newState = reducer(state, changeVal)
  //     // watchIndexed.get(utils.sealUID)

  //     const batch = getTxBatch(state, newState)
  //     // in-elegant cross-document-type batch

  //     if (state) return saveAndEmit(batch, newState, changeVal, cb)

  //     processNewTx(newState, function (err, ops) {
  //       if (err) return cb(err)

  //       batch.push.apply(batch, ops)
  //       saveAndEmit(batch, newState, changeVal, cb)
  //     })
  //   })
  // }

  // function processNewTx (state, cb) {
  //   const txAddrs = state.to.addresses

  //   function getSealChecker (addr, done) {
  //     return function sealChecker (err, seal) {
  //       if (!seal) return done(err)

  //       var sealAddrs = utils.getSealAddresses(seal)
  //       var sealed = sealAddrs.every(addr => txAddrs.indexOf(addr) !== -1)
  //       if (!sealed) return done()

  //       // actions.readSeal({
  //       //   link,
  //       //   sealAddress: addr,
  //       //   txId: state.txId
  //       // }, done)
  //     }
  //   }

  //   function getWatchChecker (addr, done) {
  //     return function watchChecker (err, watch) {
  //       if (!watch) return done(err)

  //       // const link = watch.link
  //       // actions.readSeal({
  //       //   link,
  //       //   sealAddress: addr,
  //       //   txId: state.txId
  //       // }, done)
  //     }
  //   }

  //   // update existing watches and seals
  //   async.find(txAddrs, function (addr, done) {
  //     async.series([
  //       function getSeal (done) {
  //         firstFromIndex(sealIndex, 'sealAddress', addr, getSealChecker(addr, done))
  //       },
  //       function getSealPrev (done) {
  //         firstFromIndex(sealIndex, 'sealPrevAddress', addr, getSealChecker(addr, done))
  //       },
  //       function getWatch (done) {
  //         firstFromIndex(watchIndex, 'address', addr, getWatchChecker(addr, done))
  //       }
  //     ], function (err, results) {
  //       // should never happen
  //       if (err) {
  //         debug('experience unexpected error:', err.stack, err.message)
  //         return cb(err)
  //       }

  //       done()
  //     })
  //   }, function (err, results) {

  //   })

  //   saveAndEmit(batch, newState, changeVal, cb)
  // }

  /**
   * watch an address that will seal an obj with link `link`
   * @param  {[type]} addr    [description]
   * @param  {[type]} link [description]
   * @return {[type]}         [description]
   */
  // ee.watch = function watch (addr, link) {
  // }

  let stop
  emitter.start = function start () {
    if (!stop) {
      stop = watchTxs()
    }
  }

  emitter.stop = function stop () {
    if (stop) {
      stop()
      stop = null
    }
  }

  emitter.get = indexedDB.get

  // emitter.search = indexed.search.bind(indexed)
  emitter.first = function (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  emitter.pending = function () {
    return indexes.status.createReadStream(SealStatus.pending)
  }

  emitter.sealed = function (opts) {
    return indexes.status.createReadStream(SealStatus.sealed)
  }

  return emitter
}

// function logErr (err) {
//   if (err) debug(err)
// }
