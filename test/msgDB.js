'use strict'

const test = require('tape')
const async = require('async')
const extend = require('xtend')
const leveldown = require('memdown')
const collect = require('stream-collector')
const levelup = require('levelup')
const changesFeed = require('changes-feed')
const constants = require('@tradle/constants')
const fakeKeeper = require('@tradle/test-helpers').fakeKeeper
const createMessageDB = require('../lib/msgDB')
const createSender = require('../lib/sender')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const logs = require('../lib/logs')
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const PREV_HASH = constants.PREV_HASH
const CUR_HASH = constants.CUR_HASH
const IDENTITY_TYPE = constants.TYPES.IDENTITY
let dbCounter = 0

const nextDBName = function () {
  return 'db' + (dbCounter++)
}

const nextFeed = function () {
  return changesFeed(nextDB())
}

const nextDB = function () {
  return levelup(nextDBName(), {
    db: leveldown,
    valueEncoding: 'json'
  })
}

test('list messages', function (t) {
  const keeperMap = {
    a1: { a: 1 },
    a2: { a: 2 },
    b1: { b: 1 }
  }

  const changes = nextFeed()
  const alice = createMessageDB({
    changes: changes,
    keeper: fakeKeeper.forMap(keeperMap),
    db: nextDB()
  })

  changes.append({
    topic: topics.msg,
    msgID: 'a',
    type: 'fruit',
    [ROOT_HASH]: 'a1',
    [CUR_HASH]: 'a1'
  })

  changes.append({
    topic: topics.msg,
    msgID: 'b',
    type: 'veggie',
    [ROOT_HASH]: 'b1',
    [CUR_HASH]: 'b1'
  })

  changes.append({
    topic: topics.msg,
    msgID: 'a',
    [ROOT_HASH]: 'a1',
    [CUR_HASH]: 'a2'
  })

  alice.list(function (err, msgs) {
    if (err) throw err

    t.same(msgs, [ { a: 2 }, { b: 1 } ])
    alice.list('fruit', function (err, msgs) {
      if (err) throw err

      t.same(msgs, [ { a: 2 }])
      t.end()
    })
  })
})

test.only('send / receive', function (t) {
  t.plan(3)

  // const msgs = [
  //   a: { hello: 'world' },
  //   b: { hello: 'alice' }
  // ]

  const msgs = [
    {
      key: 'a1',
      value: { a: 1 }
    },
    {
      key: 'b1',
      value: { b: 1 }
    }
  ]

  const keeper = nextDB()
  keeper.batch(msgs.map(msg => {
    return extend(msg, { type: 'put' })
  }))

  const alice = 'alice'
  const bob = 'bob'

  const changes = nextFeed()

  const msgDB = createMessageDB({
    changes: changes,
    keeper: keeper,
    db: nextDB()
  })

  changes.append({
    topic: topics.msg,
    sendstatus: statuses.send.unsent,
    msgID: 'a',
    sender: bob,
    recipient: alice,
    [ROOT_HASH]: 'a1',
    [CUR_HASH]: 'a1'
  })

  changes.append({
    topic: topics.msg,
    sendstatus: statuses.send.unsent,
    msgID: 'b',
    sender: bob,
    recipient: alice,
    [ROOT_HASH]: 'b1',
    [CUR_HASH]: 'b1'
  })

  let failedOnce
  const unsent = msgs.map(msg => msg.value)
  const sender = createSender({
    send: function (msg, recipient, cb) {
      t.same(JSON.parse(msg), unsent[0])
      if (failedOnce) {
        unsent.shift()
        return cb()
      }

      failedOnce = true
      cb(new Error('no one was home'))
    },
    keeper: keeper,
    addressBook: addressBook,
    msgDB: msgDB,
    changes: changes
  })

  sender.start()
})
