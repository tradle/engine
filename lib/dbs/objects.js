
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

  const me = opts.identityInfo
  const myDebug = utils.subdebugger(debug, me.permalink.slice(0, 6))
  const emitter = new EventEmitter()
  const changes = opts.changes
  const objTopics = [
    topics.newobj,
    topics.sent,
    topics.received,
    topics.readseal,
    topics.wroteseal
  ]

  // we want to monitor each version being sent/sealed etc.
  const primaryKey = 'link'
  const indexedDB = indexer({
    feed: changes,
    db: opts.db,
    primaryKey: primaryKey,
    filter: function (val) {
      return objTopics.indexOf(val.topic) !== -1
    },
    reduce: function (state, change, cb) {
      let newState

      switch (change.topic) {
      case topics.readseal:
      case topics.wroteseal:
        newState = utils.clone(state)
        newState.sealstatus = SealStatus.sealed
        newState.txId = change.txId
        if (change.sealAddress) newState.sealAddress = change.sealAddress
        if (change.sealPrevAddress) newState.sealPrevAddress = change.sealPrevAddress
        break
      default:
        newState = indexer.merge(state, change)
        break
      }

      cb(null, newState)
    }
  })

  // maybe these props should
  const indexedProps = ['sealstatus', 'sendstatus', 'watchstatus', /*'type',*/ 'link', 'prevLink', 'permalink', 'txId']
  const indexes = {}
  indexedProps.forEach(prop => indexes[prop] = indexedDB.by(prop))

  // need this because the by('permalink') points to 'link'
  indexes.latest = indexedDB.by('latest', function (state) {
    return state.permalink + indexedDB.separator + state.permalink
  })

  // latest versions only
  indexes.type = indexedDB.by('type', function (state) {
    return state.type && state.permalink
      ? state.type + indexedDB.separator + state.permalink
      : undefined
  })

  const keeper = opts.keeper
  indexedDB.on('change', function (change, newState) {
    const event = getEvent(change)
    if (event) emitter.emit(event, newState)
  })

  function createReadStream (opts) {
    opts = opts || {}

    const pipeline = [
      indexAPIs.latest.createReadStream(opts)
      // indexAPIs.permalink.createReadStream(opts)
      // indexedDB.createReadStream(opts)//.on('data', console.log)
    ]

    if (opts.body !== false) pipeline.push(getBody(opts))

    return pump.apply(null, pipeline)
  }

  function getBody (opts) {
    return through.obj(function (data, enc, cb) {
      const val = opts.keys === false ? data : data.value
      keeper.get(val.link, function (err, body) {
        if (err) return cb(err)

        val.object = body
        cb(null, opts.keys === false ? val : data)
      })
    })
  }

  function getEvent (change) {
    switch (change.topic) {
    case topics.newobj:
      if (change.author !== me.permalink && change.type === MESSAGE_TYPE) {
        return 'message'
      }

      return
    case topics.sent:
      return 'sent'
    case topics.wroteseal:
      return 'wroteseal'
    case topics.readseal:
      return 'readseal'
    // case topics.received:
    //   return 'message'
    }
  }

  /**
   * list objects by type (convenience method)
   * @param  {String}   type
   * @param  {Function} cb
   * @return {Stream}
   */
  // function list (type, cb) {
  //   if (typeof type === 'function') {
  //     cb = type
  //     type = null
  //   }

  //   const stream = type
  //     ? indexAPIs.type.createReadStream(type)//.on('data', console.log)
  //     : createReadStream()

  //   return collect(stream, cb)
  // }

  function list (type, cb) {
    if (typeof type === 'function') {
      cb = type
      type = null
    }

    const stream = type
      ? indexes.type.createReadStream({ eq: type, keys: false })
      : indexes.latest.createReadStream({ keys: false })

    return collect(stream, cb)
  }

  Object.keys(indexes).forEach(prop => {
    const index = indexes[prop]
    const createReadStream = index.createReadStream
    index.createReadStream = function (opts) {
      opts = opts || {}
      if (typeof opts === 'string') opts = { eq: opts }

      const pipeline = [ createReadStream.call(index, opts) ]
      if (opts.body !== false) {
        pipeline.push(getBody(opts))
      }

      return pump.apply(null, pipeline)
    }
  })

  // indexedProps.concat('latest', 'type').forEach(prop => {
  //   indexAPIs[prop] = {
  //     find: indexes[prop].find,
  //     findOne: indexes[prop].findOne,
  //     createReadStream:
  //   }
  // })

  emitter.findOne = function (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  emitter.find = function (prop, val, cb) {
    indexes[prop].find(val, cb)
  }

  return utils.extend(emitter, {
    index: indexes,
    get: indexedDB.get,
    byPermalink: function (permalink, cb)  {
      indexes.latest.findOne(permalink, cb)
    },
    unsent: function (opts, cb) {
      opts.eq = SendStatus.pending
      return collect(indexes.sendstatus.createReadStream(opts), cb)
    },
    unsealed: function (opts, cb) {
      opts.eq = SealStatus.pending
      return collect(indexes.sealstatus.createReadStream(opts), cb)
    },
    createReadStream: createReadStream,
    list: list,
    messages: list.bind(null, MESSAGE_TYPE),
    conversation: function (a, b, cb) {
      throw new Error('not implemented')
    }
  })
}
