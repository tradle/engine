'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const pump = require('pump')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const LINK = constants.LINK
const utils = require('./utils')
const controls = require('./controls')
const types = require('./types')
const createRetryStream = require('./retrystream')
const DEFAULT_AMOUNT = 547

module.exports = function sealer (opts) {
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
  let sealsStream
  let sealerStream
  return utils.extend(ee, controls({ start, pause }))

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

      tx = utils.parseTx(tx, networkName)
      actions.wroteSeal(state, tx, cb)
    })
  }

  function pause () {
    sealsStream.pause()
    sealerStream.pause()
    return function () {
      sealsStream.resume()
      sealerStream.resume()
    }
  }

  function start () {
    sealsStream = seals.pending({ live: true, keys: false })
    sealerStream = createRetryStream({
      worker: writeSeal,
      // primaryKey: 'link'
      primaryKey: 'uid'
    })

    const queue = pump(
      sealsStream,
      sealerStream
    )

    queue.on('error', err => ee.emit('error', err))
    return queue.end.bind(queue)
  }
}
