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

  let closed
  opts.db.once('closing', () => closed = true)

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
      if (needBody) return addBodyToChange(change, cb)

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

      const pipeline = [
        indexes[prop].createReadStream(opts),
        through.obj(function (data, enc, cb) {
          const value = opts.keys === false ? data : data.value
          delete value[ENTRY_PROP]
          cb(null, data)
        })
      ]

      if (opts.body) {
        pipeline.push(addBodyTransform(opts))
      }

      return pump(pipeline)
    }
  }

  function addBodyToChange (change, cb) {
    const val = change.value
    keeper.get(val.link, function (err, body) {
      if (err) return cb()

      val.object = body
      cb(null, change)
    })
  }

  function addBodyToValue (val, cb) {
    if (closed) return

    keeper.get(val.link, function (err, body) {
      if (err) return cb(err)

      val.object = body
      cb(null, val)
    })
  }

  function addBodyTransform (opts) {
    return through.obj(function (data, enc, cb) {
      const val = opts.keys === false ? data : data.value
      addBodyToValue(val, function (err) {
        if (err) return cb(err)

        cb(null, opts.keys === false ? val : data)
      })
    })
  }
}
