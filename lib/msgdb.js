
'use strict'

const extend = require('xtend/mutable')
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const utils = require('./utils')
const assert = utils.assert
const SealStatus = require('./status').seal
const topics = require('./topics')
const types = require('./types')
const createIndexFeed = require('./index-feed')
const IDENTITY = constants.TYPES.IDENTITY
const CUR_HASH = constants.CUR_HASH
const ROOT_HASH = constants.ROOT_HASH
const MSG_ID_PREFIX = 'm!'

module.exports = function (opts) {
  typeforce({
    log: types.log,
    db: typeforce.String,
    keeper: typeforce.Object,
    leveldown: types.leveldown
  }, opts)

  opts.indexer = indexer
  const db = createIndexFeed(opts)
  const keeper = opts.keeper
  const relevantTopics = [
    topics.msg,
    topics.seal
  ]

  function indexer (batch, cb) {
    batch = batch.filter(relevant)
    if (!batch.length) return cb()

    async.parallel(batch.map(processor), function (err, results) {
      if (err) return cb(err)

      cb(null, utils.flatten(results))
    })
  }

  function relevant (row) {
    const val = row.value
    return val[CUR_HASH] &&
      relevantTopics.indexOf(val.topic) !== -1
  }

  function processor (row) {
    return function (cb) {
      db.get(row.key, function (err, val) {
        if (err) return cb(null, getBatch(row))

        // update value
        row = {
          type: row.type,
          key: row.key,
          value: extend(val, row.value)
        }

        cb(null, getBatch(row))
      })
    }
  }

  function getBatch (row) {
    const batch = [
      row,
      // facilitate lookup of latest version
      // {
      //   type: op,
      //   key: 'r!' + msg[ROOT_HASH],
      //   value: msg[CUR_HASH]
      // }
    ]

    // const prevHash = getPrevHash(msg)
    // if (op === 'put') {
    //   batch.push({
    //     type: 'del',
    //     key: msg[]
    //   })
    // }

    return batch
  }

  function typeStream (type) {
    return pump(
      db.createReadStream({
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

  return {
    // expose for testing
    _db: db,
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

function getPrevHash (msg) {
  return msg[ROOT_HASH] === msg[CUR_HASH] ? null : msg[PREV_HASH] || msg[ROOT_HASH]
}
