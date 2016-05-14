
'use strict'

const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const ROOT_HASH = constants.ROOT_HASH
const CUR_HASH = constants.CUR_HASH
const PREV_HASH = constants.PREV_HASH
const utils = require('./utils')
const topics = require('./topics')
const types = require('./types')
const createIndexFeed = require('./index-feed')
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const CUR_HASH_PREFIX = 'c!'

module.exports = function createAddressBook (opts) {
  typeforce({
    log: types.log,
    db: typeforce.String,
    keeper: typeforce.Object,
    leveldown: types.leveldown
  }, opts)

  opts.indexer = indexer
  const db = createIndexFeed(opts)
  const keeper = opts.keeper

  function indexer (batch, cb) {
    batch = batch.filter(relevant)
    if (!batch.length) return cb()

    async.parallel(batch.map(processor), function (err, results) {
      if (err) return cb(err)

      cb(null, utils.flatten(results))
    })
  }

  function relevant (row) {
    return row.value.topic === topics.addcontact // && row.value.type === IDENTITY_TYPE
  }

  function processor (row) {
    return function (cb) {
      const op = row.type // 'put' or 'del'
      const rootHash = row.value[ROOT_HASH]
      const curHash = row.value[CUR_HASH]
      keeper.getOne(curHash)
        .then(identity => {
          const batch = identity.pubkeys.map(key => key.pub)
            .concat(identity.pubkeys.map(key => key.fingerprint))
            .map(prop => {
              return {
                type: op,
                key: prop,
                value: curHash
              }
            })

          // batch.push({
          //   type: op,
          //   key: rootHash,
          //   value: curHash
          // })

          if (op === 'put') {
            // prevent overwrite as overwrite implies
            // that two identities share keys
            async.parallel(batch.map(function (row) {
              return function (cb) {
                db.get(row.key, function (err, val) {
                  if (val && val !== rootHash) {
                    cb(new Error('refusing to overwrite identity key mappings'))
                  } else {
                    cb()
                  }
                })
              }
            }), function (err) {
              if (err) return cb(err)

              // so we can stream identities
              const prevHash = identity[PREV_HASH] || identity[ROOT_HASH]
              if (op === 'put' && prevHash) {
                // delete previous curHash mapping
                batch.push({
                  type: 'del',
                  key: prefixCurHash(prevHash),
                  value: prevHash
                })
              }

              batch.push({
                type: op,
                key: rootHash,
                value: curHash
              })

              batch.push({
                type: op,
                key: prefixCurHash(curHash),
                value: curHash
              })

              cb(null, batch)
            })
          }
        }, cb)
    }
  }

  function bySecondaryIndex (str, cb) {
    typeforce(typeforce.String, str)
    db.get(str, function (err, val) {
      if (err) return cb(err)

      byCurHash(val, cb)
    })
  }

  function byCurHash (curHash, cb) {
    typeforce(typeforce.String, curHash)
    keeper.getOne(curHash)
      .then(formatter(curHash, cb), cb)
  }

  function formatter (curHash, opts, cb) {
    return function (identity) {
      if (typeof opts === 'function') {
        cb = opts
        opts = null
      }

      // if (opts && opts.keys === false) return cb(null, identity)

      cb(null, {
        [ROOT_HASH]: identity[ROOT_HASH] || curHash,
        [CUR_HASH]: curHash,
        identity: identity
      })
    }
  }

  function createReadStream (opts) {
    opts = opts || {}
    const raw = db.createReadStream({
      // values: opts.values !== false,
      gt: CUR_HASH_PREFIX,
      lt: CUR_HASH_PREFIX + '\xff'
    })

    // if (opts.values === false) {
    //   return pump(
    //     raw,
    //     through(function (data, enc, cb) {
    //       cb(null, data.toString().slice(CUR_HASH_PREFIX.length))
    //     })
    //   )
    // }

    return pump(
      raw,
      through.obj(function (data, enc, cb) {
        const curHash = data.key.slice(CUR_HASH_PREFIX.length)
        keeper.getOne(curHash)
          .then(formatter(curHash, opts, cb), cb)
      })
    )
  }

  return {
    _db: db,
    lookupIdentity: bySecondaryIndex,
    stream: createReadStream
  }
}

function prefixCurHash (val) {
  return CUR_HASH_PREFIX + val
}
