'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const collect = require('stream-collector')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const changeProcessor = require('level-change-processor')
const debug = require('debug')('tradle:db:watches')
const indexer = require('../indexer').indexers.watch
const utils = require('../utils')
const topics = require('../topics')
const types = require('../types')
const statuses = require('../status')
const reducer = require('../reducers').watch

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
    db: types.db
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
  const dbOpts = { valueEncoding: utils.defaultValueEncoding }
  const main = utils.live(subdown(db, 'm', dbOpts), processor)
  const indexDB = utils.live(subdown(db, 'x', dbOpts), processor)
  const index = indexer(main, indexDB)
  const relevantTopics = [
    topics.newwatch,
    topics.readseal
  ]

  function worker (change, cb) {
    const changeVal = change.value
    if (relevantTopics.indexOf(changeVal.topic) === -1) return cb()

    const address = changeVal.topic === topics.readseal
      ? changeVal.sealAddress || changeVal.sealPreAddress
      : changeVal.address

    index.search('address', address, { live: false }, function (err, watches) {
      if (watches.length > 1) {
        throw new Error('found multiple watches for address: ' + address)
      }

      const state = watches[0]
      const newState = reducer(state, changeVal)
      if (!newState) return cb()

      const batch = index.batch(state, newState)
      db.batch(utils.encodeBatch(batch), cb)
    })
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


  // on tx:
  //   if watch doesn't exist, ignore


  /**
   * watch an address that will seal an obj with link `link`
   * @param  {[type]} addr    [description]
   * @param  {[type]} link [description]
   * @return {[type]}         [description]
   */
  // ee.watch = function watch (addr, link) {
  // }

  let stop
  const ee = {}
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

  ee.search = index.search.bind(index)
  ee.first = index.first.bind(index)
  ee.createReadStream = main.live.createReadStream
  ee.list = function (cb) {
    collect(main.live.createReadStream({ keys: false }), cb)
  }

  ee.follow = function () {
    return main.live.createReadStream({
      live: true,
      tail: true,
      old: false
    })
  }

  return ee
}

function repeat(fn, millis) {
  fn()
  return setInterval(fn, millis)
}

function logErr (err) {
  if (err) debug(err)
}
