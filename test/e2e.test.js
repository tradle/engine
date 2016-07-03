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
// const kiki = require('@tradle/kiki')
const protocol = require('@tradle/protocol')
const defaults = require('../lib/defaults')
const utils = require('../lib/utils')
const helpers = require('./helpers')
const contexts = require('./contexts')
const Node = require('../lib/node')
const createSealer = require('../lib/sealer')
const createSender = require('../lib/sender')
const constants = require('../lib/constants')
const PREVLINK = constants.PREVLINK
const SEQ = constants.SEQ
const SIG = constants.SIG
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

retrystream.DEFAULT_BACKOFF_OPTS =
createSender.DEFAULT_BACKOFF_OPTS =
createSealer.DEFAULT_BACKOFF_OPTS = SHORT_BACKOFF_OPTS

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
  t.timeoutAfter(1000)

  const alice = contexts.nUsers(1)[0]
  const object = { [TYPE]: 'blah', a: 1 }
  alice.actions.on('newobj', () => t.pass())
  alice.createObject({ object: utils.clone(object) }, function (err, result) {
    if (err) throw err

    async.parallel([
      done => alice.objects.get(result.link, done),
      done => alice.keeper.get(result.link, done)
    ], err => {
      if (err) throw err

      alice.destroy()
      t.end()
    })
  })

  // alice.createObject({ object: utils.clone(object) }, err => {
  //   t.ok(err)
  //   t.equal(err.type, 'saving')
  //   // t.equal(err.type, 'exists')
  // })
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

    let sent
    alice.signAndSend({
      object: obj,
      to: bob._recipientOpts,
    }, function (err, result) {
      if (err) throw err

      sent = result.object.object
    })

    alice.on('sent', wrapper => {
      t.same(wrapper.object.object, sent)
    })

    bob.on('message', wrapper => {
      t.same(wrapper.object.object, sent)

      alice.destroy()
      bob.destroy()
      t.end()
    })
  })
})

test('get unsent to recipient', function (t) {
  t.timeoutAfter(1000)

  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]
    helpers.connect(friends)

    const obj = { [TYPE]: 'hey', message: 'ho' }
    alice.signAndSend({ object: obj , to: bob._recipientOpts }, err => {
      if (err) throw err

      async.parallel([
        done => collect(alice.objects.unsentTo(bob.permalink), done),
        done => collect(alice.objects.unsentTo(carol.permalink), done),
        done => collect(bob.objects.unsentTo(alice.permalink), done)
      ], function (err, results) {
        if (err) throw err

        t.equal(results[0].length, 1)
        t.equal(results[1].length, 0)
        t.equal(results[2].length, 0)
        friends.forEach(friend => friend.destroy())
        t.end()
      })
    })
  })
})

test('don\'t receive duplicate messages', function (t) {
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

// test.only('do receive messages carrying already known objects', function (t) {
//   t.timeoutAfter(1000)

//   const unsigned = {
//     [TYPE]: 'blah',
//     a: 1,
//     b: 2
//   }

//   contexts.twoFriendsSentReceived(unsigned, function (err, context) {
//     if (err) throw err

//     context.received.receive(, context.sender._recipientOpts, rethrow)

//     context.receiver.on('message', function (msg) {
//       t.same(msg.object.object, context.object.object)
//       context.destroy()
//       t.end()
//     })
//   })
// })

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
  t.timeoutAfter(2000)
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
  let v1 = {
    [TYPE]: 'blah',
    a: 1
  }

  contexts.twoFriendsSentReceivedSealed({ object: v1, sealer: 'sender' }, function (err, context) {
    if (err) throw err

    v1 = context.object.object // signed
    const v1link = protocol.linkString(v1)
    let v2 = protocol.nextVersion(v1, v1link)
    v2.a = 2

    const newSealer = context.sender
    const newAuditor = context.receiver
    newSealer.createObject({ object: v2 }, function (err, result) {
      if (err) throw err

      v2 = result.object // signed
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

          friend1.conversation({ with: friend2.permalink }, function (err, msgs) {
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

test('forget', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]

    helpers.connect([alice, bob, carol])

    const tasks = friends.map(friend1 => {
      return friends.map(friend2 => {
        if (friend1 !== friend2) {
          const obj = { [TYPE]: 'hey', message: friend2.name }
          return cb => helpers.send(friend1, friend2, obj, cb)
        }
      })
    })
    .reduce(function (arr, next) {
      return next ? arr.concat(next) : arr
    }, [])
    .filter(task => task) // filter out nulls

    async.parallel(tasks, function (err) {
      if (err) throw err

      collect(alice.objects.conversation({ with: bob.permalink }), function (err, c) {
        if (err) throw err

        t.equal(c.length, 2)
        alice.forget(bob.permalink, function (err, forgotten) {
          if (err) throw err

          t.equal(forgotten.length, 2)
          async.parallel([
            function aliceAndBob (done) {
              collect(alice.objects.conversation({ with: bob.permalink }), done)
            },
            function aliceAndCarol (done) {
              collect(alice.objects.conversation({ with: carol.permalink }), done)
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

test('last', function (t) {
  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    const msg = context.message.object
    async.parallel([
      function (done) {
        context.sender.objects.lastMessage({ to: context.receiver.permalink }, function (err, last) {
          t.error(err)
          t.same(last.object, msg)
          done()
        })
      },
      function (done) {
        context.receiver.objects.lastMessage({ from: context.sender.permalink }, function (err, last) {
          t.error(err)
          t.same(last.object, msg)
          done()
        })
      },
      function (done) {
        context.receiver.objects.lastMessage({ to: context.sender.permalink }, function (err, last) {
          t.ok(err)
          done()
        })
      },
      function (done) {
        context.sender.objects.lastMessage({ from: context.receiver.permalink }, function (err, last) {
          t.ok(err)
          done()
        })
      }
    ], err => {
      if (err) throw err

      context.destroy()
      t.end()
    })
  })
})

test('message sequencing', function (t) {
  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    const sender = context.sender
    const receiver = context.receiver
    sender.signAndSend({
      object: { [TYPE]: 'blah', a: 1 },
      to: receiver._recipientOpts
    }, function (err, result) {
      if (err) throw err

      context.destroy()
      t.equal(result.message.object[SEQ], 1)
      t.end()
    })
  })
})

test('messagesWithObject', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]
    const unsigned = {
      [TYPE]: 'whatever',
      hey: 'ho'
    }

    let link
    alice.sign({ object: unsigned }, function (err, result) {
      if (err) throw err

      const object = result.object
      link = protocol.linkString(object)
      async.series([
        taskCB => alice.send({ object, to: bob._recipientOpts }, taskCB),
        taskCB => bob.send({ object, to: carol._recipientOpts }, taskCB),
        taskCB => carol.send({ object, to: alice._recipientOpts }, taskCB)
      ], function (err, results) {
        if (err) throw err

        // send same object
        alice.send({ link, to: bob._recipientOpts }, rethrow)
      })
    })

    let togo = 2
    bob.on('message', msg => {
      if (--togo) return

      async.parallel([
        taskCB => alice.objects.messagesWithObject({ permalink: link, link: link }, taskCB),
        taskCB => bob.objects.messagesWithObject({ permalink: link, link: link }, taskCB),
        taskCB => carol.objects.messagesWithObject({ permalink: link, link: link }, taskCB)
      ], function (err, results) {
        if (err) throw err

        t.equal(results[0].length, 3)
        t.equal(results[1].length, 3)
        t.equal(results[2].length, 2)

        friends.forEach(friend => friend.destroy())
        t.end()
      })
    })
  })
})

// TODO: get this working without timeout
test.skip('update identity', function (t) {
  const alice = contexts.nUsers(1)[0]
  const newIdentity = utils.clone(alice.identity)
  newIdentity.pubkeys = newIdentity.pubkeys.slice()
  delete newIdentity[SIG]

  const keys = alice.keys.slice()
  const newKey = utils.genKey({
    type: 'ec',
    curve: 'ed25519'
  }).set('purpose', 'goof off')

  keys.push(newKey)
  newIdentity.pubkeys.push(newKey.toJSON())
  // setTimeout(() => {
  alice.updateIdentity({
    keys: keys,
    identity: newIdentity
  }, err => {
    t.error(err)

    // alice.destroy()
    t.same(newIdentity, protocol.body(alice.identity))
    alice.addressBook.lookupIdentity(newKey.toJSON(), function (err, result) {
      t.error(err)

      // alice.destroy()
      t.same(protocol.body(result.object), newIdentity)
      alice.objects.byPermalink(result.permalink, function (err, result) {
        t.error(err)
        t.end()
        alice.destroy()
      })
    })
  })
  // }, 100)
})

function rethrow (err) {
  if (err) throw err
}
