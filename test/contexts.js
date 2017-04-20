const async = require('async')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
let users = require('./fixtures/users')
const helpers = require('./helpers')
const contexts = exports

exports.nUsers = function nUsers (n) {
  let blockchain
  if (users.length < n) throw new Error('not enough users in fixtures')
  if (helpers.names.length < n) throw new Error('not enough names in fixtures')

  const batch = users.slice(0, n)
  users = users.slice(n)
  return batch.slice(0, n).map((user, i) => {
    const opts = helpers.userToOpts(user, helpers.names[i])
    opts.blockchain = blockchain

    const node = helpers.createNode(opts)

    if (!blockchain) blockchain = node.blockchain

    return node
  })
}

exports.twoUsers = function twoUsers () {
  return contexts.nUsers(2)
}

exports.nFriends = function nFriends (n, cb) {
  const friends = contexts.nUsers(n)
  helpers.meet(friends, err => {
    if (err) return cb(err)

    cb(null, friends)
  })
}

exports.twoFriends = function twoFriends (cb) {
  exports.nFriends(2, cb)
}

exports.twoFriendsSentReceived = function (object, cb) {
  if (typeof object === 'function') {
    cb = object
    object = null
  }

  object = object || {
    [TYPE]: 'thang',
    a: 1,
    b: 2
  }

  let blockchain
  contexts.twoFriends(function (err, friends) {
    if (err) return cb(err)

    const sender = friends[0]
    const receiver = friends[1]
    const aInfo = { link: sender.identityInfo.link }
    let numTries = 0

    sender._send = function (msg, recipient, cb) {
      receiver.receive(msg, aInfo, function (err) {
        if (err) throw err

        cb.apply(null, arguments)
      })
    }

    const result = { sender, receiver, friends }
    sender.signAndSend({
      object: object,
      to: receiver._recipientOpts,
    }, function (err, wrapper) {
      if (err) throw err

      result.object = wrapper.message.object
    })

    let togo = 2
    result.destroy = function (cb) {
      async.each(friends, function iterator (friend, done) {
        friend.destroy(done)
      }, cb)
    }

    sender.on('sent', wrapper => {
      result.sent = wrapper
      done()
    })

    receiver.on('message', wrapper => {
      result.message = wrapper
      done()
    })

    function done () {
      if (--togo === 0) {
        cb(null, result)
      }
    }
  })
}

exports.twoFriendsSentReceivedSealed = function (opts, cb) {
  contexts.twoFriendsSentReceived(opts.object, function (err, result) {
    if (err) throw err

    const friends = result.friends
    const alice = friends[0]
    const bob = friends[1]

    // console.log(result.sent)
    const sealer = opts.sealer === 'sender' ? alice : bob
    const auditor = sealer === alice ? bob : alice
    sealer.seal({
      link: result.sent.link,
      basePubKey: sealer.chainPubKey
    }, rethrow)

    // alice.seal(result.sent, rethrow)
    // bob.seal(result.message, rethrow)

    sealer.once('wroteseal', seal => {
      result.wroteseal = seal
      done()
    })

    sealer.once('readseal', seal => {
      result.readseal = seal
      clearInterval(sealerInterval)
      auditor.watchSeal({
        link: seal.link,
        basePubKey: sealer.chainPubKey
      }, rethrow)
    })

    auditor.once('readseal', done)
    const sealerInterval = setInterval(() => sealer.sync(), 100).unref()
    const auditorInterval = setInterval(() => auditor.sync(), 100).unref()
    let togo = 2

    function done () {
      if (--togo) return

      clearInterval(sealerInterval)
      clearInterval(auditorInterval)
      cb(null, result)
    }
  })
}

function rethrow (err) {
  if (err) throw err
}
