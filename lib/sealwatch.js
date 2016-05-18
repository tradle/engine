'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const collect = require('stream-collector')
const changeProcessor = require('level-change-processor')
const debug = require('tradle:sealwatch')
const utils = require('./utils')
const topics = require('./topics')
const statuses = require('./status')
// const logbase = require('logbase').Simple
// const CONFIRMATIONS = 10

module.exports = function sealwatch (opts) {
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

  const addrDB = subdown(db, 'a')
  const watchDB = subdown(db, 'w')
  const txDB = subdown(db, 't')
  const keeper = opts.keeper
  const syncInterval = opts.syncInterval || 10 * 60000 // 10 mins

  function worker (change, cb) {
    switch (change.value.topic) {
      case topics.tx:
        return processTx(change, cb)
      case topics.watch
        return processWatch(change, cb)
      default:
        return cb()
    }
  }

  function processTx (change, cb) {
    const txInfo = change.value
    const to = txInfo.to
    async.filter(to.addresses, function processAddr (addr) {
      addrDB.get(addr, function (err) {
        cb(null, !err)
      })
    }, function (err, newAddrs) {
      if (err) return debug(err)

      async.each(newAddrs, function checkWatch (addr, done) {
        watchDB.get(addr, function (err, link) {
          if (err) return done()


        })
      }, logErr)

      batch = addrDB.batch(to.map(addr => {
        return {
          key: addr,
          db: addrDB,
          value: txInfo.txId
        }
      }))
      .concat()


      batch = utils.encodeBatch(batch)
      db.batch(batch, cb)
    })
  }

  // function lookupAddress (addr, cb) {
  //   main.get(addr, function (addr) {

  //   })
  // }

  // ixf.index.on('change', function (row) {
  //   if (row.value.topic !== 'tx') return

  //   const addrs = row.value.to.addresses
  //   addrs.forEach(function (addr) {
  //     collect(ixf.index.createReadStream('sealID', {
  //       gt: `seal:${addr}`,
  //       lt: `seal:${addr}\xff`
  //     }), function (err, results) {
  //       if (err) return

  //       results.forEach(function (r) {
  //         throw new Error('not implemented')
  //       })
  //     })
  //   })
  // })

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

  // ee.sealStream = function () {

  // }

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
