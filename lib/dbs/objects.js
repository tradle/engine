
'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db')
const indexer = require('feed-indexer')
const changeProcessor = require('../change-processor')
const constants = require('../constants')
const utils = require('../utils')
const Status = require('../status')
const SealStatus = Status.seal
const SendStatus = Status.send
const topics = require('../topics')
const types = require('../types')
const reducer = require('../reducers').object
const IDENTITY = constants.TYPES.IDENTITY
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const LINK = constants.LINK
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const SEPARATOR = constants.INDEX_SEPARATOR

// messages shouldn't be stored differently form
// other objects. This will create annoying asymmetry for message/object seals

module.exports = exports = createObjectDB

function createObjectDB (opts) {
  typeforce({
    db: types.db,
    keeper: types.keeper,
    changes: types.changes,
    identityInfo: types.identityInfo
  }, opts)

  const db = opts.db
  const me = opts.identityInfo
  const emitter = new EventEmitter()
  const changes = opts.changes
  const objTopics = [
    topics.newobj,
    topics.sent,
    topics.received,
    topics.readseal,
    topics.wroteseal
  ]

  const primaryKey = 'permalink'
  const indexedDB = indexer({
    feed: changes,
    db: db,
    primaryKey: primaryKey,
    filter: function (val) {
      return objTopics.indexOf(val.topic) !== -1
    }
  })

  // maybe these props should
  const indexedProps = ['sealstatus', 'sendstatus', 'watchstatus', 'type', 'link', 'permalink']
  const indexes = {}
  indexedProps.forEach(prop => {
    indexes[prop] = indexedDB.by(prop, function reducer (state) {
      return prop in state
        ? state[prop] + indexedDB.separator + state[primaryKey]
        : undefined
    })
  })

  const keeper = opts.keeper
  indexedDB.on('change', function (change, newState) {
    const event = getEvent(change)
    if (event) emitter.emit(event, newState)
  })

  function createReadStream (opts) {
    opts = opts || {}

    const pipeline = [
      indexedDB.createReadStream(opts)
    ]

    if (opts.body !== false) pipeline.push(getBody(opts))

    return pump.apply(null, pipeline)
  }

  function getBody (opts) {
    return through.obj(function (data, enc, cb) {
      const link = opts.keys === false ? data.link : data.value.link
      keeper.get(data.value.link, function (err, body) {
        if (err) return cb(err)

        data.object = body
        cb(null, data)
      })
    })
  }

  function getEvent (change) {
    switch (change.topic) {
    case topics.newobj:
      return change.author !== me.permalink ? 'received' : null
    case topics.sent:
      return 'sent'
    case topics.wroteseal:
      return 'wroteseal'
    case topics.readseal:
      return 'readseal'
    case topics.received:
      return 'received'
    }
  }

  /**
   * list objects by type (convenience method)
   * @param  {String}   type
   * @param  {Function} cb
   * @return {Stream}
   */
  function list (type, cb) {
    if (typeof type === 'function') {
      cb = type
      type = null
    }

    let stream = type
      ? indexAPIs.type.createReadStream(type)
      : createReadStream()

    return collect(stream, cb)
  }

  const indexAPIs = {}
  indexedProps.forEach(prop => {
    indexAPIs[prop] = {
      createReadStream: function (opts) {
        const pipeline = [ indexes[prop].createReadStream(opts) ]
        if (opts.body !== false) {
          pipeline.push(getBody(opts))
        }

        return pump.apply(null, pipeline)
      }
    }
  })

  return utils.extend(emitter, {
    index: indexAPIs,
    get: indexedDB.get,
    byPermalink: indexedDB.get,
    unsent: function (opts, cb) {
      return collect(indexAPIs.sendstatus.createReadStream('pending'), cb)
    },
    unsealed: function (opts, cb) {
      return collect(indexAPIs.sealstatus.createReadStream('pending'), cb)
    },
    // messages: ,
    createReadStream: createReadStream,
    list: list,
    messages: list.bind(null, MESSAGE_TYPE),
    conversation: function (a, b, cb) {
      throw new Error('not implemented')
    }
  })
}
