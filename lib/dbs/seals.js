/** @module sealsDB */

const EventEmitter = require('events').EventEmitter
const typeforce = require('@tradle/typeforce')
const indexer = require('feed-indexer')
const topics = require('../topics')
const statuses = require('../status')
const SealStatus = statuses.seal
const types = require('../types')

const createSealsDbOpts = typeforce.object({
  changes: types.changes,
  db: types.db,
  confirmedAfter: typeforce.Number
})

/**
 * @typedef {Object} sealsDB
 */

/**
 * blockchain seals database, bootstrapped from log
 *
 * @alias module:sealsDB
 * @param  {Object} opts
 * @param  {Object} opts.changes  changes-feed
 * @param  {Object} opts.db       database to use to track seals
 */
module.exports = function createSealsDB (opts) {
  createSealsDbOpts.assert(opts)

  const {
    confirmedAfter
  } = opts

  const relevantTopics = [
    topics.readseal,
    topics.wroteseal,
    topics.queueseal
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

      const newState = indexedDB.merge(state, change)
      delete newState.topic
      newState.uid = calcPrimaryKey(change.value)
      cb(null, newState)
    }
  })

  const indexedProps = ['sealAddress', 'sealPrevAddress', 'link', 'txId', 'status']
  const indexes = {}
  indexedProps.forEach(prop => indexes[prop] = indexedDB.by(prop))

  const emitter = new EventEmitter()
  indexedDB.on('change', function (change, newState, oldState) {
    const event = getEvent(change.value, oldState)
    if (event) {
      emitter.emit(event, newState)
    }

    if (change.value.confirmations >= confirmedAfter) {
      emitter.emit('readseal:confirmed', newState)
    }
  })

  function calcPrimaryKey (change) {
    // sealPrevAddress takes priority
    // that way if sealAddress is not known initially,
    // when it becomes known, the uid won't change
    const primaryKey = change.sealPrevAddress || change.sealAddress
    if (!primaryKey) throw new Error('unable to derive seal primaryKey')

    return primaryKey
  }

  function getEvent (change, oldState) {
    const topic = change.topic
    switch (topic) {
    case topics.readseal:
      if (oldState && oldState.confirmations != null) return
      /* fall through */
    case topics.wroteseal:
      return topic
    default:
      return
    }
  }

  emitter.get = indexedDB.get

  emitter.findOne = function (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  emitter.find = function (prop, val, cb) {
    indexes[prop].find(val, cb)
  }

  emitter.pending = function (opts) {
    opts.eq = SealStatus.pending
    return indexes.status.createReadStream(opts)
  }

  emitter.sealed = function (opts) {
    opts.eq = SealStatus.sealed
    return indexes.status.createReadStream(opts)
  }

  return emitter
}
