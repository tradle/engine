'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const collect = require('stream-collector')
const changeProcessor = require('level-change-processor')
const debug = require('tradle:db:seals')
const indexers = require('../indexers')
const utils = require('../utils')
const topics = require('../topics')
const statuses = require('../status')
const reducer = require('../reducers').txs

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

  const db = opts.db
  const changes = opts.changes
  const processor = changeProcessor({
    feed: changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  // const addrDB = subdown(db, 'a')
  // const watchDB = subdown(db, 'w')
  // const txDB = subdown(db, 't')
  const main = utils.live(subdown(db, 'm'), processor)
  const txIndex = utils.live(subdown(db, 'x'), processor)
  const getTxsBatch = indexers.seal(main, txIndex)
  const keeper = opts.keeper
  const syncInterval = opts.syncInterval || 10 * 60000 // 10 mins

  function worker (change, cb) {
    const val = change.value
    switch (val.topic) {
    case topics.queueseal:
      return processTx(change, cb)
    case topics.wroteseal
      return processWatch(change, cb)
    case topics.readseal:
      // created by txs db
    default:
      return cb()
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

  function processTx (change, cb) {
    const changeVal = change.value
    const uid = changeVal.uid = changeVal.txId
    main.get(uid, function (err, state) {
      const newState = reducer(state, changeVal)
      // watchIndex.get(utils.sealUID)

      const batch = getTxBatch(state, newState)
      // in-elegant cross-document-type batch

      if (state) return saveAndEmit(batch, newState, changeVal, cb)

      processNewTx(newState, function (err, ops) {
        if (err) return cb(err)

        batch.push.apply(batch, ops)
        saveAndEmit(batch, newState, changeVal, cb)
      })
    })
  }

  function processNewTx (state, cb) {
    const txAddrs = state.to.addresses

    function getSealChecker (addr, done) {
      return function sealChecker (err, seal) {
        if (!seal) return done(err)

        var sealAddrs = utils.getSealAddresses(seal)
        var sealed = sealAddrs.every(addr => txAddrs.indexOf(addr) !== -1)
        if (!sealed) return done()

        // actions.readSeal({
        //   link,
        //   sealAddress: addr,
        //   txId: state.txId
        // }, done)
      }
    }

    function getWatchChecker (addr, done) {
      return function watchChecker (err, watch) {
        if (!watch) return done(err)

        // const link = watch.link
        // actions.readSeal({
        //   link,
        //   sealAddress: addr,
        //   txId: state.txId
        // }, done)
      }
    }

    // update existing watches and seals
    async.find(txAddrs, function (addr, done) {
      async.series([
        function getSeal (done) {
          firstFromIndex(sealIndex, 'sealAddress', addr, getSealChecker(addr, done))
        },
        function getSealPrev (done) {
          firstFromIndex(sealIndex, 'sealPrevAddress', addr, getSealChecker(addr, done))
        },
        function getWatch (done) {
          firstFromIndex(watchIndex, 'address', addr, getWatchChecker(addr, done))
        }
      ], function (err, results) {
        // should never happen
        if (err) {
          debug('experience unexpected error:', err.stack, err.message)
          return cb(err)
        }

        done()
      })
    }, function (err, results) {

    })

    saveAndEmit(batch, newState, changeVal, cb)
  }

  /**
   * watch an address that will seal an obj with link `link`
   * @param  {[type]} addr    [description]
   * @param  {[type]} link [description]
   * @return {[type]}         [description]
   */
  // ee.watch = function watch (addr, link) {
  // }

  let stop
  ee.start = function start () {
    if (!stop) {
      stop = watchTxs()
    }
  }

  ee.stop = function stop () {
    if (stop) {
      stop()
      stop = null
    }
  }

  ee.get = function (link, cb) {
    collect(ixf.index.createReadStream('seal', {
      lte: link, gte: link
    }), function (err, results) {
      if (err) return cb(err)

      cb(null, results[0])
    })
  }

  ee.createReadStream = function (opts) {
    return ixf.index.createReadStream(opts)
  }

  ee.getTxWithID = function getTxWithID (txId) {

  }

  streams.unsealed = function (opts) {
    return createIndexStream(main, 'sealstatus', SealStatus.pending, opts)
  }

  return ee

  function getUnseen (ixf, cb) {
    const stream = ixf.createReadStream(topics.watch, utils.eqOpts(statuses.watch.unseen))
    collect(stream, cb)
  }

  function watchTxs () {
    const interval = repeat(chaintracker.sync.bind(sync), syncInterval)
    return function () {
      clearInterval(interval)
    }
  }
}

function repeat(fn, millis) {
  fn()
  return setInterval(fn, millis)
}

function logErr (err) {
  if (err) debug(err)
}
