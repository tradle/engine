const crypto = require('crypto')
const deepEqual = require('deep-equal')
const leveldown = require('memdown')
const changesFeed = require('changes-feed')
const async = require('async')
const randomName = require('random-name')
const fakeWallet = require('@tradle/test-helpers').fakeWallet
const Wallet = require('@tradle/simple-wallet')
// const kiki = require('@tradle/kiki')
// const nkey = require('nkey-ec')
const utils = require('../lib/utils')
const constants = require('../lib/constants')
const Node = require('../lib/node')
const names = [
  'alice', 'bob', 'carol',
  'david', 'eve', 'falstaff',
  'ganondorf', 'pooh', 'piglet',
  'karlsson', 'athos', 'portos',
  'aramis', 'd\'Artgagnan', 'sheldon'
]

const TYPE = constants.TYPE
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const DEFAULT_NETWORK_NAME = 'testnet'
const helpers = exports
const noop = function () {}
let dbCounter = 0
let INSTANCE_COUNT = 0

exports.names = names
exports.nextDBName = function nextDBName () {
  return 'db' + (dbCounter++)
}

exports.nextFeed = function nextFeed () {
  return changesFeed(helpers.nextDB())
}

exports.nextDB = function nextDB (opts) {
  opts = opts || {}
  if (!opts.leveldown) opts.db = leveldown
  return utils.levelup(helpers.nextDBName(), opts)
}

exports.keeper = function () {
  var db = helpers.nextDB()
  // var map = {}
  // db._memory = map
  // db.on('batch', function (batch) {
  //   console.log('put batch')
  // })

  // db.on('put', function (key, value) {
  //   map[key] = value
  //   console.log('put row', key)
  // })

  return db
}

exports.dummyIdentity = function (authorLink) {
  return {
    object: {
      [TYPE]: IDENTITY_TYPE,
      pubkeys: []
    },
    link: authorLink,
    permalink: authorLink
  }
}

exports.transactor = function (key, blockchain) {
  const wallet = helpers.wallet(key, blockchain)
  const transactor = Wallet.transactor({ wallet })
  transactor.blockchain = wallet.blockchain
  return transactor
}

exports.wallet = function (key, blockchain) {
  var unspents = []
  for (var i = 0; i < 20; i++) {
    unspents.push(100000)
  }

  return fakeWallet({
    blockchain: blockchain,
    unspents: unspents,
    priv: key
  })
}

exports.pairs = function pairs (arr) {
  return arr.map(a => {
    return arr.filter(b => b !== a).map(b => [a, b])
  })
  .reduce((all, next) => all.concat(next))
}

exports.connect = function connect (nodes) {
  nodes.forEach(a => {
    const myInfo = { permalink: a.identityInfo.link }
    a._send = function (msg, recipient, cb) {
      const b = utils.find(nodes, a => {
        return a.permalink === recipient.permalink
      })

      b.receive(msg, myInfo, function (err) {
        if (err) throw err

        cb.apply(null, arguments)
      })
    }
  })
}

// exports.connect = function connect (people) {
//   helpers.eachOther(people, function receiveOnSend (a, b) {
//     var aInfo = { link: a.identityInfo.link }
//     a._send = function (msg, recipient, cb) {
//       b.receive(msg, aInfo, function (err) {
//         if (err) throw err

//         cb.apply(null, arguments)
//       })
//     }
//   })
// }

exports.meet = function meet (people, cb) {
  helpers.eachOther(people, function meet (a, b, done) {
    a.addContact(b.identity, done)
  }, cb)
}

exports.eachOther = function eachOther (args, fn, cb) {
  async.each(args, function (a, done) {
    const rest = [].filter.call(args, b => b !== a)
    async.each(rest, function (b, done) {
      fn(a, b, done)
    }, done)
  }, cb || noop)
}

exports.userToOpts = function userToOpts (user, name) {
  return {
    identity: user.identity,
    keys: user.keys.map(k => utils.importKey(k)),
    name: name
  }
}

exports.createNode = function createNode (opts) {
  const networkName = opts.networkName || DEFAULT_NETWORK_NAME
  const priv = utils.chainKey(opts.keys).privKeyString
  const transactor = opts.transactor || helpers.transactor(priv, opts.blockchain)
  const blockchain = opts.blockchain || transactor.blockchain
  opts = utils.extend(opts, {
    dir: opts.dir || helpers.nextDir(),
    keeper: helpers.keeper(),
    networkName: networkName,
    transactor: transactor,
    blockchain: blockchain,
    leveldown: opts.leveldown || leveldown,
  })

  return new Node(opts)
}

exports.send = function send (from, to, object, cb) {
  if (typeof object === 'function') {
    cb = object
    object = null
  }

  object = object || { [TYPE]: 'blah', a: 1 }
  const opts = {
    author: from._senderOpts,
    to: to._recipientOpts
  }

  let method
  if (typeof object === 'string') {
    opts.link = object
    method = 'send'
  } else {
    opts.object = object
    method = 'signAndSend'
  }

  from[method](opts, function (err, result) {
    if (err) throw err

    from.on('sent', onsent)
    to.on('message', onreceived)
    let togo = 2

    function onsent (msg) {
      if (deepEqual(msg.object, result.message.object)) {
        // console.log('sent', msg.object.object)
        from.removeListener('sent', onsent)
        done()
      }
    }

    function onreceived (msg) {
      if (deepEqual(msg.object, result.message.object)) {
        // console.log('received', msg.object.object)
        to.removeListener('message', onreceived)
        done()
      }
    }

    function done () {
      if (--togo === 0) {
        cb(null, result)
      }
    }
  })
}

exports.nextDir = function nextDir () {
  return `./testdir/${INSTANCE_COUNT++}.db`
}

exports.resurrect = function (deadNode) {
  return helpers.createNode(utils.pick(deadNode,
    'networkName', 'blockchain', 'keeper', 'transactor', 'dir', 'leveldown',
    'identity', 'keys', 'name'
  ))
}

exports.genUsers = function genUsers (n, cb) {
  const tmp = new Array(n).fill(0)

  async.map(tmp, function iterator (blah, done) {
    utils.newIdentity({ networkName: 'testnet' }, done)
  }, function (err, results) {
    if (err) return cb(err)

    results.forEach(r => {
      const first = randomName.first()
      const last = randomName.last()
      r.profile = {
        name: {
          firstName: first,
          lastName: last,
          formatted: first + ' ' + last
        }
      }

      r.keys = r.keys.map(k => k.toJSON(true))
    })

    cb(null, results)
  })
}

process.on('uncaughtException', function (err) {
  if (err.tfError) console.log(err.tfError.stack)

  throw err
})

function rethrow (err) {
  if (err) throw err
}
