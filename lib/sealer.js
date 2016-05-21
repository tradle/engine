'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const pump = require('pump')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const LINK = constants.LINK
const utils = require('./utils')
const types = require('./types')
const createWorkerStream = require('./queue')

module.exports = function (opts) {
  typeforce({
    objectDB: typeforce.Object,
    transactor: types.transactor,
    actions: typeforce.Object
  }, opts)

  const actions = opts.actions
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
    let to = [ state.sealPubKey ]
    if (state.sealPrevPubKey) to.push(state.sealPrevPubKey)

    to = to.map(function (key) {
      return {
        amount: opts.amount,
        pubKey: key.pub.toString('hex')
      }
    })

    transactor.send({
      to: to
    }, function (err, tx) {
      if (err) return cb(err)

      actions.sealedObject(data, tx, cb)
    })
  }

  function sealUnsealed (ee, ixf) {
    const sealerStream = createWorkerStream({
      worker: writeSeal,
      uniqueProperty: 'uid'
    })

    const queue = pump(
      objectDB.streams.unsealed({ live: true }),
      sealerStream
    )

    queue.on('error', err => ee.emit('error', err))
    return queue.end.bind(queue)
  }
}
