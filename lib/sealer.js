/**
 * @module sealer
 */

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const pump = require('pump')
const typeforce = require('@tradle/typeforce')
const createBackoff = require('backoff')
const debug = require('debug')('tradle:sealer')
const protocol = require('@tradle/protocol')
const through = require('through2')
const constants = require('./constants')
const LINK = constants.LINK
const utils = require('./utils')
const controls = require('./controls')
const types = require('./types')
const createRetryStream = require('./retrystream')

module.exports = sealer
module.exports.DEFAULT_BACKOFF_OPTS = constants.DEFAULT_BACKOFF_OPTS

const sealerOpts = typeforce.object({
  seals: typeforce.Object,
  actions: typeforce.Object,
  getBlockchainAdapter: typeforce.Function,
  transactor: types.transactor,
  backoffOptions: typeforce.maybe(typeforce.Object),
  name: typeforce.maybe(typeforce.String)
})

/**
 * blockchain seal creator with retry
 * @alias module:sealer
 * @param {Object}     opts
 * @param {sealsDB}    opts.seals
 * @param {transactor} opts.transactor
 * @param {Actions}    opts.actions
 * @param {Object}     [opts.backoffOptions]
 * @param {String}     [opts.name]  for logging
 */
function sealer (opts) {
  sealerOpts.assert(opts)

  const myDebug = utils.subdebugger(debug, opts.name)
  const { actions, seals, getBlockchainAdapter, transactor } = opts
  const newBackoff = function () {
    return createBackoff.exponential(opts.backoffOptions || module.exports.DEFAULT_BACKOFF_OPTS)
  }

  let sealsStream
  let sealerStream
  const ee = controls({start, pause})
  return ee

  function writeSeal (state, cb) {
    let to = [state.sealAddress]
    if (state.sealPrevAddress) {
      if (transactor.multipleRecipientsAllowed === false) {
        myDebug('transactor does not allow multiple output addresses, skipping prev')
      } else {
        to.push(state.sealPrevAddress)
      }
    }

    to = to.map(function (address) {
      return {
        amount: state.amount || getBlockchainAdapter(state).minOutputAmount,
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

      actions.wroteSeal(state, tx, err => {
        if (err) return cb(err)

        cb(null, tx)
      })
    })
  }

  function pause () {
    sealerStream.pause()
    return function () {
      sealerStream.resume()
    }
  }

  function start () {
    sealsStream = seals.pending({ live: true, keys: false })
    sealerStream = createRetryStream({
        worker: writeSeal,
        // primaryKey: 'link'
        primaryKey: 'uid',
        backoff: newBackoff()
      })
      .on('error', err => ee.emit('error', err))

    pump(
      sealsStream,
      sealerStream,
      through.obj(function (data, enc, cb) {
        // drain results of sealerStream
        myDebug(`sealed ${data.input.link} to address ${data.input.sealAddress} with tx ${data.output.txId}`)
        cb()
      })
    )

    return sealsStream.end.bind(sealsStream)
  }
}
