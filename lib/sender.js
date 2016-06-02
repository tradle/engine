'use strict'

const EventEmitter = require('events').EventEmitter
const typeforce = require('typeforce')
const pump = require('pump')
const thunky = require('thunky')
const protocol = require('@tradle/protocol')
const topics = require('./topics')
const constants = require('./constants')
const statuses = require('./status')
const types = require('./types')
const utils = require('./utils')
const createWorkerStream = require('./queue')
const LINK = constants.LINK

module.exports = function sender (opts) {
  typeforce({
    send: typeforce.Function,
    keeper: typeforce.object,
    objects: typeforce.Object,
    addressBook: typeforce.Object,
    actions: typeforce.Object,
    backoff: typeforce.maybe(typeforce.Object)
  }, opts)

  const actions = opts.actions
  const objects = opts.objects
  const addressBook = opts.addressBook
  const send = opts.send
  const keeper = opts.keeper
  const backoff = opts.backoff
  const ee = new EventEmitter()

  let stop
  ee.start = function () {
    if (!stop) {
      stop = sendUnsent()
    }
  }

  ee.stop = function () {
    if (stop) {
      stop()
      stop = null
    }
  }

  return ee

  function sendUnsent () {
    const recipientStreams = {}
    const source = objects.unsent({ live: true, keys: false })
      .on('data', function (data) {
        const pubKey = utils.pubKeyString(data.object.recipientPubKey)
        getRecipientStream(pubKey).write(data)
      })
      .on('error', function (err) {
        ee.emit('error', err)
      })

    function getRecipientStream (recipient) {
      if (!recipientStreams[recipient]) {
        recipientStreams[recipient] = createWorkerStream({
          primaryKey: 'link',
          worker: createSenderWorker(recipient),
          backoff: backoff
        })
      }

      return recipientStreams[recipient]
    }

    return function destroy () {
      source.end()

      for (let rh in recipientStreams) {
        recipientStreams[rh].destroy()
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
      getRecipient(function (err, recipientPubKey) {
        if (err) return cb(err)

        send(protocol.serializeMessage(data.object), recipientPubKey, function (err) {
          if (err) return cb(err)

          actions.sentMessage(data.link, cb)
        })
      })
    }
  }
}
