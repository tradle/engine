'use strict'

const EventEmitter = require('events').EventEmitter
const statuses = require('./status')

module.exports = function sender (opts) {
  assert(typeof opts.send === 'function', 'expected function "send"')
  assert(typeof opts.keeper === 'object', 'expected object "keeper"')

  const send = opts.send
  const keeper = opts.keeper
  const ee = new EventEmitter()

  let stop
  ee.start = function () {
    if (!stop) {
      stop = sealUnsealed()
    }
  }

  ee.stop = function () {
    if (stop) {
      stop()
      stop = null
    }
  }

  return ee

  function sendUnsent (ee, ixf) {
    const sendQueues = {}

    getUnsent(ixf, function (err, entries) {
      entries.forEach(function (e) {
        getSendQueue(e).push(e.value)
      })
    })

    ixf.index.on('change', function (entry) {
      const value = entry.value
      switch (value.topic) {
      case topics.msg:
        if (value.sendstatus !== statuses.send.sent) {
          getSendQueue(value.from).push(entry, function (err) {
            if (err) return ee.emit('error', err)
          })
        }

        break
      }
    })

    function getSendQueue (recipient) {
      const rh = recipient.from[ROOT_HASH]
      if (!sendQueues[rh]) {
        const worker = createSenderWorker(ee, recipient.from)
        sendQueues[rh] = createLiveQueue(worker)
      }

      return sendQueues[rh]
    }

    return function destroy () {
      for (let rh in sendQueues) {
        sendQueues[rh].destroy()
      }
    }
  }

  function createSenderWorker (ee, recipient) {
    return function (entry, cb) {
      keeper.getOne(entry.object)
        .then(function (object) {
          send(recipient[ROOT_HASH], serialize(object), function (err) {
            if (err) return cb(err)

            data.sendstatus = statuses.send.sent
            ixf.db.put(data.key, value, cb)
          })
        }, function (err) {
          console.warn('send failed, object not found')
          // don't retry
          err.skip = true
          cb(err)
        })
    }
  }

  function serialize (object) {
    return new Buffer(stringify(object))
  }
}
