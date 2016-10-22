'use strict'

/** @module simpleCustomDB */

const EventEmitter = require('events').EventEmitter
const pump = require('pump')
const through = require('through2')
const indexer = require('feed-indexer')
const typeforce = require('../typeforce')
const topics = require('../topics')
const types = require('../types')
const utils = require('../utils')
const constants = require('../constants')
const TYPE = constants.TYPE
const MESSAGE_TYPE = constants.MESSAGE_TYPE
const ENTRY_PROP = constants.ENTRY_PROP

/**
 * @typedef {Object} simpleCustomDB
 */

/**
 * blockchain seals database, bootstrapped from log
 *
 * @alias module:simpleCustomDB
 * @param  {Object} opts
 * @param  {Object} opts.changes  changes-feed
 * @param  {Object} opts.keeper   keeper
 * @param  {Object} opts.db       database to use to track message context
 */
module.exports = function simpleCustomDB (opts) {
  typeforce({
    changes: types.changes,
    keeper: types.keeper,
    db: types.db,
    props: typeforce.Array,
    getProps: typeforce.maybe(typeforce.Function),
    preprocess: typeforce.maybe(typeforce.Function),
    needBody: typeforce.maybe(typeforce.Boolean),
    primaryKey: typeforce.maybe(typeforce.String)
  }, opts)

  const keeper = opts.keeper
  const primaryKey = opts.primaryKey || 'link'
  const props = opts.props
  const getProps = opts.getProps
  const indexedDB = indexer({
    feed: opts.changes,
    db: opts.db,
    primaryKey: primaryKey,
    entryProp: ENTRY_PROP,
    preprocess: opts.preprocess || function defaultPreprocess (change, cb) {
      if (needBody) return addBody(change, cb)

      cb(null, change)
    },
    reduce: function (state, change, cb) {
      const val = change.value
      const picked = getProps ? getProps(val) : utils.pick(val, props)
      if (!Object.keys(picked).length) return cb()

      picked[primaryKey] = change.value[primaryKey]
      cb(null, picked)
    }
  })

  const indexes = {}
  const api = {}
  props.forEach(p => {
    indexes[p] = indexedDB.by(p)
    api[p] = streamer(p)
  })

  return api

  function streamer (prop) {
    return function (opts) {
      if (typeof opts === 'string') opts = { eq: opts, keys: false }

      return pump(
        indexes[prop].createReadStream(opts),
        through.obj(function (data, enc, cb) {
          const value = opts.keys === false ? data : data.value
          delete value[ENTRY_PROP]
          cb(null, data)
        })
      )
    }
  }

  function addBody (change, cb) {
    const val = change.value
    keeper.get(val.permalink, function (err, body) {
      if (err) return cb()

      val.body = body
      cb(null, change)
    })
  }
}
