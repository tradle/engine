/**
 * @module watchesDB
 */

const extend = require('xtend')
const collect = require('stream-collector')
const typeforce = require('../typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db:watches')
const indexer = require('feed-indexer')
const utils = require('../utils')
const topics = require('../topics')
const types = require('../types')
const statuses = require('../status')

/**
 * @typedef {Object} watchesDB
 */

/**
 * database for monitored addresses, bootstrapped from log
 * @alias module:watchesDB
 * @param  {Object} opts
 * @param  {Object} opts.changes            changes-feed
 * @param  {Object} opts.db                 database to use to track seals
 * @param  {Number} opts.confirmedAfter     how many confirmations to wait for before the watch is complete
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

  let closed
  opts.db.once('closing', () => closed = true)
  const indexedDB = indexer({
    feed: opts.changes,
    db: opts.db,
    primaryKey: calcPrimaryKey,
    filter: function (val) {
      return relevantTopics.indexOf(val.topic) !== -1
    },
    reduce: function (state, change, cb) {
      if (closed) return

      const changeVal = change.value
      if (state && changeVal.confirmations >= confirmedAfter) {
        // delete
        debug(`deleting watch for ${state.sealAddress} after ${changeVal.confirmations} confirmations`)
        cb(null, null)
      } else {
        cb(null, indexedDB.merge(state, change))
      }
    }

    // custom: function (change, cb) {
    //   if (change.confirmations > 10) {

    //   }
    // },
    // reduce: function (state, change, cb) {
    //   const newState = indexedDB.merge(state, change)
    //   // console.log('state', state)
    //   // console.log('change', change)
    //   cb(null, newState)
    // }
  })

  const indexedProps = ['address', 'link', 'watchType', 'confirmations', 'blockHeight']
  const indexes = {}
  indexedProps.forEach(prop => indexes[prop] = indexedDB.by(prop))

  const ee = {}

  /**
   * find the first match in the db for a given index property and value
   * @memberOf! watchesDB
   * @param  {string}          prop indexed property
   * @param  {string|Number}   val
   * @param  {Function} cb
   */
  ee.findOne = function (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  /**
   * find all matches in the db for a given index property and value
   * @memberOf watchesDB
   * @param  {string}          prop indexed property
   * @param  {string|Number}   val
   * @param  {Function} cb
   */
  ee.find = function (prop, val, cb) {
    indexes[prop].find(val, cb)
  }

  /**
   * find a watch by its primary keys
   * @memberOf watchesDB
   * @param  {Object}   opts
   * @param  {string}   opts.address
   * @param  {string}   opts.link
   * @param  {Function} cb
   */
  ee.get = function (opts, cb) {
    typeforce({
      address: typeforce.String,
      link: typeforce.String
    }, opts)

    const pKey = calcPrimaryKey(opts)
    indexedDB.get(pKey, cb)
  }

  /**
   * check if a watch exists by its primary keys
   * @memberOf watchesDB
   * @param  {Object}   opts
   * @param  {string}   opts.address
   * @param  {string}   opts.link
   * @param  {Function} cb
   */
  ee.exists = function (opts, cb) {
    ee.get(opts, function (err, result) {
      if (err && !err.notFound) {
        debug('experienced error getting watch from db', err)
        return cb(err)
      }

      cb(null, !!result)
    })
  }

  /**
   * stream stored watches
   * @memberOf watchesDB
   * @param  {Object}   opts  same as levelup.createReadStream opts
   * @param  {Function} cb
   */
  ee.createReadStream = indexedDB.createReadStream

  /**
   * get all stored watches
   * @memberOf watchesDB
   * @param  {Function} cb
   */
  ee.list = function (cb) {
    return collect(indexedDB.createReadStream({ keys: false }), cb)
  }

  /**
   * live stream of watches
   * @memberOf watchesDB
   * @return {stream}
   */
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
