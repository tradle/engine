'use strict'

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
      if (channel) channel.destroy()
    }

    return sender.resume.bind(sender, recipient)
  }

  sender.pauseAll = function () {
    Object.keys(channels).forEach(recipient => channels[recipient].destroy())

    unsentStream.destroy()
    unsentStream = null
    return sender.resumeAll.bind(sender)
  }

  sender.resume = function (recipient) {
    if (!recipient) return sender.resumeAll()
    if (paused[recipient]) {
      delete paused[recipient]
      activateChannel(recipient)
    }
  }

  sender.start = start
  sender.stop = sender.pauseAll
  sender.resumeAll = start
  sender.isRunning = () => !!unsentStream

  let unsentStream
  let paused = {}
  const channels = {}
  return sender

  function normalizeRecipients (recipients) {
    return recipients ? [].concat(recipients) : Object.keys(recipientStreams)
  }

  function getChannels (recipients) {
    return recipients.map(rh => channels[rh])
      // filter out nulls
      .filter(stream => stream)
  }

  function activateChannel (permalink) {
    if (channels[permalink] || paused[permalink]) return

    const channelOpts = utils.extend({ recipient: permalink }, opts)
    const channel = channels[permalink] = new Channel(channelOpts)
    channel.once('destroy', () => delete channels[permalink])
    addressBook.byPermalink(permalink, function (err, recipientInfo) {
      if (err) return sender.emit('error', err)

      channel.setRecipient(recipientInfo)
      if (!paused[permalink]) channel.start()
    })
  }

  function start () {
    if (unsentStream) throw new Error('already started!')

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
