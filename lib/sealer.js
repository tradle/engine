'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const CUR_HASH = constants.CUR_HASH
const utils = require('./utils')
const assert = utils.assert
const SealStatus = require('./status').seal

module.exports = function (opts) {
  typeforce({
    msgDB: types.logbase,
    transactor: types.transactor
  }, opts)

  const msgDB = opts.msgDB
  const transactor = opts.transactor

  const ee = new EventEmitter()
  let stop
  ee.start = function () {
    if (!stop) {
      stop = sealUnsealed()
    }
  }

  ee.stop = function () {
    if (stop) {
      stop()
      stop = null
    }
  }

  return ee

  function writeSeal (opts, cb) {
    const sealNewVersion = protocol.calcSealPubKey({
      link: opts.link,
      basePubKey: opts.basePubKey
    })

    const sealPrevVersion = opts.prevLink && protocol.calcSealPrevPubKey({
      prevLink: opts.prevLink,
      basePubKey: opts.basePubKey
    })

    let to = [ sealNewVersion ]
    if (sealPrevVersion) to.push(sealPrevVersion)

    to = to.map(function (key) {
      return {
        amount: opts.amount,
        pubKey: key.pub.toString('hex')
      }
    })

    transactor.send({
      to: to
    }, cb)
  }

  function sealUnsealed (ee, ixf) {
    const sq = createLiveQueue({
      worker: writeSeal,
      uniqueProperty: CUR_HASH
    })

    const queue = pump(msgDB.unsealedStream({ live: true }), sq, function (err) {
      if (err) ee.emit('error', err)
    })

    return queue.destroy.bind(queue)
  }
}
