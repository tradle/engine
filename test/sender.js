'use strict'

const test = require('tape')
const extend = require('xtend')
const constants = require('../lib/constants')
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createObjectDB = require('../lib/objectDB')
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

  const objectDB = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB()
  })

  changes.append({
    topic: topics.msg,
    sendstatus: statuses.send.pending,
    msgID: 'a',
    sender: bob,
    recipient: alice,
    [PERMALINK]: 'a1',
    [LINK]: 'a1'
  })

  changes.append({
    topic: topics.msg,
    sendstatus: statuses.send.pending,
    msgID: 'b',
    sender: bob,
    recipient: alice,
    [PERMALINK]: 'b1',
    [LINK]: 'b1'
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
    objectDB: objectDB,
    changes: changes
  })

  sender.on('sent', function (msg) {
    objectDB.get(msg.msgID, function (err, msg) {
      if (err) throw err

      t.equal(msg.sendstatus, statuses.send.sent)
    })
  })

  function start (err) {
    if (err) throw err

    sender.start()
  }
})
