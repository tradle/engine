'use strict'

// const WHY = require('why-is-node-running')
const test = require('tape')
const extend = require('xtend')
const memdown = require('memdown')
const async = require('async')
const Wallet = require('@tradle/simple-wallet')
const testHelpers = require('@tradle/test-helpers')
const kiki = require('@tradle/kiki')
const utils = require('../lib/utils')
const users = require('./fixtures/users')
const helpers = require('./helpers')
const contexts = require('./contexts')
const Node = require('../lib/node')
const constants = require('../lib/constants')
const Queue = require('../lib/queue')
const SHORT_BACKOFF_OPTS = {
  initialDelay: 10,
  maxDelay: 1000
}

const LONG_BACKOFF_OPTS = {
  initialDelay: 60 * 1000 * 1000, // foreverish
  maxDelay: 60 * 1000 * 1000 * 1000
}

Queue.DEFAULT_BACKOFF_OPTS = SHORT_BACKOFF_OPTS
const names = helpers.names
const TYPE = constants.TYPE
const noop = () => {}
let INSTANCE_COUNT = 0

test('self in address book', function (t) {
  // TODO: should be stricter
  // self should be in addressBook immediately
  t.timeoutAfter(1000)

  const alice = contexts.nUsers(1)
  alice.actions.once('addcontact', function () {
    alice.addressBook.lookupIdentity(alice.identityInfo.link, function (err, identityInfo) {
      if (err) throw err

      delete identityInfo.timestamp
      t.same(alice.identityInfo, identityInfo)
      alice.destroy()
      t.end()
    })
  })
})

// test('unchained self', function (t) {

// })

test('basic send/receive', function (t) {
  let blockchain
  contexts.twoFriends(function (err, friends) {
    if (err) throw err

    const alice = friends[0]
    const bob = friends[1]
    const aInfo = { link: alice.identityInfo.link }
    let numTries = 0

    alice._send = function (msg, recipient, cb) {
      if (++numTries < 5) {
        t.pass('failed on purpose retrying...')
        return cb(new Error('oops'))
      }

      bob.receive(msg, aInfo, function (err) {
        if (err) throw err

        cb.apply(null, arguments)
      })
    }

    // setTimeout(function () {
    //   alice.addressBook.createReadStream()
    //     .on('data', console.log)
    //     // .on('end', console.log)
    // }, 200)

    const obj = {
      [TYPE]: 'thang',
      a: 1,
      b: 2
    }

    alice.signNSend({
      object: obj,
      recipient: bob._recipientOpts,
    }, rethrow)

    alice.on('sent', wrapper => {
      t.same(wrapper.object.object, obj)
    })

    bob.on('message', wrapper => {
      t.same(wrapper.object.object, obj)

      alice.destroy()
      bob.destroy()
      t.end()
    })
  })
})

test.only('basic seals', function (t) {
  // t.timeoutAfter(1000)
  t.plan(3)
  contexts.twoFriendsMessageSentReceived(function (err, result) {
    if (err) throw err

    const friends = result.friends
    const alice = friends[0]
    const bob = friends[1]

    // console.log(result.sent)
    alice.seal(result.sent, rethrow)
    alice.on('wroteseal', seal => t.pass('alice wrote seal'))
    alice.on('readseal', seal => {
      t.pass('alice read seal')
      clearInterval(aInterval)
      bob.watchSeal({
        link: seal.link,
        basePubKey: alice.chainPubKey
      }, rethrow)
    })

    bob.on('readseal', seal => t.pass('bob read seal'))
    const aInterval = setInterval(() => alice.sync(), 100).unref()
    const bInterval = setInterval(() => bob.sync(), 100).unref()
  })
})

function rethrow (err) {
  if (err) throw err
}
