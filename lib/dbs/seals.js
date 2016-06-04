'use strict'

const EventEmitter = require('events').EventEmitter
const typeforce = require('typeforce')
const extend = require('xtend')
const collect = require('stream-collector')
const debug = require('debug')('tradle:db:seals')
const clone = require('xtend')
const subdown = require('subleveldown')
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

  const indexedDB = indexer({
    feed: opts.changes,
    db: opts.db,
    primaryKey: calcPrimaryKey,
    filter: function (val) {
      return relevantTopics.indexOf(val.topic) !== -1
    },
    reduce: function (state, change, cb) {
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
  indexedDB.on('change', function (change, newState) {
    const event = getEvent(change.value)
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

  function calcPrimaryKey (change) {
    // sealPrevAddress takes priority
    // that way if sealAddress is not known initially,
    // when it becomes known, the uid won't change
    const primaryKey = change.sealPrevAddress || change.sealAddress
    if (!primaryKey) throw new Error('unable to derive seal primaryKey')

    return primaryKey
    // return data.link + ':' + data.sealAddress
  }

  function getEvent (change) {
    const topic = change.topic
    switch (topic) {
    case topics.readseal:
    case topics.wroteseal:
      return topic
    }
  }

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

// function logErr (err) {
//   if (err) debug(err)
// }
