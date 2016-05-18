'use strict'

const EventEmitter = require('events').EventEmitter
const typeforce = require('typeforce')
const pump = require('pump')
const constants = require('@tradle/constants')
const statuses = require('./status')
const types = require('./types')
const utils = require('./utils')
const createWorkerStream = require('./queue')
const CUR_HASH = constants.CUR_HASH

module.exports = function sender (opts) {
  typeforce({
    send: typeforce.Function,
    keeper: typeforce.object,
    msgDB: typeforce.Object,
    addressBook: typeforce.Object,
    changes: types.changes
  }, opts)

  const changes = opts.changes
  const msgDB = opts.msgDB
  const addressBook = opts.addressBook
  const send = opts.send
  const keeper = opts.keeper
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

    msgDB.unsentStream({ live: true })
      .on('data', function (data) {
        getRecipientStream(data.recipient).write(data)
      })
      .on('error', function (err) {
        ee.emit('error', err)
      })

    function getRecipientStream (recipient) {
      if (!recipientStreams[recipient]) {
        recipientStreams[recipient] = createWorkerStream({
          uniqueProperty: 'msgID',
          worker: createSenderWorker(recipient)
        })
      }

      return recipientStreams[recipient]
    }

    return function destroy () {
      for (let rh in recipientStreams) {
        recipientStreams[rh].destroy()
      }
    }
  }

  function createSenderWorker (recipient) {
    let recipientInfo
    // cache result
    // TODO: invalidate cache when identity changes or don't cache at all
    const getRecipient = thunky(function (cb) {
      addressBook.lookupIdentity(recipient, cb)
    })

    return function worker (data, cb) {
      getRecipient(function (err, recipient) {
        if (err) return cb(err)

        // lookup object data
        // TODO: this doesn't need to happen on every new send attempt
        // for the same message. But the caching might be better placed
        // on the keeper side
        keeper.get(data[CUR_HASH], function (err, object) {
          if (err) {
            console.warn('send failed, object not found')
            // don't retry
            err.skip = true
            return cb(err)
          }

          send(serialize(object), recipient, function (err) {
            if (err) return cb(err)

            data.sendstatus = statuses.send.sent
            changes.append(data, function (err) {
              if (err) return cb(err)

              ee.emit('sent', data)
              cb()
            })
          })
        })
      })
    }
  }

  function serialize (object) {
    return new Buffer(utils.stringify(object))
  }
}
