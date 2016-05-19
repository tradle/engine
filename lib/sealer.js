'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const LINK = constants.LINK
const utils = require('./utils')
const assert = utils.assert
const SealStatus = require('./status').seal

module.exports = function (opts) {
  typeforce({
    objectDB: types.logbase,
    transactor: types.transactor
  }, opts)

  const objectDB = opts.objectDB
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

  function writeSeal (state, cb) {
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
      uniqueProperty: LINK
    })

    const queue = pump(
      objectDB.streams.unsealed({ live: true }),
      sq
    )

    queue.on('error', err => ee.emit('error', err))
    return queue.destroy.bind(queue)
  }
}
