'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const pump = require('pump')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const chaintracker = require('chain-tracker')
const constants = require('./constants')
const LINK = constants.LINK
const utils = require('./utils')
const types = require('./types')
const createWorkerStream = require('./queue')
const DEFAULT_AMOUNT = 547

module.exports = function (opts) {
  typeforce({
    seals: typeforce.Object,
    transactor: types.transactor,
    actions: typeforce.Object,
    networkName: typeforce.String
  }, opts)

  const actions = opts.actions
  const seals = opts.seals
  const transactor = opts.transactor
  const networkName = opts.networkName

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
    let to = [ state.sealAddress ]
    if (state.sealPrevAddress) to.push(state.sealPrevAddress)

    to = to.map(function (address) {
      return {
        amount: state.amount || DEFAULT_AMOUNT,
        address: address
      }
    })

    transactor.send({
      to: to
    }, function (err, tx) {
      if (err) return cb(err)

      tx = chaintracker.parseTx(tx, networkName)
      actions.wroteSeal(state, tx, cb)
    })
  }

  function sealUnsealed () {
    const sealerStream = createWorkerStream({
      worker: writeSeal,
      // uniqueProperty: 'link'
      uniqueProperty: 'uid'
    })

    const queue = pump(
      seals.pending({ live: true, keys: false }),
      sealerStream
    )

    queue.on('error', err => ee.emit('error', err))
    return queue.end.bind(queue)
  }
}
