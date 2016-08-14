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
const users = require('./fixtures/users')
const PREVLINK = constants.PREVLINK
const PERMALINK = constants.PERMALINK
const MESSAGE_TYPE = constants.MESSAGE_TYPE
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

  let alice = contexts.nUsers(1)[0]
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

test('restart node', function (t) {
  let alice = contexts.nUsers(1)[0]
  alice.on('ready', function () {
    alice.destroy(function (err) {
      if (err) throw err

      alice = helpers.resurrect(alice)
      alice.on('ready', function () {
        t.pass()
        alice.destroy()
        t.end()
      })
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
      done => alice.objects.get({ link: result.link, body: false }, done),
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
    context.receiver.receive(utils.serializeMessage(msg), context.sender._recipientOpts, function (err) {
      t.ok(err)
      context.destroy()
      t.end()
    })
  })
})

test('do receive messages carrying already known objects', function (t) {
  t.timeoutAfter(1000)

  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    context.sender.signAndSend({
      object: context.object.object,
      to: context.receiver._recipientOpts
    }, rethrow)

    context.receiver.on('message', function (msg) {
      t.same(msg.object.object, context.object.object)
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

      newAuditor.on('newversion', _seal => {
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

          collect(friend1.conversation({ with: friend2.permalink }), function (err, msgs) {
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
        // test lookup API
        async.each(watches, function iterator (watch, done) {
          node.watches.findOne('address', watch.address, done)
        }, cb)
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

    const pairs = helpers.pairs(friends)
    const tasks = pairs.map(pair => {
      const obj = { [TYPE]: 'hey', message: pair[1].name }
      return cb => helpers.send(pair[0], pair[1], obj, cb)
    })
    // .reduce(function (arr, next) {
    //   return next ? arr.concat(next) : arr
    // }, [])
    // .filter(task => task) // filter out nulls

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
        taskCB => collect(alice.objects.messagesWithObject({ permalink: link, link: link }), taskCB),
        taskCB => collect(bob.objects.messagesWithObject({ permalink: link, link: link }), taskCB),
        taskCB => collect(carol.objects.messagesWithObject({ permalink: link, link: link }), taskCB)
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

test('object publish status', function (t) {
  // TODO: test prevLink
  contexts.twoFriendsSentReceivedSealed({ sealer: 'sender' }, function (err, context) {
    if (err) throw err

    async.parallel([
      function (done) {
        context.receiver.objectSealStatus(context.message, function (err, status) {
          if (err) throw err

          t.ok(status.link)
          t.ok(status.permalink)
          t.notOk(status.prevLink)
          t.ok(status.watches.link)
          t.ok(status.watches.permalink)
          t.notOk(status.watches.prevLink)
          done()
        })
      },
      function (done) {
        context.receiver.objectSealStatus({ object: context.message.object.object }, function (err, status) {
          if (err) throw err

          t.notOk(status.link)
          t.notOk(status.permalink)
          t.notOk(status.prevLink)
          t.notOk(status.watches.link)
          t.notOk(status.watches.permalink)
          t.notOk(status.watches.prevLink)
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

test('custom merkle', function (t) {
  // TODO: test prevLink
  const defaultMerkleOpts = protocol.DEFAULT_MERKLE_OPTS
  protocol.DEFAULT_MERKLE_OPTS = {
    leaf: function (a) {
      return new Buffer(a.data)
    },
    parent: function (a, b) {
      return Buffer.concat([a.hash, b.hash])
    }
  }

  const nodes = new Array(2).fill(null).map((n, i) => {
    const opts = helpers.userToOpts(users[i], helpers.names[i])
    return helpers.createNode(opts)
  })

  helpers.meet(nodes, function (err) {
    if (err) throw err

    helpers.connect(nodes)
    const alice = nodes[0]
    const bob = nodes[1]
    bob.on('message', function (m) {
      protocol.DEFAULT_MERKLE_OPTS = defaultMerkleOpts
      nodes.forEach(node => node.destroy())
      t.pass('received msg with custom merkling')
      t.end()
    })

    alice.signAndSend({
      to: bob._recipientOpts,
      object: { [TYPE]: 'hey', ho: 'yea!' }
    }, rethrow)
  })
})

// test.only('keeper missing file', function (t) {
//   contexts.twoFriendsSentReceived(function (err, context) {
//     if (err) throw err

//     context.sender.keeper.del(context.message.link, err => {
//       context.sender.objects.lastMessage({ to: context.receiver.permalink }, err => {
//         t.ok(err)
//         t.end()
//         context.destroy()
//       })
//     })
//   })
// })

test('versioning can only be done by previous author', function (t) {
  contexts.twoFriendsSentReceivedSealed({ sealer: 'sender' }, function (err, context) {
    if (err) throw err

    const sender = context.sender
    const receiver = context.receiver
    const v2 = utils.clone(context.message.object.object)
    v2[PREVLINK] = v2[PERMALINK] = protocol.linkString(v2)
    v2.z = v2.z ? 0 : 1
    async.parallel([
      taskCB => sender.sign({ object: v2 }, taskCB),
      taskCB => receiver.sign({ object: v2 }, taskCB)
    ], function (err, results) {
      if (err) throw err

      const valid = results[0].object
      const invalid = results[1].object
      async.parallel([
        taskCB => sender.validator.validate({ object: valid }, err => {
          t.error(err)
          taskCB(err)
        }),
        taskCB => sender.validator.validate({ object: invalid }, err => {
          t.ok(err)
          taskCB()
        })
      ], function (err, results) {
        if (err) throw err

        t.end()
        context.destroy()
      })
    })
  })
})

test('custom message props', function (t) {
  contexts.twoFriends(function (err, friends) {
    if (err) throw err

    helpers.connect(friends)

    const alice = friends[0]
    const bob = friends[1]
    alice.signAndSend({
      object: { [TYPE]: 'hey', 'ho': 'heyho' },
      to: bob._recipientOpts,
      other: {
        ooga: 'booga'
      }
    }, function (err, result) {
      if (err) throw err

      t.equal(result.message.object.ooga, 'booga')
    })

    bob.on('message', msg => {
      t.equal(msg.object.ooga, 'booga')
      t.end()
      friends.forEach(friend => friend.destroy())
    })
  })
})

test('send sealed', function (t) {
  contexts.twoFriendsSentReceivedSealed({ sealer: 'sender' }, function (err, context) {
    if (err) throw err

    context.sender.send({
      to: context.receiver._recipientOpts,
      link: context.sent.link,
      seal: true
    }, rethrow)

    context.receiver.watchSeal = function (seal) {
      t.equal(seal.link, context.sent.link)
      t.end()
      context.destroy()
    }
  })
})

test('update identity', function (t) {
  const users = contexts.nUsers(2)
  const alice = users[0]
  const bob = users[1]
  const oldIdentity = utils.clone(alice.identity)
  const newKey = utils.genKey({
    type: 'ec',
    curve: 'ed25519'
  }).set('purpose', 'goof off')

  async.series([
    testAlice,
    testBob
  ], err => {
    if (err) throw err

    t.end()
    users.forEach(u => u.destroy())
  })

  function testAlice (done) {
    const newIdentity = utils.clone(oldIdentity)
    newIdentity.pubkeys = newIdentity.pubkeys.slice()
    delete newIdentity[SIG]
    const keys = alice.keys.slice()

    keys.push(newKey)
    newIdentity.pubkeys.push(newKey.toJSON())
    alice.updateIdentity({
      keys: keys,
      identity: newIdentity
    }, err => {
      if (err) throw err

      t.same(newIdentity, protocol.body(alice.identity))
      alice.addressBook.lookupIdentity(newKey.toJSON(), function (err, result) {
        if (err) throw err

        t.same(protocol.body(result.object), newIdentity)
        alice.objects.byPermalink(alice.permalink, function (err, result) {
          t.error(err)
          t.equal(result.link, alice.link)
          done(null, newIdentity)
        })
      })
    })
  }

  function testBob (done) {
    bob.addContact(oldIdentity, err => {
      if (err) throw err

      bob.addContact(alice.identity, err => {
        if (err) throw err

        async.each([
          newKey.toJSON(),
          { permalink: alice.permalink }
        ], function iterator (identifier, onfound) {
          bob.addressBook.lookupIdentity(identifier, function (err, result) {
            if (err) throw err

            t.same(result.object, alice.identity)
            onfound()
          })
        }, done)
      })
    })
  }
})

test('receiving forwarded messages', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]

    let signed
    alice.signAndSend({
      object: {
        [TYPE]: 'thang',
        a: 1,
        b: 2
      },
      to: bob._recipientOpts,
    }, function (err, result) {
      signed = result.object.object
    })

    bob.on('message', wrapper => {
      carol.receive(wrapper.object, { permalink: wrapper.author }, function (err) {
        if (err) throw err

        collect(carol.objects.from({ eq: alice.permalink, body: true }), function (err, results) {
          if (err) throw err

          t.equal(results.length, 1)
          t.same(results[0].object.object, signed)
          t.end()
          friends.forEach(friend => friend.destroy())
        })
      })
    })
  })
})

test('pause per recipient', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]

    let signed
    friends.slice(1).forEach(friend => {
      alice.signAndSend({
        object: {
          [TYPE]: 'thang',
          hey: friend.name
        },
        to: friend._recipientOpts,
      }, function (err) {
        if (err) throw err
        if (friend !== bob) return

        for (var i = 0; i < n; i++) {
          resumes.push(alice.sender.pause(bob.permalink))
        }
      })
    })

    const bobPubKey = utils.pubKeyString(bob._recipientOpts.pubKey)

    // n times should work same as once
    const n = 5
    const resumes = []

    bob.on('message', badReceiver)

    carol.on('message', wrapper => {
      t.pass()
      setTimeout(function () {
        bob.removeListener('message', badReceiver)
        bob.on('message', goodReceiver)
        resumes.forEach(fn => fn())
      }, 1000)
    })

    function badReceiver () {
      t.fail()
    }

    function goodReceiver () {
      t.pass()
      t.end()
      // wait a bit to see if we get any duplicates
      bob.on('message', badReceiver)
      setTimeout(function () {
        t.pass()
        friends.forEach(friend => friend.destroy())
      }, 1000)
    }
  })
})

test.skip('pairing protocol', function (t) {
  const crypto = require('crypto')
  const devices = contexts.nUsers(2)
  const permalink = devices[0].permalink
  const deviceOneFlow = createDeviceOneFlow(devices[0])
  const deviceTwoFlow = createDeviceTwoFlow(devices[1])

  async.waterfall([
    deviceOneFlow.genPairingData,
    deviceTwoFlow.sendPairingRequest,
    deviceOneFlow.processPairingRequest,
    deviceTwoFlow.processPairingResponse,
  ], function (err) {
    if (err) throw err

    t.same(devices[0].identity, devices[1].identity)
    t.same(devices[0].permalink, permalink)
    t.same(devices[1].permalink, permalink)
    devices.forEach(u => u.destroy())
    t.end()
  })

  function createDeviceOneFlow (device) {

    let pairingData

    // needs sig?
    function genPairingData (done) {
      // TODO: use protocol buffers for this
      pairingData = {
        nonce: crypto.randomBytes(32).toString('base64'),
        identity: device.permalink,
        rendezvous: {
          url: 'wss://some.server.com'
        }
      }

      done(null, pairingData)
    }

    function processPairingRequest (pairingReq, done) {
      // find pairingData by pairingReq
      // maybe add a another nonce property to pairingData
      // (pairingData.nonce has to stay private)

      const verify = crypto.createHmac('sha256', pairingData.nonce)
      verify.update(utils.stringify(utils.omit(pairingReq, 'auth')))
      if (!verify.digest().equals(pairingReq.auth)) {
        return done(new Error('invalid PairingRequest'))
      }

      const prev = device.identity
      const allPubKeys = device.identity.pubkeys.concat(pairingReq.identity.pubkeys)
      device.updateIdentity({
        keys: device.keys.concat(pairingReq.identity.pubkeys),
        identity: utils.clone(device.identity, {
          pubkeys: allPubKeys.map(pk => utils.clone(pk))
        })
      }, err => {
        if (err) return done(err)

        const pairingRes = {
          [TYPE]: 'tradle.PairingResponse',
          // can we make it secure without sending prev?
          prev: prev,
          identity: device.identity
        }

        done(null, pairingRes)
      })
    }

    return {
      genPairingData,
      processPairingRequest
    }
  }

  function createDeviceTwoFlow (device) {

    let pairingData

    function sendPairingRequest (_pairingData, done) {
      pairingData = _pairingData

      // device 2 sends pairing request
      const pairingReq = {
        [TYPE]: 'tradle.PairingRequest',
        identity: device.identity
      }

      const hmac = crypto.createHmac('sha256', pairingData.nonce)
      hmac.update(utils.stringify(pairingReq))
      pairingReq.auth = hmac.digest()
      done(null, pairingReq)
    }

    function processPairingResponse (pairingRes, done) {
      // device 2 validate response
      if (utils.hexLink(pairingRes.prev) !== pairingData.identity) {
        return done(new Error('prev identity does not match expected'))
      }

      const hasMyKeys = device.identity.pubkeys.every(myKey => {
        return pairingRes.identity.pubkeys.some(theirKey => {
          return deepEqual(theirKey, myKey)
        })
      })

      if (!hasMyKeys) {
        return done(new Error('received identity does not have my keys'))
      }

      async.series([
        taskCB => device.addContact(pairingRes.prev, taskCB),
        // overwrite existing
        taskCB => device.addContact(pairingRes.identity, true, taskCB),
        taskCB => device.setIdentity({
          keys: device.keys.concat(pairingRes.identity.pubkeys),
          identity: pairingRes.identity
        }, taskCB)
      ], done)
    }

    return {
      sendPairingRequest,
      processPairingResponse
    }
  }
})

// test.only('3-tier', function (t) {
//   contexts.nFriends(3, function (err, friends) {
//     if (err) throw err

//     helpers.connect(friends)

//     const alice = friends[0]
//     const bob = friends[1]
//     const carol = friends[2]

//     let signed
//     alice.signAndSend({
//       object: {
//         [TYPE]: 'thang',
//         a: 1,
//         b: 2
//       },
//       to: bob._recipientOpts,
//     }, function (err, result) {
//       signed = result.object.object
//     })

//     bob.on('message', wrapper => {
//       bob.send({
//         link: wrapper.link,
//         to: carol._recipientOpts
//       }, rethrow)
//     })

//     carol.on('message', function (wrapper) {
//       if (wrapper.objectinfo.type !== MESSAGE_TYPE) return

//       carol.receive(wrapper.object.object, { permalink: wrapper.objectinfo.author }, function (err, wrapper) {
//         console.log(err || wrapper)
//       })
//     })
//   })
// })

function rethrow (err) {
  if (err) throw err
}
