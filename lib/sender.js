'use strict'

/**
 * @module sender
 */

const EventEmitter = require('events').EventEmitter
const typeforce = require('./typeforce')
const pump = require('pump')
const thunky = require('thunky')
const through = require('through2')
const debug = require('debug')('tradle:sender')
const protocol = require('@tradle/protocol')
const topics = require('./topics')
const statuses = require('./status')
const types = require('./types')
const utils = require('./utils')
const controls = require('./controls')
const Channel = require('./channel')

module.exports = createSender

/**
 * @typedef {Object} sender
 */

/**
 * message send with retry
 * @alias module:sender
 * @param {Object}        opts
 * @param {Function}      opts.send
 * @param {objectsDB}     opts.objects
 * @param {addressBook}   opts.addressBook
 * @param {Actions}       opts.actions
 * @param {Object}        opts.backoffOptions
 * @param {string}        [opts.name] (for logging)
 */
function createSender (opts) {
  typeforce({
    send: typeforce.Function,
    objects: typeforce.Object,
    addressBook: typeforce.Object,
    actions: typeforce.Object,
    backoffOptions: typeforce.maybe(typeforce.Object),
    name: typeforce.maybe(typeforce.String)
  }, opts)

  const myDebug = utils.subdebugger(debug, opts.name)
  const actions = opts.actions
  const objects = opts.objects
  const addressBook = opts.addressBook
  const send = opts.send
  const sender = new EventEmitter()
  sender.pause = function (recipient) {
    if (!recipient) return sender.pauseAll()
    if (!paused[recipient]) {
      paused[recipient] = true
      const channel = channels[recipient]
      if (channel) channel.pause()
    }

    return sender.resume.bind(sender, recipient)
  }

  sender.pauseAll = function () {
    Object.keys(channels).forEach(recipient => channels[recipient].pause())

    if (unsentStream) {
      unsentStream.pause()
      // unsentStream = null
    }

    return sender.resumeAll.bind(sender)
  }

  sender.resume = function (recipient) {
    if (destroyed) return
    if (!recipient) return sender.resumeAll()
    if (paused[recipient]) {
      delete paused[recipient]
      activateChannel(recipient)
    }
  }

  let destroyed
  let unsentStream
  let paused = {}
  const channels = {}

  sender.start = start
  sender.stop = destroy
  sender.resumeAll = function () {
    paused = {}
    for (var recipient in channels) {
      channels[recipient].resume()
    }
  }

  sender.isRunning = () => !!unsentStream

  return sender

  function destroy () {
    destroyed = true
    sender.pauseAll()
  }

  function normalizeRecipients (recipients) {
    return recipients ? [].concat(recipients) : Object.keys(recipientStreams)
  }

  function getChannels (recipients) {
    return recipients.map(rh => channels[rh])
      // filter out nulls
      .filter(stream => stream)
  }

  function activateChannel (permalink) {
    if (paused[permalink]) return
    // this resume() not needed anymore as channel drains itself
    if (channels[permalink]) return channels[permalink].resume()

    const channelOpts = utils.extend({ recipient: permalink }, opts)
    const channel = channels[permalink] = new Channel(channelOpts)
    channel.once('error', err => {
      myDebug(`channel ${permalink} experienced error`, err.stack)
      channel.destroy()
    })

    channel.once('destroy', () => delete channels[permalink])
    addressBook.byPermalink(permalink, function (err, recipientInfo) {
      if (err) return sender.emit('error', err)

      channel.setRecipient(recipientInfo)
      if (!paused[permalink]) channel.start()
    })
  }

  function start () {
    if (destroyed || unsentStream) return

    paused = {}
    unsentStream = pump(
      objects.unsent({ live: true, keys: false, body: false }),
      through.obj(function (data, enc, cb) {
        activateChannel(data.recipient)
        cb()
      })
    )

    unsentStream.on('error', function (err) {
      myDebug('error in unsent messages stream: ' + err.stack)
      sender.emit('error', err)
    })

    return function stop () {
      unsentStream.end()

      for (let rh in channels) {
        channels[rh].destroy()
      }
    }
  }
}
