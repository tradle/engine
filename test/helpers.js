const deepEqual = require('deep-equal')
const LEVELDOWN = require('memdown')
const changesFeed = require('@tradle/changes-feed')
const async = require('async')
const randomName = require('random-name')

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
const { BLOCKCHAIN='bitcoin' } = process.env
const networkHelpers = BLOCKCHAIN === 'bitcoin'
  ? require('./bitcoin-helpers')
  : require('./ethereum-helpers')

const { blocktime } = require('./constants')
const { network, transactor, createAPI } = networkHelpers
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

exports.nextDB = function nextDB (opts={}) {
  if (!opts.leveldown) opts.db = LEVELDOWN
  return utils.levelup(helpers.nextDBName(), opts)
}

exports.keeper = exports.nextDB

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

      b.receive(msg.object, myInfo, function (err) {
        if (err) throw err

        cb.apply(null, arguments)
      })
    }
  })
}

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

exports.transactor = function ({ keys }) {
  const privateKey = keys.find(key => {
    const json = key.toJSON ? key.toJSON(true) : key
    if (json.purpose !== 'messaging') {
      return false
    }
    if (json.type !== network.blockchain) {
      return false
    }
    if (json.networkName !== network.name) {
      return false
    }
    return true
  })

  return transactor({ privateKey })
}

exports.createAPI = createAPI
exports.network = network
exports.blocktime = blocktime

exports.createNode = function createNode (opts) {
  let {
    keys,
    leveldown=LEVELDOWN,
    syncInterval=blocktime
  } = opts

  const blockchainAdapter = opts.network || network
  const keeper = opts.keeper || helpers.keeper()
  const transactor = opts.transactor || helpers.transactor({ keys })
  const dir = opts.dir || helpers.nextDir()
  opts = utils.extend(opts, {
    dir,
    keeper,
    getBlockchainAdapter: () => blockchainAdapter,
    transactor,
    leveldown,
    syncInterval
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
    'network', 'getBlockchainAdapter', 'keeper', 'dir', 'leveldown',
    'identity', 'keys', 'name'
  ))
}

exports.genUsers = function genUsers (opts, n, cb) {
  if (typeof opts === 'number') {
    cb = n
    n = opts
    opts = {
      networks: {
        bitcoin: ['testnet', 'bitcoin'],
        ethereum: 'rinkeby'
      }
    }
  }

  const tmp = new Array(n).fill(0)
  async.map(tmp, function iterator (blah, done) {
    utils.newIdentity(opts, done)
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
  if (err.__error) console.log(err.__error.stack)

  throw err
})

function rethrow (err) {
  if (err) throw err
}
