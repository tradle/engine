
'use strict'

const extend = require('xtend/mutable')
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const LiveStream = require('level-live-stream')
const indexer = require('level-indexer')
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
    keeper: types.keeper
  }, opts)

  const db = opts.db
  const changes = opts.changes
  const processor = changeProcessor({
    feed: changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  const sent = liveDB(db, 'u1', { valueEncoding: 'utf8 '})
  const unsent = liveDB(db, 'u2', { valueEncoding: 'utf8 '})
  LiveStream.install(unsent)

  const sealed = liveDB(db, 'u3', { valueEncoding: 'utf8' })
  const unsealed = liveDB(db, 'u4', { valueEncoding: 'utf8' })
  LiveStream.install(unsealed)

  const main = liveDB(db, 'm', { valueEncoding: 'json' })
  const byCurHash = liveDB(db, 'c')
  const byRootHash = liveDB(db, 'r')

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
        db: main,
        key: msgID,
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

    const isSent = state.sendstatus === statuses.send.sent
    const isSealed = state.sealstatus = statuses.send.sealed

    batch.push({
      type: isSent ? 'del' : 'put',
      // use change.change to maintain order
      db: unsent,
      key: change,
      value: msgID
    })

    batch.push({
      type: isSealed ? 'del' : 'put',
      // use change.change to maintain order
      db: unsealed,
      key: change,
      value: msgID
    })

    if (isSealed) {
      batch.push({
        type: 'put',
        // use change.change to maintain order
        db: sealed,
        key: change,
        value: msgID
      })
    }

    if (isSent) {
      batch.push({
        type: 'put',
        // use change.change to maintain order
        db: sent,
        key: change,
        value: msgID
      })
    }

    return utils.encodeBatch(batch)
  }

  function typeStream (type) {
    // return createReadStream(main, { live: false })
    return pump(
      main.live.createReadStream({ live: false }),
      through.obj(function (data, enc, cb) {
        const val = data.value
        if (type && val.type !== type) {
          return cb()
        }

        keeper.get(val[CUR_HASH], cb)
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

  function createReadStream (db, opts) {
    opts = extend({
      tail: true,
      old: true,
      live: true
    }, opts)

    opts.keys = opts.values = true
    const source = db.live.createReadStream(opts)
    return pump(
      source,
      through.obj(function (data, enc, cb) {
        if (data.type === 'del') cb()
        else cb(null, db._codec.decodeValue(data.value)) // figure out how to make it store utf8
      }),
      lookupMsg(),
      getBody()
    )
  }

  function lookupMsg () {
    return through.obj(function (msgID, enc, cb) {
      main.get(msgID.toString(), cb)
    })
  }

  function getBody () {
    return through.obj(function (data, enc, cb) {
      keeper.get(data[CUR_HASH], function (err, body) {
        if (err) return cb(err)

        data.object = body
        cb(null, data)
      })
    })
  }

  function liveDB () {
    const db = subdown.apply(null, arguments)
    return utils.addLiveMethods(db, processor)
  }

  return {
    // expose for testing
    _db: db,
    unsent: unsent.live,
    unsentStream: function getUnsent (opts) {
      return createReadStream(unsent, opts)
    },
    hasSealWithID: function hasSealWithID (sealID, cb) {
      async.some([unsealed, sealed].map(db => {
        return function get () {
          db.live.get(sealID, cb)
        }
      }), cb)
    },
    sealed: sealed.live,
    unsealed: unsealed.live,
    unsealedStream: function getUnsealed (opts) {
      return createReadStream(unsealed, opts)
    },
    typeStream: typeStream,
    list: list,
    get: function get (msgID, cb) {
      processor.onLive(() => main.get(msgID, cb))
    },
    conversation: function (a, b, cb) {
      throw new Error('not implemented')
    }
  }
}

// function getPrevHash (msg) {
//   return msg[ROOT_HASH] === msg[CUR_HASH] ? null : msg[PREV_HASH] || msg[ROOT_HASH]
// }
