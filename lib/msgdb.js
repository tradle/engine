
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
const SealStatus = require('./status').seal
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
    db: typeforce.db,
    keeper: typeforce.Object
  }, opts)

  const db = opts.db
  const processor = changeProcessor({
    feed: opts.changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  const unsent = subdown(db, 'u1')
  LiveStream.install(unsent)

  const unsealed = subdown(db, 'u2')
  LiveStream.install(unsealed)

  const main = subdown(db, 'm')
  const byCurHash = subdown(db, 'c')
  const byRootHash = subdown(db, 'r')

  const keeper = opts.keeper
  const relevantTopics = [
    topics.msg,
    topics.seal
  ]

  function worker (data, cb) {
    const val = data.value
    if (!val[CUR_HASH] || relevantTopics.indexOf(val.topic) === -1) return cb()

    const batch = getBatch(change)
    db.get(change.key, function (err, val) {
      if (err) return cb(null, getBatch(change))

      // update value
      const updated = {
        type: change.type,
        // or: msg link + change.change is unique
        key: utils.prefixKey(main, change.msgID),
        value: extend(val, change.value)
      }

      cb(null, getBatch(updated))
    })
  }

  function getBatch (state) {
    const batch = [
      state,
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

    const msgID = state.value.msgID
    if (change.value.sendstatus === statuses.send.unsent) {
      batch.push({
        type: 'put',
        // use change.change to maintain order
        key: utils.prefixKey(unsent, change.change),
        value: msgID
      })
    }

    if (change.value.sealstatus === statuses.seal.unsealed) {
      batch.push({
        type: 'put',
        // use change.change to maintain order
        key: utils.prefixKey(unsealed, change.change),
        value: msgID
      })
    }

    return batch
  }

  function typeStream (type) {
    return pump(
      main.createReadStream({
        // gt: MSG_ID_PREFIX,
        // lt: MSG_ID_PREFIX + '\xff'
      }),
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
    get: function (link, cb) {
      utils.firstFromIndex(ixf.index, utils.hex(link), function (err, val) {
        if (err) return cb(err)

        utils.augment(val, keeper, cb)
      })
    }
  }
}

// function getPrevHash (msg) {
//   return msg[ROOT_HASH] === msg[CUR_HASH] ? null : msg[PREV_HASH] || msg[ROOT_HASH]
// }
