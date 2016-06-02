'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const collect = require('stream-collector')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db:watches')
const changeProcessor = require('../change-processor')
const indexer = require('feed-indexer')
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
module.exports = function createWatchesDB (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    confirmedAfter: typeforce.maybe(typeforce.Number)
  }, opts)

  const confirmedAfter = opts.confirmedAfter
  const relevantTopics = [
    topics.newwatch,
    topics.readseal,
    // topics.newobj
  ]

  const indexedDB = indexer({
    feed: opts.changes,
    db: opts.db,
    primaryKey: calcPrimaryKey,
    filter: function (val) {
      return relevantTopics.indexOf(val.topic) !== -1
    },
    reduce: function (state, change, cb) {
      // if (state && change.topic === topics.newobj) {

      // }

      if (change.confirmations > confirmedAfter) {
        // delete
        debug(`deleting watch ${watch.txId} after ${change.confirmations} confirmations`)
        cb(null, null)
      } else {
        cb(null, indexer.merge(state, change))
      }
    }

    // custom: function (change, cb) {
    //   if (change.confirmations > 10) {

    //   }
    // },
    // reduce: function (state, change, cb) {
    //   const newState = indexer.merge(state, change)
    //   // console.log('state', state)
    //   // console.log('change', change)
    //   cb(null, newState)
    // }
  })

  const indexedProps = ['address', 'link', 'watchType', 'confirmations']
  const indexes = {}
  indexedProps.forEach(prop => indexes[prop] = indexedDB.by(prop))

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

  ee.findOne = function (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  ee.find = function (prop, val, cb) {
    indexes[prop].find(val, cb)
  }

  ee.get = function (opts, cb) {
    typeforce({
      address: typeforce.String,
      link: typeforce.String
    }, opts)

    const pKey = calcPrimaryKey(opts)
    indexedDB.get(pKey, cb)
  }

  ee.exists = function (opts, cb) {
    ee.get(opts, function (err, result) {
      cb(null, !!result)
    })
  }

  ee.createReadStream = indexedDB.createReadStream
  ee.list = function (cb) {
    collect(indexedDB.createReadStream({ keys: false }), cb)
  }

  ee.follow = function () {
    return indexedDB.createReadStream({
      live: true,
      tail: true,
      old: false
    })
  }

  return ee

  function calcPrimaryKey (change) {
    let parts
    if (change.topic === topics.newwatch) {
      parts = [
        change.address,
        change.link
      ]
    } else {
      parts = [
        change.sealPrevAddress || change.sealAddress,
        change.prevLink || change.link
      ]
    }

    typeforce.arrayOf(typeforce.String, parts)
    return parts.join(indexedDB.separator)
  }
}

function repeat(fn, millis) {
  fn()
  return setInterval(fn, millis)
}

function logErr (err) {
  if (err) debug(err)
}
