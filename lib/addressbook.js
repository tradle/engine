
'use strict'

const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
const protocol = require('@tradle/protocol')
const changeProcessor = require('level-change-processor')
const constants = require('./constants')
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const utils = require('./utils')
const topics = require('./topics')
const types = require('./types')
const IDENTITY_TYPE = constants.types.IDENTITY
const LINK_PREFIX = 'c!'

module.exports = function createAddressBook (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: types.keeper
  }, opts)

  const keeper = opts.keeper
  const db = opts.db
  const processor = changeProcessor({
    feed: opts.changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  // processor.on('live', console.log.bind(console, 'live'))

  // secondary indexes map to current hash

  const byRootHash = subdown(db, 'r', { valueEncoding: 'utf8' })
  const indexes = subdown(db, 's', { valueEncoding: 'utf8' })

  function worker (change, cb) {
    const val = change.value
    switch (val.topic) {
    case topics.addcontact:
      return addContact(change, cb)
    // case topics.setidentity:
    //   return setIdentity(change, cb)

    }

    cb()
  }

  // function setIdentity (change, cb) {
  //   const val = change.value
  //   const rootHash = val[PERMALINK]
  //   const curHash = val[LINK]
  //   db.put()
  // }

  function addContact (change, cb) {
    const val = change.value
    const rootHash = val[PERMALINK]
    const curHash = val[LINK]

    keeper.get(curHash, function (err, identity) {
      if (err) return cb(err)

      const batch = identity.pubkeys.map(key => key.pub)
        .concat(identity.pubkeys.map(key => key.fingerprint))
        .concat(curHash)
        .map(v => {
          return {
            type: 'put',
            key: utils.prefixKey(indexes, v),
            value: curHash
          }
        })

      const prevHash = identity[PREVLINK] || identity[PERMALINK]
      if (prevHash) {
        // delete previous curHash mapping
        batch.push({
          type: 'del',
          key: utils.prefixKey(indexes, prevHash)
        })
      }

      // prevent overwrite as overwrite implies
      // that two identities share keys
      async.parallel(batch.map(function (op) {
        return function (done) {
          db.get(op.key, function (err, val) {
            if (val && val !== rootHash) {
              done(new Error('refusing to overwrite identity key mappings'))
            } else {
              done()
            }
          })
        }
      }), function commit (err) {
        if (err) {
          debug('experienced error saving identity', err, identity)
          return cb()
        }

        // so we can stream identities
        batch.push({
          type: 'put',
          key: utils.prefixKey(byRootHash, rootHash),
          value: curHash
        })

        // batch.push({
        //   type: 'put',
        //   key: utils.prefixKey(indexes, rootHash),
        //   value: curHash
        // })

        db.batch(batch, cb)
      })
    })
  }

  function bySecondaryIndex (str, cb) {
    typeforce(typeforce.String, str)
    processor.onLive(function () {
      db.get(utils.prefixKey(indexes, str), function (err, val) {
        if (err) return cb(err)

        getBody(val, cb)
      })
    })
  }

  function getBody (curHash, cb) {
    typeforce(typeforce.String, curHash)
    keeper.get(curHash, function (err, body) {
      if (err) return cb(err)

      cb(null, formatIdentityInfo(curHash, body))
    })
  }

  function formatIdentityInfo (curHash, body) {
    return {
      [PERMALINK]: body[PERMALINK] || curHash,
      [LINK]: curHash,
      identity: body
    }
  }

  function createReadStream (opts) {
    opts = opts || {}
    return pump(
      byRootHash.createValueStream(),
      through.obj(function (curHash, enc, cb) {
        getBody(JSON.parse(curHash), cb)
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
  return LINK_PREFIX + val
}
