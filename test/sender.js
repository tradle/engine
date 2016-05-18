'use strict'

const test = require('tape')
const extend = require('xtend')
const constants = require('@tradle/constants')
const ROOT_HASH = constants.ROOT_HASH
const PREV_HASH = constants.PREV_HASH
const CUR_HASH = constants.CUR_HASH
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createMessageDB = require('../lib/msgDB')
const createSender = require('../lib/sender')
const helpers = require('./helpers')

test('try again', function (t) {
  t.plan(5)

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

  const keeper = helpers.nextDB()
  keeper.batch(msgs.map(msg => {
    return extend(msg, { type: 'put' })
  }), start)

  const alice = 'alice'
  const bob = 'bob'

  const changes = helpers.nextFeed()

  const msgDB = createMessageDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB()
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
    addressBook: {
      // fake address book that does nothing
      lookupIdentity: function (identifier, cb) {
        cb(null, {})
      }
    },
    msgDB: msgDB,
    changes: changes
  })

  sender.on('sent', function (msg) {
    msgDB.get(msg.msgID, function (err, msg) {
      if (err) throw err

      t.equal(msg.sendstatus, statuses.send.sent)
    })
  })

  function start (err) {
    if (err) throw err

    sender.start()
  }
})
