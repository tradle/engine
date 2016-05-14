'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const utils = require('./utils')
const assert = utils.assert
const SealStatus = require('./status').seal

module.exports = function (opts) {
  assert(typeof opts.ixf === 'object', 'expected index-feed "ixf"')
  assert(typeof opts.transactor === 'object', 'expected transactor "transactor"')

  const ixf = opts.ixf
  const transactor = opts.transactor
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

  function seal (opts, cb) {
    assert(Buffer.isBuffer(opts.link), 'expected Buffer "link"')
    assert(Buffer.isBuffer(opts.pubKey), 'expected Buffer "pubKey"')
    assert(typeof opts.amount === 'number', 'expected number "amount"')

    const destKeys = protocol.calcSealPubKeys({
      link: opts.link,
      prevLink: opts.prevLink,
      pubKey: opts.pubKey
    })

    let to = [
      destKeys.cur
    ]

    if (destKeys.prev) {
      to.push(destKeys.prev)
    }

    to = to.map(function (key) {
      return {
        amount: opts.amount,
        pubKey: key.toString('hex')
      }
    })

    transactor.send({
      to: to
    }, cb)
  }

  function sealUnsealed (ee, ixf) {
    const sq = createLiveQueue(seal)

    getUnsealed(ixf, function (err, entries) {
      if (err) return ee.emit('error')

      entries.forEach(function (e) {
        sq.push(e.value)
      })
    })

    ixf.index.on('change', function (entry) {
      const value = entry.value
      switch (value.topic) {
      case topics.seal:
        sq.push(entry.sealID, value)
        break
      }
    })

    return sq.destroy
  }
}

function getUnsealed (ixf, cb) {
  const stream = ixf.createReadStream(topics.seal, utils.eqOpts(SealStatus.unsealed))
  collect(stream, cb)
}
