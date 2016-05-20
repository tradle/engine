'use strict'

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
const fakeWallet = testHelpers.fakeWallet
const fakeKeeper = testHelpers.fakeKeeper
const DEFAULT_NETWORK_NAME = 'testnet'
const Tradle = require('../')
const noop = () => {}
let INSTANCE_COUNT = 0

test('basic', function (t) {
  let blockchain
  const tradles = users.slice(0, 2).map(user => {
    const node = createNode(userToOpts(user))

    if (!blockchain) blockchain = node.blockchain

    return node
  })

  const alice = tradles[0]
  const bob = tradles[1]
  connect([alice, bob])
  meet([alice, bob], err => {
    if (err) throw err

    setTimeout(function () {
      alice._ixf.index.createReadStream('type', {eq:'tradle.Identity'})
      .on('data', console.log)
    }, 200)

    // const obj = {
    //   a: 1,
    //   b: 2
    // }

    // alice.sign(obj, err => {
    //   if (err) throw err

    //   setTimeout(function () {
    //     alice.send(obj, {
    //       recipient: bob._recipientOpts,
    //     }, err => {
    //       if (err) throw err
    //     })
    //   }, 1000)
    // })

    alice.on('sent', info => {
      t.same(info.object, obj)
    })

    bob.on('message', info => {
      t.same(info.object, obj)
      t.end()
    })
  })
})

// function fakechain () {
//   const blocks = []
//   return {
//     addresses: {
//       transactions: function (addrs, blockHeight, cb) {

//       }
//     },
//     transactions: {
//       propagate: function (tx, cb) {

//       }
//     },
//     unspents:
//   }
// }

function createNode (opts) {
  const networkName = opts.networkName || DEFAULT_NETWORK_NAME
  const wallet = opts.wallet || walletFor(opts.keys, opts.blockchain)
  const blockchain = opts.blockchain || wallet.blockchain
  opts = extend(opts, {
    dir: opts.dir || nextDir(),
    keeper: fakeKeeper.empty(),
    networkName: networkName,
    transactor: Wallet.transactor({ wallet }),
    blockchain: blockchain,
    leveldown: opts.leveldown || memdown,
  })

  return new Tradle(opts)
}

function walletFor (keys, blockchain) {
  var unspents = []
  for (var i = 0; i < 20; i++) {
    unspents.push(100000)
  }

  return fakeWallet({
    blockchain: blockchain,
    unspents: unspents,
    priv: utils.find(keys, key => {
      return key.type() === 'bitcoin' && key.get('purpose') === 'messaging'
    }).priv()
  })
}

function nextDir () {
  return `./testdir/${INSTANCE_COUNT++}.db`
}

function connect (people) {
  eachOther(people, function receiveOnSend (a, b) {
    a._send = function (recipientLink, msg, recipient, cb) {
      b.receive(msg, recipient, cb)
    }
  })
}

function meet (people, cb) {
  eachOther(people, (a, b, done) => a.addContact(b.identity, done), cb)
}

function eachOther (args, fn, cb) {
  async.parallel(args.map(a => {
    return done => {
      args.forEach(b => {
        if (a !== b) {
          fn(a, b, done)
        }
      })
    }
  }), cb || noop)
}

function userToOpts (user) {
  return {
    identity: user.pub,
    keys: user.priv.map(key => kiki.toKey(key))
  }
}
