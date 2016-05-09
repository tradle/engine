
'use strict'

const EventEmitter = require('events').EventEmitter
const extend = require('xtend')
const map = require('map-stream')
const collect = require('stream-collector')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const utils = require('./utils')
const assert = utils.assert
const SealStatus = require('./status').seal
const topics = require('./topics')
const IDENTITY = constants.TYPES.IDENTITY

module.exports = function (opts) {
  assert(typeof opts.ixf === 'object', 'expected index-feed "ixf"')
  assert(typeof opts.keeper === 'object', 'expected keeper "keeper"')

  const ixf = opts.ixf
  const keeper = opts.keeper

  // ixf.index.add(function (row, cb) {
  //   const value = entry.value
  //   switch (value.topic) {
  //   case topics.msg:
  //     if (value.type === IDENTITY) {
  //       value = extend(value)
  //       return cb(null, value)
  //     }

  //     break
  //   }

  //   cb()
  // })

  function typeStream (type) {
    return ixf.index.createReadStream('type', { gte: type, lte: type})
      .pipe(map(utils.augment))
  }

  function list (type, cb) {
    collect(typeStream(type), cb)
  }

  return {
    typeStream: typeStream,
    identityStream: function () {
      return typeStream(IDENTITY)
    },
    list: list,
    identities: function (cb) {
      list(IDENTITY, cb)
    },
    get: function (link, cb) {
      utils.firstFromIndex(ixf.index, utils.hex(link), function (err, val) {
        if (err) return cb(err)

        utils.augment(val, keeper, cb)
      })
    }
  }
}
