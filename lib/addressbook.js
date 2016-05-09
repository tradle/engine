
'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const parallel = require('run-parallel')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const ROOT_HASH = constants.ROOT_HASH
const CUR_HASH = constants.CUR_HASH
const utils = require('./utils')
const assert = utils.assert
const SealStatus = require('./status').seal
const topics = require('./topics')
const msgDB = require('./msgdb')
const IDENTITY_TYPE = constants.TYPES.IDENTITY

module.exports = function (opts) {
  assert(typeof opts.ixf === 'object', 'expected index-feed "ixf"')
  assert(typeof opts.keeper === 'object', 'expected keeper "keeper"')

  const ixf = opts.ixf
  const keeper = opts.keeper

  ixf.index.add(function (row, cb) {
    const value = entry.value
    switch (value.topic) {
    case topics.msg:
      if (value.type !== IDENTITY_TYPE) return cb()

      value = extend(value)
      parallel(value.pubkeys.map(function (key) {
        return function () {
          byPubKey(key.value, function (err, val) {
            cb(val ? new Error('collision') : null)
          })
        }
      }), function (err) {
        if (err) return cb() // don't save

        value.pubkeys.forEach(function (key) {
          value['p:' + key.value] = value['f:' + key.fingerprint] = value.link
        })

        cb(null, value)
      })

      break
    default:
      return cb()
    }
  })

  function byLink (link, cb) {
    utils.firstFromIndex(ixf.index, utils.hex(link), function (err, val) {
      if (err) return cb(err)

      utils.augment(val, keeper, cb)
    })
  }

  function byPubKey (pubKey, cb) {
    utils.firstFromIndex(ixf.index, 'p:' + pubKey, function (err, val) {
      if (err) return cb(err)

      utils.augment(val, keeper, cb)
    })
  }

  function byFingerprint (fingerprint, cb) {
    utils.firstFromIndex(ixf.index, 'f:' + fingerprint, function (err, val) {
      if (err) return cb(err)

      utils.augment(val, keeper, cb)
    })
  }

  return {
    byFingerprint: byFingerprint,
    byLink: byLink,
    byPubKey: byPubKey,
    lookupIdentity: function lookupIdentity (identifier, cb) {
      const link = identitifier[CUR_HASH] || identitifier[ROOT_HASH]
      if (link) return byLink(link, cb)

      if (identifier.pubKey) return byPubKey(identifier.pubKey, cb)
      if (identifier.fingerprint) return byPubKey(identifier.fingerprint, cb)

      throw new Error('invalid identifier')
    }
  }
}
