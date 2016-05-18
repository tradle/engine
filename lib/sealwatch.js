'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const collect = require('stream-collector')
const changeProcessor = require('level-change-processor')
const utils = require('./utils')
const topics = require('./topics')
const statuses = require('./status')
// const logbase = require('logbase').Simple
// const CONFIRMATIONS = 10

module.exports = function sealwatch (opts) {
  typeforce({
    log: types.log,
    db: types.db,
    keeper: typeforce.Object
  }, opts)

  opts.indexer = indexer
  // const db = createIndexFeed(opts)

  const db = changeProcessor({
    db: opts.db,
    log: opts.log,
    process: indexer,
    filter: relevant
  })

  const keeper = opts.keeper
  const syncInterval = opts.syncInterval || 10 * 60000 // 10 mins

  function indexer (batch, cb) {
    batch = batch.filter(relevant)
    if (!batch.length) return cb()

    async.parallel(batch.map(processor), function (err, results) {
      if (err) return cb(err)

      cb(null, utils.flatten(results))
    })
  }

  function relevant (row) {
    return row.value.topic === topics.tx
  }

  function processor (row) {
    return function (cb) {
      cb()
    }
  }

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
