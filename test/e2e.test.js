'use strict'

// const WHY = require('why-is-node-running')
const deepEqual = require('deep-equal')
const test = require('tape')
const extend = require('xtend')
const memdown = require('memdown')
const async = require('async')
const collect = require('stream-collector')
const Wallet = require('@tradle/simple-wallet')
const testHelpers = require('@tradle/test-helpers')
const kiki = require('@tradle/kiki')
const protocol = require('@tradle/protocol')
const defaults = require('../lib/defaults')
const utils = require('../lib/utils')
const helpers = require('./helpers')
const contexts = require('./contexts')
const Node = require('../lib/node')
const constants = require('../lib/constants')
const PREVLINK = constants.PREVLINK
const TYPE = constants.TYPE
const retrystream = require('../lib/retrystream')
const SHORT_BACKOFF_OPTS = {
  initialDelay: 10,
  maxDelay: 1000
}

const LONG_BACKOFF_OPTS = {
  initialDelay: 60 * 1000 * 1000, // foreverish
  maxDelay: 60 * 1000 * 1000 * 1000
}

retrystream.DEFAULT_BACKOFF_OPTS = SHORT_BACKOFF_OPTS
const names = helpers.names
const noop = () => {}
let INSTANCE_COUNT = 0

test('self in address book', function (t) {
  // TODO: should be stricter
  // self should be in addressBook immediately
  t.timeoutAfter(1000)

  const alice = contexts.nUsers(1)[0]
  alice.actions.once('addcontact', function () {
    alice.addressBook.lookupIdentity(alice.identityInfo.link, function (err, identityInfo) {
      if (err) throw err

      delete identityInfo.timestamp
      // log entry identifier
      delete identityInfo._
      t.same(alice.identityInfo, identityInfo)
      alice.destroy()
      t.end()
    })
  })
})

test('`createObject`', function (t) {
  t.plan(5)
  t.timeoutAfter(1000)

  const alice = contexts.nUsers(1)[0]
  const object = { [TYPE]: 'blah', a: 1 }
  alice.actions.on('newobj', () => t.pass())
  alice.createObject({ object: utils.clone(object) }, err => {
    if (err) throw err

    alice.createObject({ object: utils.clone(object) }, err => {
      t.ok(err)
      t.equal(err.type, 'exists')
      alice.destroy()
      t.end()
    })
  })

  alice.createObject({ object: utils.clone(object) }, err => {
    t.ok(err)
    t.equal(err.type, 'saving')
    // t.equal(err.type, 'exists')
  })
})

// test('unchained self', function (t) {

// })

test('basic send/receive', function (t) {
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

test('don\'t receive duplicates', function (t) {
  t.timeoutAfter(1000)

  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    const msg = context.message.object
    context.receiver.receive(protocol.serializeMessage(msg), context.sender._recipientOpts, function (err) {
      t.ok(err)
      context.destroy()
      t.end()
    })
  })
})

test('sender seals', function (t) {
  t.timeoutAfter(1000)
  contexts.twoFriendsSentReceivedSealed({ sealer: 'sender' }, function (err, context) {
    if (err) throw err

    const links = [
      context.sent.link,
      context.message.link,
      context.readseal.link,
      context.wroteseal.link
    ]

    t.ok(links.every(link => link === links[0]))

    context.destroy()
    t.pass('wrote & read seal')
    t.end()
  })
})

test('receiver seals', function (t) {
  t.timeoutAfter(1000)
  contexts.twoFriendsSentReceivedSealed({ sealer: 'receiver' }, function (err, context) {
    if (err) throw err

    const links = [
      context.sent.link,
      context.message.link,
      context.readseal.link,
      context.wroteseal.link
    ]

    t.ok(links.every(link => link === links[0]))

    context.destroy()
    t.pass('wrote & read seal')
    t.end()
  })
})

test('`readseal` emitted once', function (t) {
  t.timeoutAfter(1000)
  contexts.twoFriendsSentReceivedSealed({ sealer: 'sender' }, function (err, context) {
    const dude = context.sender
    for (var i = 0; i < dude.confirmedAfter; i++) {
      dude.blockchain._advanceToNextBlock()
    }

    context.friends.forEach(node => node.on('readseal', t.fail))
    async.each(context.friends, function iterator (node, done) {
      node.sync(function () {
        t.pass()
        setTimeout(done, 200)
      })
    }, function (err) {
      if (err) throw err

      context.destroy()
      t.end()
    })
  })
})

test('detect next version', function (t) {
  // t.timeoutAfter(1000)
  const v1 = {
    [TYPE]: 'blah',
    a: 1
  }

  contexts.twoFriendsSentReceivedSealed({ object: v1, sealer: 'sender' }, function (err, context) {
    if (err) throw err

    const v1link = protocol.link(v1, 'hex')
    const v2 = protocol.nextVersion(v1, v1link)
    v2.a = 2

    const newSealer = context.sender
    const newAuditor = context.receiver
    newSealer.createObject({ object: v2 }, err => {
      if (err) throw err

      // utils.logify(utils, 'pubKeyToAddress', true)
      let seal
      newSealer.seal({ object: v2 }, rethrow)
      newSealer.on('wroteseal', _seal => seal = _seal)
      newSealer.on('readseal', done)

      newAuditor.watchNextVersion({
        link: v1link,
        basePubKey: newSealer.chainPubKey
      }, rethrow)

      newAuditor.on('newversionseal', _seal => {
        t.equal(_seal.sealPrevAddress, seal.sealPrevAddress)
        t.equal(_seal.prevLink, seal.prevLink)
        done()
      })

      const sealerInterval = setInterval(() => newSealer.sync(), 100).unref()
      const auditorInterval = setInterval(() => newAuditor.sync(), 100).unref()
      let togo = 2

      function done () {
        if (--togo) return

        clearInterval(sealerInterval)
        clearInterval(auditorInterval)
        context.destroy()
        t.end()
      }
    })
  })
})

test('conversation', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)
    const pairs = helpers.pairs(friends)
    const tasks = pairs.map(pair => {
      const obj = {
        [TYPE]: 'blah',
        from: pair[0].name,
        to: pair[1].name
      }

      return function (done) {
        helpers.send(pair[0], pair[1], obj, done)
      }
    })

    async.parallel(tasks, function (err) {
      if (err) throw err

      const tasks = pairs.map(pair => {
        return function getConversation (done) {
          const friend1 = pair[0]
          const friend2 = pair[1]

          friend1.conversation(friend2.permalink, function (err, msgs) {
            if (err) return done(err)

            t.equal(msgs.length, 2)
            const objs = msgs.map(m => m.object.object)

            t.ok(objs.some(o => {
              return o.from === friend1.name && o.to === friend2.name
            }))

            t.ok(objs.some(o => {
              return o.from === friend2.name && o.to === friend1.name
            }))

            done()
          })
        }
      })

      async.parallel(tasks, err => {
        if (err) throw err

        friends.forEach(friend => friend.destroy())
        t.end()
      })
    })
  })
})

test('delete watch after X confirmed', function (t) {
  t.timeoutAfter(2000)
  const confirmedAfter = defaults.confirmedAfter
  defaults.confirmedAfter = 3

  contexts.twoFriendsSentReceivedSealed({ sealer: 'receiver' }, function (err, context) {
    if (err) throw err

    const sender = context.sender
    const receiver = context.receiver
    const blockchain = sender.blockchain

    async.parallel(context.friends.map(node => {
      return done => checkWatch(node, 1, done)
    }), function (err) {
      if (err) throw err

      makeBlocks()
      async.parallel(context.friends.map(node => {
        return done => node.sync(done)
      }), function (err) {
        if (err) throw err

        async.parallel(context.friends.map(node => {
          return done => checkWatch(node, 0, done)
        }), function (err) {
          if (err) throw err

          defaults.confirmedAfter = confirmedAfter
          context.destroy()
          t.end()
        })
      })
    })

    function makeBlocks () {
      // advance blockchain till we have enough confirmations
      for (var i = 0; i < defaults.confirmedAfter; i++) {
        blockchain._advanceToNextBlock()
      }
    }

    function checkWatch (node, expected, cb) {
      node.watches.list(function (err, watches) {
        if (err) throw err

        t.equal(watches.length, expected)
        if (cb) cb()
      })
    }
  })
})

test.skip('forget', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]

    helpers.connect([alice, bob, carol])

    const sendTasks = friends.map(friend1 => {
      return friends.map(friend2 => {
        if (friend1 !== friend2) {
          const obj = { [TYPE]: 'hey', message: friend2.name }
          return function (cb) {
            helpers.send(friend1, friend2, obj, cb)
          }
        }
      })
    })
    .reduce(function (arr, next) {
      return arr.concat(next)
    }, [])

    async.parallel(tasks, function (err) {
      if (err) throw err

      collect(alice.objects.conversation(alice.permalink, bob.permalink), function (err, c) {
        if (err) throw err

        t.equal(c.length, 2)
        alice.forget(bob.permalink, function (err) {
          if (err) throw err

          async.parallel([
            function aliceAndBob (done) {
              collect(alice.objects.conversation(alice.permalink, bob.permalink), done)
            },
            function aliceAndCarol (done) {
              collect(alice.objects.conversation(alice.permalink, carol.permalink), done)
            }
          ], function (err, conversations) {
            if (err) throw err

            t.equal(conversations[0].length, 0)
            t.equal(conversations[1].length, 2)
            friends.forEach(friend => friend.destroy())
            t.end()
          })
        })
      })
    })
  })
})

function rethrow (err) {
  if (err) throw err
}
