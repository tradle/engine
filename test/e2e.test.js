require('./env')

// const WHY = require('why-is-node-running')
const path = require('path')
const { EventEmitter } = require('events')
const deepEqual = require('deep-equal')
const test = require('tape')
const memdown = require('memdown')
const async = require('async')
const collect = require('stream-collector')
const Cache = require('lru-cache')
const Wallet = require('@tradle/simple-wallet')
const testHelpers = require('@tradle/test-helpers')
// const kiki = require('@tradle/kiki')
const protocol = require('@tradle/protocol')
const {
  PREVLINK,
  PERMALINK,
  AUTHOR,
  SEQ,
  SIG,
  TYPE,
  TYPES,
} = require('@tradle/constants')
const defaults = require('../lib/defaults')
const utils = require('../lib/utils')
const helpers = require('./helpers')
const contexts = require('./contexts')
const Node = require('../lib/node')
const createSealer = require('../lib/sealer')
const createSender = require('../lib/sender')
const createMsgMetaDB = require('../lib/dbs/msgMeta')
const constants = require('../lib/constants')
const Partial = require('../lib/partial')
const Errors = require('../lib/errors')
const users = require('./fixtures/users')

const MESSAGE_TYPE = TYPES.MESSAGE
const retrystream = require('../lib/retrystream')
const SHORT_BACKOFF_OPTS = {
  initialDelay: 10,
  maxDelay: 1000
}

const LONG_BACKOFF_OPTS = {
  initialDelay: 60 * 1000 * 1000, // foreverish
  maxDelay: 60 * 1000 * 1000 * 1000
}

const { blocktime } = helpers

retrystream.DEFAULT_BACKOFF_OPTS =
createSender.DEFAULT_BACKOFF_OPTS =
createSealer.DEFAULT_BACKOFF_OPTS = SHORT_BACKOFF_OPTS

const names = helpers.names
const noop = () => {}
let INSTANCE_COUNT = 0

test('self in address book', function (t) {
  // TODO: should be stricter
  // self should be in addressBook immediately
  t.timeoutAfter(2000)

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
  const object = {
    [TYPE]: 'blah',
    a: 1
  }

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

test('`saveObject`', function (t) {
  t.timeoutAfter(1000)

  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    const [alice, bob] = friends
    const object = { [TYPE]: 'blah', a: 1 }
    alice.createObject({ object: utils.clone(object) }, function (err, result) {
      if (err) throw err

      bob.saveObject({ object: result.object }, function (err, result) {
        if (err) throw err

        t.equal(result.author, alice.permalink)
        t.end()
        friends.forEach(friend => friend.destroy())
        // t.equal(err.type, 'exists')
      })
    })
  })
})

// test('unchained self', function (t) {

// })

test('basic send/receive', function (t) {
  contexts.twoFriends(function (err, friends) {
    if (err) throw err

    const alice = friends[0]
    const bob = friends[1]
    const aInfo = { permalink: alice.identityInfo.permalink }
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
  t.timeoutAfter(2000)

  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    context.sender.send({
      link: context.message.objectinfo.link,
      to: context.receiver._recipientOpts
    }, rethrow)

    context.receiver.on('message', function (msg) {
      t.same(msg.object.object, context.object.object)
      context.destroy()
      t.end()
    })
  })
})

test('watch txId', function (t) {
  // t.timeoutAfter(blocktime * 10)
  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    const { friends, sent } = context
    const [sealer, watcher] = friends
    sealer.seal({
      object: sent.object,
      basePubKey: sealer.chainPubKey
    }, rethrow)

    // alice.seal(result.sent, rethrow)
    // bob.seal(result.message, rethrow)

    sealer.once('wroteseal', seal => {
      watcher.watchSeal({
        chain: {
          blockchain: seal.blockchain,
          networkName: seal.networkName
        },
        link: seal.link,
        headerHash: seal.headerHash,
        basePubKey: seal.basePubKey,
        txId: seal.txId,
        address: seal.sealAddress,
      }, rethrow)
    })

    watcher.on('readseal', seal => {
      if (seal.confirmations) {
        t.pass('confirmed seal watched via txId')
        context.destroy()
        t.end()
      }
    })
  })
})

test('sender seals', function (t) {
  // t.timeoutAfter(blocktime * 10)
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
  // t.timeoutAfter(blocktime * 10)
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
  // t.timeoutAfter(5000)
  contexts.twoFriendsSentReceivedSealed({ sealer: 'sender' }, function (err, context) {
    const dude = context.sender
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

if (helpers.network.blockchain !== 'ethereum') {
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
          chain: utils.networkToIdentifier(helpers.network),
          object: v1,
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
}

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
  const confirmedAfter = defaults.confirmedAfter
  defaults.confirmedAfter = 3

  contexts.twoFriendsSentReceivedSealed({ sealer: 'receiver' }, function (err, context) {
    if (err) throw err

    const { sender, receiver, friends } = context

    async.parallel(friends.map(node => {
      return function (cb) {
        async.parallel([
          done => checkWatch(node, 1, done),
          // make sure node syncs so next sync call
          // isn't amalgamated into the pending one
          done => node.sealwatch.once('sync', () => done())
        ], cb)
      }
    }), function (err) {
      if (err) throw err

      mintBlocks(defaults.confirmedAfter, rethrow)
      async.parallel(friends.map(node => {
        return done => node.once('readseal:confirmed', () => done())
      }), function (err) {
        if (err) throw err

        async.parallel(friends.map(node => {
          return done => checkWatch(node, 0, done)
        }), function (err) {
          if (err) throw err

          defaults.confirmedAfter = confirmedAfter
          context.destroy()
          t.end()
        })
      })
    })

    function mintBlocks (n, cb) {
      const network = sender.getBlockchainAdapter(utils.networkToIdentifier(helpers.network))
      network.api.on('block', next)

      function next () {
        if (--n === 0) {
          network.api.removeListener('block', next)
          cb()
        }
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

    async.parallel(tasks, function (err, results) {
      if (err) throw err

      const aliceAndBobLinks = [alice.permalink, bob.permalink].sort(alphabetical)
      const convo = results.filter(result => {
        const { message } = result
        const participants = [message.author, message.recipient].sort(alphabetical)
        return arraysEqual(participants, aliceAndBobLinks)
      })

      // this object should not be deleted
      // because it's shared with another party
      const sharedWithCarol = convo[0].object.link

      helpers.send(alice, carol, sharedWithCarol, function (err) {
        if (err) throw err

        collect(alice.objects.conversation({ with: bob.permalink }), function (err, c) {
          if (err) throw err

          t.equal(c.length, 2)

          // both messages and underlying objects should be forgotten
          const willBeForgotten = c.concat(c.map(item => item.objectinfo))
            .map(item => item.link)
            .filter(link => link !== sharedWithCarol)
            .sort(alphabetical)

          alice.forget(bob.permalink, function (err, forgotten) {
            if (err) throw err

            const links = forgotten
              .map(item => item.link)
              .filter(link => link !== sharedWithCarol)
              .sort(alphabetical)

            t.same(links, willBeForgotten)

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
              t.equal(conversations[1].length, 3)
              friends.forEach(friend => friend.destroy())
              t.end()
            })
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

    const { sender, receiver } = context
    sender.signAndSend({
      object: { [TYPE]: 'blah', a: 1 },
      to: receiver._recipientOpts
    }, function (err, result) {
      if (err) throw err

      t.equal(result.message.object[SEQ], 1)

      // next 10 seqs: 2, 3...
      const sequence = new Array(10).fill(0).map((n, i) => i + 2)
      async.map(sequence, function (i, done) {
        sender.signAndSend({
          object: { [TYPE]: 'blah', b: i },
          to: receiver._recipientOpts
        }, done)
      }, function (err, results) {
        if (err) throw err

        const seqs = results.map(r => r.message.object[SEQ])
        seqs.sort((a, b) => a - b)
        t.same(seqs, sequence)
        t.end()
        context.destroy()
      })
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

    const { sender, receiver } = context
    const v2 = protocol.nextVersion(context.message.object.object)
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
      t.equal(seal.headerHash, protocol.headerHash(context.sent.object))
      t.end()
      context.destroy()
    }
  })
})

newUpdateIdentityTest(false)
newUpdateIdentityTest(true)

function newUpdateIdentityTest (caching) {
  test(`update identity (caching:${caching})`, function (t) {
    const users = contexts.nUsers(2)
    if (caching) {
      users.forEach(u => {
        u.addressBook.setCache(new Cache({ max: Infinity }))
      })
    }

    const alice = users[0]
    const bob = users[1]
    const oldIdentity = utils.clone(alice.identity)
    const newKey = utils.genKey({
      type: 'ec',
      curve: 'p384'
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
      const keys = alice.keys.slice()

      keys.push(newKey)
      newIdentity.pubkeys.push(newKey.toJSON())
      alice.updateIdentity({
        keys: keys,
        identity: newIdentity
      }, err => {
        if (err) throw err

        t.same(newIdentity.pubkeys, alice.identity.pubkeys)
        alice.addressBook.lookupIdentity(newKey.toJSON(), function (err, result) {
          if (err) throw err

          t.same(result.object, alice.identity)
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
}

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

test('receive a third-party conversation', function (t) {
  contexts.nFriends(3, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)

    const alice = friends[0]
    const bob = friends[1]
    const carol = friends[2]
    // console.log('alice', alice.permalink)
    // console.log('bob', bob.permalink)
    // console.log('carol', carol.permalink)

    // let signedObj
    let signedMsg
    alice.signAndSend({
      object: {
        [TYPE]: 'thang',
        a: 1,
        b: 2
      },
      to: bob._recipientOpts,
    }, function (err, result) {
      if (err) throw err

      signedMsg = result.message.object
    })

    bob.on('message', wrapper => {
      bob.send({
        object: wrapper.object,
        to: carol._recipientOpts
      }, rethrow)
    })

    carol.on('message', function (wrapper) {
      collect(carol.conversation({
        a: alice.permalink,
        b: bob.permalink
      }), function (err, msgs) {
        if (err) throw err

        t.equal(msgs.length, 1)
        t.same(msgs[0].object, signedMsg)
        t.end()
        friends.forEach(f => f.destroy())
      })
    })
  })
})

test('custom indexes', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    const props = ['context']
    const alice = friends[0]
    const aliceContextDB = createMsgMetaDB({
      node: alice,
      db: 'msgMeta.db',
      props: props
    })

    const bob = friends[1]
    const bobContextDB = createMsgMetaDB({
      node: bob,
      db: 'msgMeta.db',
      props: props
    })

    helpers.connect(friends)

    let link
    let context = 'boo!'
    alice.signAndSend({
      to: bob._recipientOpts,
      object: {
        [TYPE]: 'something',
        hey: 'ho'
      },
      other: {
        context: context
      }
    }, function (err, result) {
      if (err) throw err

      link = result.message.link
    })

    bob.signAndSend({
      to: alice._recipientOpts,
      object: {
        [TYPE]: 'something',
        hey: 'ho'
      }
    }, rethrow)

    let togo = 2
    bob.on('message', process)
    alice.on('message', process)

    function process () {
      if (--togo) return

      collect(aliceContextDB.context('boo!'), function (err, msgs) {
        if (err) throw err

        t.equal(msgs.length, 1)
        t.equal(msgs[0].link, link)
        t.same(msgs[0].context, context)
        t.end()
        friends.forEach(f => f.destroy())
      })
    }
  })
})

test('partials', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)
    const [alice, bob] = friends

    const object = {
      [TYPE]: 'something',
      a : 'b',
      c: {
        d: 1,
      },
      e: true
    }

    alice.createObject({ object: utils.clone(object) }, function (err, result) {
      if (err) throw err

      const partial = Partial.from(result.object)
        .add({ property: TYPE, key: true, value: true })
        .add({ property: 'c', key: false, value: true })
        .build()

      alice.signAndSend({
        object: partial,
        to: bob._recipientOpts
      }, rethrow)
    })

    bob.on('message', function (msg) {
      const leaves = Partial.interpretLeaves(msg.object.object.leaves)
      t.same(leaves, [
        { key: TYPE, value: 'something' },
        { value: { d: 1 } }
      ])

      friends.forEach(friend => friend.destroy())
      t.end()
    })
  })
})

test('missing messages', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    const [alice, bob] = friends
    const skipped = []
    alice._send = function (msg, recipientInfo, cb) {
      const seq = msg.unserialized.seq
      // drop even-numbered messages
      if (seq % 2 === 1) {
        skipped.push(seq)
        return cb()
      }

      return bob.receive(msg, alice._recipientOpts, cb)
    }

    const msgs = new Array(20).fill(0).map((val, i) => {
      return {
        [TYPE]: 'something',
        message: 'hey bob' + i
      }
    })

    const to = bob._recipientOpts

    let togo = 10
    bob.on('message', function (msg) {
      if (--togo) return

      bob.objects.missingMessages({
        from: alice.permalink,
        gte: 0,
        tip: 20
      }, function (err, results) {
        if (err) throw err

        t.same(results, skipped.concat(20))
        t.end()
        friends.forEach(friend => friend.destroy())
      })
    })

    async.series(msgs.map(object => {
      return done => {
        alice.signAndSend({ to, object }, err => {
          if (err) throw err

          done()
          // setTimeout(done, 100)
        })
      }
    }), rethrow)
  })
})

test('abortMessage', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)
    const [alice, bob] = friends
    const skipped = []
    const seqs = [0, 1, 2, 3]
    const toSend = seqs.slice()

    alice._send = function (msg, recipientInfo, cb) {
      const seq = msg.unserialized.seq
      if (seq % 2 === 0) {
        cb(new Errors.WillNotSend())
      } else {
        cb()
      }
    }

    alice.on('sent', function (msg) {
      const seq = msg.object[SEQ]
      t.equal(seq % 2, 1)
      if (seq === seqs[seqs.length - 1]) {
        friends.forEach(friend => friend.destroy())
        t.end()
      }
    })

    function sendNext () {
      if (!toSend.length) return

      const seq = toSend.shift()
      alice.signAndSend({
        to: bob._recipientOpts,
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `hey bob ${seq}`
        }
      }, function (err) {
        if (err) throw err

        sendNext()
      })
    }

    sendNext()
  })
})

test('abortMessage from _send', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)
    const [alice, bob] = friends
    const skipped = []
    const seqs = [0, 1, 2, 3]
    const toSend = seqs.slice()

    alice._send = function (msg, recipientInfo, cb) {
      const seq = msg.unserialized.seq
      if (seq % 2 === 0) {
        cb(new Errors.WillNotSend())
      } else {
        cb()
      }
    }

    alice.on('sent', function (msg) {
      const seq = msg.object[SEQ]
      t.equal(seq % 2, 1)
      if (seq === seqs[seqs.length - 1]) {
        friends.forEach(friend => friend.destroy())
        t.end()
      }
    })

    function sendNext () {
      if (!toSend.length) return

      const seq = toSend.shift()
      alice.signAndSend({
        to: bob._recipientOpts,
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `hey bob ${seq}`
        }
      }, function (err) {
        if (err) throw err

        sendNext()
      })
    }

    sendNext()
  })
})

test('node.abortMessages', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)
    const [alice, bob] = friends
    const skipped = []
    const seqs = [0, 1, 2, 3, 4]
    const toSend = seqs.slice()
    const ee = new EventEmitter()
    let ready = false

    alice._send = function (msg, recipientInfo, cb) {
      if (msg.unserialized.seq === 0) {
        if (!ready) return ee.once('ready', abortStuff)

        abortStuff()
      } else {
        cb()
      }

      function abortStuff () {
        const toAbort = stubs.filter(({ to, link }, i) => i % 2 === 1)
        alice.abortMessages(toAbort, function (err) {
          if (err) throw err

          cb()
        })
      }
    }

    alice.on('sent', function (msg) {
      const seq = msg.object[SEQ]
      t.equal(seq % 2, 0)
      if (seq === seqs[seqs.length - 1]) {
        friends.forEach(friend => friend.destroy())
        t.end()
      }
    })

    const stubs = []
    seqs.forEach(seq => {
      alice.signAndSend({
        to: bob._recipientOpts,
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `hey bob ${seq}`
        }
      }, function (err, result) {
        if (err) throw err

        stubs.push({
          link: result.message.link,
          to: result.message.recipient
        })

        if (stubs.length === seqs.length) ee.emit('ready')
      })
    })
  })
})

test('node.abortUnsent', function (t) {
  contexts.nFriends(2, function (err, friends) {
    if (err) throw err

    helpers.connect(friends)
    const [alice, bob] = friends
    const skipped = []
    const seqs = [0, 1, 2, 3]
    const willDeliver = [4]
    const toSend = seqs.slice()
    const ee = new EventEmitter()
    let ready = false

    alice._send = function (msg, recipientInfo, cb) {
      if (msg.unserialized.seq === 0) {
        if (!ready) {
          return ee.once('ready', onReady)
        }

        onReady()
      } else {
        cb()
      }

      function onReady () {
        abortUnsent(() => cb(new Error('aborted')))
      }
    }

    alice.sender.pause()
    alice.on('sent', function (msg) {
      const seq = msg.object[SEQ]
      t.equal(seq, willDeliver.shift())
      if (!willDeliver.length) {
        friends.forEach(friend => friend.destroy())
        t.end()
      }
    })

    const stubs = []
    seqs.forEach(seq => {
      alice.signAndSend({
        to: bob._recipientOpts,
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `hey bob ${seq}`
        }
      }, function (err, result) {
        if (err) throw err

        stubs.push({
          link: result.message.link,
          to: result.message.recipient
        })

        if (stubs.length === seqs.length) {
          ee.emit('ready')
        }
      })
    })

    function abortUnsent (cb) {
      alice.abortUnsent({
        to: bob.permalink
      }, function (err, aborted) {
        if (err) throw err

        const expected = stubs.map(({ link }) => link)
        t.same(aborted, expected)
        alice.signAndSend({
          to: bob._recipientOpts,
          object: {
            [TYPE]: 'tradle.SimpleMessage',
            message: 'hey bob'
          }
        }, function (err) {
          if (err) throw err

          cb()
        })
      })
    }
  })
})

test('get by seq', function (t) {
  t.timeoutAfter(1000)

  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    const { sender, receiver } = context
    sender.signAndSend({
      object: {
        [TYPE]: 'sometype',
        a: 'b'
      },
      to: receiver._recipientOpts,
    }, rethrow)

    receiver.on('message', function () {
      async.map([
        { node: receiver, seq: 0 },
        { node: receiver, seq: 1 },
        { node: sender, seq: 0 },
        { node: sender, seq: 1 }
      ], function (input, done) {
        input.node.objects.getBySeq({
          from: sender.permalink,
          to: receiver.permalink,
          seq: input.seq
        }, function (err, val) {
          if (err) throw err

          t.equal(val.seq, input.seq),
          done()
        })
      }, err => {
        if (err) throw err

        context.destroy()
        t.end()
      })
    })
  })
})

function rethrow (err) {
  if (err) throw err
}

function alphabetical (a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function arraysEqual (a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i])
}
