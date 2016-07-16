'use strict'

const EventEmitter = require('events').EventEmitter
const typeforce = require('./typeforce')
const pump = require('pump')
const thunky = require('thunky')
const through = require('through2')
const createBackoff = require('backoff')
const debug = require('debug')('tradle:sender')
const protocol = require('@tradle/protocol')
const topics = require('./topics')
const constants = require('./constants')
const statuses = require('./status')
const types = require('./types')
const utils = require('./utils')
const controls = require('./controls')
const createRetryStream = require('./retrystream')
const LINK = constants.LINK

module.exports = createSender
module.exports.DEFAULT_BACKOFF_OPTS = constants.DEFAULT_BACKOFF_OPTS

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
  const newBackoff = function () {
    return createBackoff.exponential(opts.backoffOptions || module.exports.DEFAULT_BACKOFF_OPTS)
  }

  const ee = new EventEmitter()

  let unsentStream
  let recipientStreams

  const sender = utils.extend(ee, controls({ start, pause }))
  return sender

  function pause () {
    getStreams().forEach(stream => stream.pause())
    return function resume () {
      getStreams().forEach(stream => stream.resume())
    }
  }

  function getStreams () {
    return Object.keys(recipientStreams).map(rh => recipientStreams[rh])
      .concat(unsentStream)
  }

  function start () {
    recipientStreams = {}
    unsentStream = pump(
      objects.unsent({ live: true, keys: false }),
      through.obj(function (data, enc, cb) {
        const pubKey = utils.pubKeyString(data.object.recipientPubKey)
        getRecipientStream(pubKey).write(data)
        cb()
      })
    )

    unsentStream.on('error', function (err) {
      myDebug('error in unsent messages stream: ' + err.stack)
      ee.emit('error', err)
    })

    function getRecipientStream (recipient) {
      if (!recipientStreams[recipient]) {
        recipientStreams[recipient] = createRetryStream({
          primaryKey: 'link',
          worker: createSenderWorker(recipient),
          backoff: newBackoff()
        })
        .on('error', err => ee.emit('error', err))
        // switch to old mode to keep stream flowing
        // otherwise it stops when it hits highWaterMark
        .on('data', data => {
          myDebug('sent ' + describe(data))
        })
      }

      return recipientStreams[recipient]
    }

    return function stop () {
      unsentStream.end()

      for (let rh in recipientStreams) {
        recipientStreams[rh].end()
      }
    }
  }

  function createSenderWorker (recipientPubKey) {
    let recipientInfo
    // cache result
    // TODO: invalidate cache when identity changes or don't cache at all
    const getRecipient = thunky(function (cb) {
      addressBook.byPubKey(recipientPubKey, cb)
    })

    return function worker (data, cb) {
      if (!sender.isRunning()) return cb(new Error('not running'))

      getRecipient(function (err, recipientInfo) {
        if (err) return cb(err)

        if (!sender.isRunning()) return cb(new Error('not running'))

        myDebug('sending ' + describe(data))
        send(utils.serializeMessage(data.object), recipientInfo, function (err) {
          if (err) {
            myDebug(`send failed for ${describe(data)}: ${err.stack}`)
            return cb(err)
          }

          actions.sentMessage(data.link, cb)
        })
      })
    }
  }
}

function describe (data) {
  return [data.type, 'to', data.recipient].join(' ')
}
