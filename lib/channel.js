'use strict'

const inherits = require('util').inherits
const EventEmitter = require('events').EventEmitter
const createBackoff = require('backoff')
const debug = require('debug')('tradle:channel')
const pump = require('pump')
const createRetryStream = require('./retrystream')
const utils = require('./utils')
const constants = require('./constants')
module.exports.DEFAULT_BACKOFF_OPTS = constants.DEFAULT_BACKOFF_OPTS

module.exports = Channel

/**
 * message delivery channel
 * @constructor
 * @module channel
 * @param {AddressBook}  opts.addressBook
 * @param {ObjectsDB}    opts.objects
 * @param {Function}     opts.send
 * @param {Actions}      opts.actions
 * @param {Object}       [opts.backoffOptions]
 */
function Channel (opts) {
  // const addressBook = opts.addressBook
  // this._debugId = op
  EventEmitter.call(this)
  this.opts = opts
  this.createBackoff = function () {
    return createBackoff.exponential(opts.backoffOptions || module.exports.DEFAULT_BACKOFF_OPTS)
  }
}

inherits(Channel, EventEmitter)

Channel.prototype._debug = function () {
  utils.subdebug(debug, this.opts.name, arguments)
}

Channel.prototype.setRecipient = function (recipient) {
  this.recipient = recipient
}

Channel.prototype.destroy = function () {
  if (this._destroyed) throw new Error('already destroyed!')

  this._destroyed = true
  if (this.stream)  {
    this.stream.destroy()
    this.stream = null
  }

  this.emit('destroy')
}

Channel.prototype.start = function () {
  const self = this
  if (!this.recipient) throw new Error('call "setRecipient" first')
  if (this.started) return

  this.started = true
  const opts = this.opts
  const addressBook = opts.addressBook
  const objects = opts.objects
  const send = opts.send
  const actions = opts.actions
  const senderStream = createRetryStream({
      primaryKey: 'link',
      worker: worker,
      backoff: this.createBackoff()
    })
    .on('error', err => this.emit('error', err))
    // switch to old mode to keep stream flowing
    // otherwise it stops when it hits highWaterMark
    .on('data', data => {
      self._debug('sent ' + describe(data))
    })

  this.stream = pump(
    objects.unsentTo(this.recipient.permalink, { live: true, keys: false }),
    senderStream
  )

  // this.stream.resume()

  // TODO: setRecipient again if their identity changes
  function worker (data, cb) {
    if (self._destroyed) return cb(new Error('not running'))

    self._debug('sending ' + describe(data))
    send(utils.serializeMessage(data.object), self.recipient, function (err) {
      if (err) {
        self._debug(`send failed for ${describe(data)}: ${err.stack}`)
        return cb(err)
      }

      actions.sentMessage(data.link, cb)
    })
  }
}

function describe (data) {
  return [data.type, 'to', data.recipient].join(' ')
}
