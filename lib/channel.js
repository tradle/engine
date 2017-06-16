'use strict'

/**
 * @module channel
 */

const inherits = require('util').inherits
const EventEmitter = require('events').EventEmitter
const createBackoff = require('backoff')
const debug = require('debug')('tradle:channel')
const pump = require('pump')
const through = require('through2')
const createRetryStream = require('./retrystream')
const utils = require('./utils')
const constants = require('./constants')
const errors = require('./errors')

module.exports.DEFAULT_BACKOFF_OPTS = constants.DEFAULT_BACKOFF_OPTS

module.exports = Channel

/**
 * message delivery channel
 * @constructor
 * @alias module:channel
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

/**
 * set the recipient
 * @param {String} recipient
 */
Channel.prototype.setRecipient = function (recipient) {
  this.recipient = recipient
}

Channel.prototype.pause = function () {
  this._paused = true
  if (this.stream) this.stream.pause()
  this.emit('pause')
}

Channel.prototype.resume = function () {
  this._paused = false
  if (this.stream) this.stream.resume()
  this.emit('resume')
}

/**
 * close the channel
 */
Channel.prototype.destroy = function () {
  if (this._destroyed) throw new Error('already destroyed!')

  this._destroyed = true
  if (this.stream)  {
    this.stream.destroy()
    this.stream = null
  }

  this.emit('destroy')
}

/**
 * start sending any messages queued up the database for this channel
 */
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
    .on('error', err => {
      if (!this._destroyed) {
        this.emit('error', err)
      }
    })
    // // switch to old mode to keep stream flowing
    // // otherwise it stops when it hits highWaterMark
    // .on('data', data => {
    //   self._debug('sent ' + describe(data.input))
    // })

  this.stream = pump(
    objects.unsentTo(this.recipient.permalink, { live: true, keys: false, body: false }),
    // add body
    through.obj({ highWaterMark: 1 }, function (data, enc, cb) {
      const link = data.link
      objects.addBody(data, err => {
        if (err) {
          self._debug(`missing ${data.objectinfo.type} body for ${link}, skipping message`)
          return cb()
        }

        cb(null, data)
      })
    }),
    senderStream,
    through.obj(function (data, enc, cb) {
      // drain results of senderStream
      cb()
    })
  )

  // this.stream.resume()

  // TODO: setRecipient again if their identity changes
  function worker (data, cb) {
    if (self._destroyed) return cb(new Error('not running'))
    if (self._paused) {
      return self.once('resume', function () {
        worker(data, cb)
      })
    }

    self._debug('sending ' + describe(data))
    const serialized = utils.serializeMessage(data.object)
    serialized.unserialized = data
    send(serialized, self.recipient, function (err) {
      if (err) {
        if (err.type === 'willnotsend') {
          actions.abortMessage(data.link, function (err) {
            if (err) return cb(err)

            // force recreate
            self.destroy()
          })

          return
        }

        self._debug(`send failed for ${describe(data)}: ${err.stack}`)
        return cb(err)
      }

      self._debug(`send succeeded for ${describe(data)}`)
      actions.sentMessage(data.link, cb)
    })
  }
}

function describe (data) {
  return ['message', data.link, 'carrying', data.objectinfo.type, data.objectinfo.link, 'to', data.recipient].join(' ')
}
