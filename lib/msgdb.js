
'use strict'

const extend = require('xtend/mutable')
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const LiveStream = require('level-live-stream')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const utils = require('./utils')
const assert = utils.assert
const statuses = require('./status')
const topics = require('./topics')
const types = require('./types')
const changeProcessor = require('level-change-processor')
const IDENTITY = constants.TYPES.IDENTITY
const CUR_HASH = constants.CUR_HASH
const ROOT_HASH = constants.ROOT_HASH
const MSG_ID_PREFIX = 'm!'

module.exports = function (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: typeforce.Object
  }, opts)

  const db = opts.db
  const changes = opts.changes
  const processor = changeProcessor({
    feed: changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  const unsent = subdown(db, 'u1')
  LiveStream.install(unsent)

  const unsealed = subdown(db, 'u2')
  LiveStream.install(unsealed)

  const main = subdown(db, 'm', { valueEncoding: 'json' })
  const byCurHash = subdown(db, 'c')
  const byRootHash = subdown(db, 'r')

  const keeper = opts.keeper
  const relevantTopics = [
    topics.msg,
    topics.seal
  ]

  function worker (change, cb) {
    const val = change.value
    if (!val[CUR_HASH] || relevantTopics.indexOf(val.topic) === -1) return cb()

    const batch = getBatch(change)
    main.get(val.msgID, function (err, val) {
      let state
      if (err) {
        state = change.value
      } else {
        state = extend(val, change.value)
      }

      db.batch(getBatch(state, change.change), cb)
    })
  }

  function getBatch (state, change) {
    const msgID = state.msgID
    const batch = [
      {
        type: 'put',
        key: utils.prefixKey(main, msgID),
        value: state
      }
      // facilitate lookup of latest version
      // {
      //   // put / del
      //   type: state.type,
      //   key: utils.prefixKey(byRootHash, msg[ROOT_HASH]),
      //   value: msg[CUR_HASH]
      // },
      // {
      //   type: state.type,
      //   key: utils.prefixKey(byCurHash, msg[CUR_HASH]),
      //   value: msg[CUR_HASH]
      // }
    ]

    if (state.sendstatus === statuses.send.unsent) {
      batch.push({
        type: 'put',
        // use change.change to maintain order
        key: utils.prefixKey(unsent, change),
        value: msgID
      })
    }

    if (state.sealstatus === statuses.seal.unsealed) {
      batch.push({
        type: 'put',
        // use change.change to maintain order
        key: utils.prefixKey(unsealed, change),
        value: msgID
      })
    }

    return batch
  }

  function typeStream (type) {
    return pump(
      utils.upToDateStream(main, processor),
      through.obj(function (data, enc, cb) {
        const val = data.value
        if (type && val.type !== type) {
          return cb()
        }

        keeper.getOne(val[CUR_HASH]).nodeify(cb)
      })
    )
  }

  function list (type, cb) {
    if (typeof type === 'function') {
      cb = type
      type = null
    }

    collect(typeStream(type), cb)
  }

  function liveDataStream (db) {
    return pump(
      db.liveStream({ keys: false }),
      lookupMsg(),
      getBody()
    )
  }

  function lookupMsg () {
    return through.obj(function (msgID, enc, cb) {
      main.get(msgID, cb)
    })
  }

  function getBody () {
    return through.obj(function (data, enc, cb) {
      keeper.getOne(data.object)
        .then(function (obj) {
          data.object = obj
          cb(null, data)
        }, cb)
    })
  }

  return {
    // expose for testing
    _db: db,
    unsent: function getUnsent () {
      return liveDataStream(unsent)
    },
    unsealed: function getUnsealed () {
      return liveDataStream(unsealed)
    },
    typeStream: typeStream,
    list: list,
    conversation: function (a, b, cb) {
      throw new Error('not implemented')
    }
  }
}

// function getPrevHash (msg) {
//   return msg[ROOT_HASH] === msg[CUR_HASH] ? null : msg[PREV_HASH] || msg[ROOT_HASH]
// }
