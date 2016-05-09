
const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const collect = require('stream-collector')
const logs = require('./lib/logs')
const indexFeed = require('./lib/index-feed')
const utils = require('./lib/utils')
const topics = require('./lib/topics')
const statuses = require('./lib/status')
// const CONFIRMATIONS = 10

module.exports = function sealwatch (opts) {
  const ixf = opts.ixf
  const chaintracker = opts.chaintracker
  const syncInterval = opts.syncInterval || 10 * 60000 // 10 mins
  const ee = new EventEmitter()

  chaintracker.on('txs', function (txInfos) {
    ixf.db.batch(txs.map(function (txInfo) {
      // const confirmed = (txInfo.confirmations || 0) >= CONFIRMATIONS
      return {
        type: 'put',
        key: 'tx:' + txInfo.txId,
        value: extend({
          topic: 'tx',
          // confirmationstatus: confirmed ? statuses.tx.confirmed : statuses.tx.unconfirmed
        }, txInfo)
    }))
  })

  // ixf.index.add(function (row, cb) {
  //   // if (row.value.to.addresses.indexOf(addr) === -1) return

  //   cb(null, {
  //     topic: topics.watch,
  //     address: addr,
  //     txId: row.value.txId,
  //     seal: link,

  //   })

  //   process.nextTick(function () {
  //     ee.emit('seal', {
  //       txInfo: row.value,
  //       seal: link
  //     })
  //   })
  // })

  ixf.index.on('change', function (row) {
    if (row.value.topic !== 'tx') return

    const addrs = row.value.to.addresses
    addrs.forEach(function (addr) {
      collect(ixf.index.createReadStream('sealID', {
        gt: `seal:${addr}`,
        lt: `seal:${addr}\xff`
      }), function (err, results) {
        if (err) return

        results.forEach(function (r) {
          throw new Error('not implemented')
        })
      })
    })
  })

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
