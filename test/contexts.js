'use strict'

const constants = require('../lib/constants')
const TYPE = constants.TYPE
const users = require('./fixtures/users')
const helpers = require('./helpers')
const contexts = exports

exports.nUsers = function nUsers (n) {
  let blockchain
  if (users.length < n) throw new Error('not enough users in fixtures')
  if (helpers.names.length < n) throw new Error('not enough names in fixtures')

  return users.slice(0, n).map((user, i) => {
    const node = helpers.createNode(helpers.userToOpts(user, helpers.names[i]))

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

exports.twoFriendsMessageSentReceived = function (obj, cb) {
  if (typeof obj === 'function') {
    cb = obj
    obj = {
      [TYPE]: 'thang',
      a: 1,
      b: 2
    }
  }

  let blockchain
  contexts.twoFriends(function (err, friends) {
    if (err) return cb(err)

    const alice = friends[0]
    const bob = friends[1]
    const aInfo = { link: alice.identityInfo.link }
    let numTries = 0

    alice._send = function (msg, recipient, cb) {
      bob.receive(msg, aInfo, function (err) {
        if (err) throw err

        cb.apply(null, arguments)
      })
    }

    alice.signNSend({
      object: obj,
      recipient: bob._recipientOpts,
    }, rethrow)

    let togo = 2
    const result = {
      friends: friends
    }

    alice.on('sent', wrapper => {
      result.sent = wrapper
      done()
    })

    bob.on('message', wrapper => {
      result.message = wrapper
      done()
    })

    function done () {
      if (--togo === 0) cb(null, result)
    }
  })
}

function rethrow (err) {
  if (err) throw err
}
