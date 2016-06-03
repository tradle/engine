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
const controls = require('./controls')
const createRetryStream = require('./retrystream')
const LINK = constants.LINK

module.exports = function sender (opts) {
  typeforce({
    send: typeforce.Function,
    objects: typeforce.Object,
    addressBook: typeforce.Object,
    actions: typeforce.Object,
    backoff: typeforce.maybe(typeforce.Object)
  }, opts)

  const actions = opts.actions
  const objects = opts.objects
  const addressBook = opts.addressBook
  const send = opts.send
  const backoff = opts.backoff
  const ee = new EventEmitter()

  let unsentStream
  let recipientStreams

  return utils.extend(ee, controls({ start, pause }))

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
    unsentStream = objects.unsent({ live: true, keys: false })
      .on('data', function (data) {
        const pubKey = utils.pubKeyString(data.object.recipientPubKey)
        getRecipientStream(pubKey).write(data)
      })
      .on('error', function (err) {
        ee.emit('error', err)
      })

    function getRecipientStream (recipient) {
      if (!recipientStreams[recipient]) {
        recipientStreams[recipient] = createRetryStream({
          primaryKey: 'link',
          worker: createSenderWorker(recipient),
          backoff: backoff
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
