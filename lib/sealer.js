'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const pump = require('pump')
const typeforce = require('./typeforce')
const createBackoff = require('backoff')
const debug = require('debug')('tradle:sealer')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const LINK = constants.LINK
const utils = require('./utils')
const controls = require('./controls')
const types = require('./types')
const createRetryStream = require('./retrystream')
const DEFAULT_AMOUNT = 547

module.exports = sealer
module.exports.DEFAULT_BACKOFF_OPTS = constants.DEFAULT_BACKOFF_OPTS

function sealer (opts) {
  typeforce({
    seals: typeforce.Object,
    transactor: types.transactor,
    actions: typeforce.Object,
    networkName: typeforce.String,
    name: typeforce.maybe(typeforce.String)
  }, opts)

  const myDebug = utils.subdebugger(debug, opts.name)
  const actions = opts.actions
  const seals = opts.seals
  const transactor = opts.transactor
  const networkName = opts.networkName
  const backoff = opts.backoff || createBackoff.exponential(module.exports.DEFAULT_BACKOFF_OPTS)

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

    myDebug('sealing ' + state.link)
    transactor.send({
      to: to
    }, function (err, tx) {
      if (err) {
        myDebug('seal failed: ' + err.message)
        return cb(err)
      }

      tx = utils.parseTx(tx, networkName)
      myDebug('sealed ' + state.link)
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
      primaryKey: 'uid',
      backoff: backoff
    })

    const queue = pump(
      sealsStream,
      sealerStream
    )

    queue.on('error', err => ee.emit('error', err))
    return queue.end.bind(queue)
  }
}
