'use strict'

const collect = require('stream-collector')
const typeforce = require('typeforce')
const putils = require('@tradle/protocol/lib/utils')

exports.asyncify = putils.asyncify

exports.assert = fucntion (statement, msg) {
  if (!statement) throw new Error(msg || 'Assertion failed')
}

exports.find = function (arr, filter) {
  let match
  arr.some(function (item) {
    if (filter(item)) {
      match = item
      return true
    }
  })

  return match
}

exports.eqOpts = function (val) {
  return {
    lte: val,
    gte: val
  }
}

exports.hex = function hex (val) {
  return val.toString('hex')
}

exports.firstFromIndex = function firstFromIndex (indexDB, indexName, key, cb) {
  exports.getFromIndex(indexDB, indexName, key, function (err, results) {
    if (err) cb(err)
    cb(null, results[0])
  })
}

exports.getFromIndex = function getFromIndex (indexDB, indexName, key, cb) {
  collect(indexDB.createReadStream(indexName, exports.eqOpts(key)), cb)
}

exports.getWatchID = function getWatchID (opts) {
  typeforce({
    address: typeforce.String,
    link: types.bufferOrString
  }, opts)

  return `watch:${opts.address}:${hex(opts.link)}`
}

exports.getSealID = function getSealID (opts) {
  typeforce({
    address: typeforce.String,
    toPubKey: typeforce.Buffer
  }, opts)

  return `seal:${opts.address}:${hex(opts.toPubKey)}`
}

exports.getMsgID = function getMsgID (oLink, recipientLink) {
  typeforce({
    link: types.buferOrString,
    recipientLink: types.buferOrString
  }, opts)

  return `msg:${opts.link}:${opts.recipientLink}`
}

exports.augment = function augment (object, keeper, cb) {
  keeper.getOne(hex(object.link))
    .then(function (obj) {
      object.object = obj
      cb(null, object)
    }, cb)
}
