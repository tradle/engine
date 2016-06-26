'use strict'

const test = require('tape')
const extend = require('xtend')
const async = require('async')
const createBackoff = require('backoff')
const protocol = require('@tradle/protocol')
const constants = require('../lib/constants')
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const TYPE = constants.TYPE
const SIG = constants.SIG
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createObjectDB = require('../lib/dbs/objects')
const createSender = require('../lib/sender')
const utils = require('../lib/utils')
const createActions = require('../lib/actions')
const helpers = require('./helpers')
const users = require('./fixtures/users')

test('try again', function (t) {
  t.plan(13)

  const aliceKey = protocol.genECKey()
  const alicePubKey = utils.omit(aliceKey, 'priv')
  const bobKey = protocol.genECKey()
  const bobPubKey = utils.omit(bobKey, 'priv')
  const bobAuthorObj = {
    sigPubKey: bobPubKey,
    sign: function (data, cb) {
      cb(null, utils.sign(data, bobKey))
    }
  }

  const objs = [
    {
      [TYPE]: MESSAGE_TYPE,
      recipientPubKey: alicePubKey,
      object: {
        a: 1
      }
    },
    {
      [TYPE]: 'something else',
      b: 1
    },
    {
      [TYPE]: MESSAGE_TYPE,
      recipientPubKey: alicePubKey,
      object: {
        c: 1
      }
    }
  ]

  const authorLink = 'bob'
  const recipientLink = 'alice'
  const bob = helpers.dummyIdentity(authorLink)

  const changes = helpers.nextFeed()
  const actions = createActions({ changes })

  const keeper = helpers.keeper()
  const objectDB = createObjectDB({
    keeper: keeper,
    db: helpers.nextDB(),
    changes: changes,
    identityInfo: bob
  })

  const keyToVal = {}
  let unsent = []
  async.each(objs, create, start)

  // const unsent = batch.map(row => row.value).filter(val => val[TYPE] === MESSAGE_TYPE)
  let failuresToGo = 3
  const sender = createSender({
    name: 'sender',
    send: function (msg, recipient, cb) {
      t.ok(sender.isRunning())

      // 2 + 3 times
      msg = protocol.unserializeMessage(msg)
      t.same(msg, unsent[0])
      if (--failuresToGo <= 0) {
        unsent.shift()
        return cb()
      }

      cb(new Error('no one was home'))
    },
    addressBook: {
      // fake address book that does nothing
      byPubKey: function (identifier, cb) {
        cb(null, {})
      }
    },
    objects: objectDB,
    actions: actions,
    backoff: createBackoff.exponential({
      initialDelay: 100,
      maxDelay: 1000
    })
  })

  objectDB.on('sent', function (wrapper) {
    objectDB.get(wrapper.link, function (err, wrapper) {
      if (err) throw err

      // 3 times
      t.equal(wrapper.sendstatus, statuses.send.sent)
    })
  })

  function start (err) {
    if (err) throw err

    sender.start()

    setTimeout(function () {
      // check that live stream is working

      const obj = {
        [TYPE]: MESSAGE_TYPE,
        recipientPubKey: alicePubKey,
        object: {
          d: 1
        }
      }

      create(obj)
      sender.pause()
      setTimeout(() => sender.resume(), 500)
    }, 200)
  }

  function create (object, cb) {
    protocol.sign({
      object: object,
      author: bobAuthorObj
    }, function (err, result) {
      if (err) throw err

      const signed = result.object
      if (object[TYPE] === MESSAGE_TYPE) unsent.push(signed)
      const wrapper = { object: signed, author: authorLink, recipient: recipientLink }
      utils.addLinks(wrapper)
      keyToVal[wrapper.link] = signed
      keeper.put(wrapper.link, signed, err => {
        if (err) throw err

        actions.createObject(wrapper, cb)
      })
    })
  }
})

function rethrow (err) {
  if (err) throw err
}
