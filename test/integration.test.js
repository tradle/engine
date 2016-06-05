'use strict'

const WHY = require('why-is-node-running')
const test = require('tape')
const Sendy = require('sendy')
const SendyWS = require('sendy-ws')
const WebSocketRelay = require('sendy-ws-relay')
const WebSocketClient = SendyWS.Client
const createSwitchboard = SendyWS.Switchboard
const OTRClient = require('sendy-otr')
// const createKeeper = require('@tradle/keeper')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
const utils = require('../lib/utils')
const helpers = require('./helpers')
const contexts = require('./contexts')

const SENDY_OPTS = { resendInterval: 1000, autoConnect: true }
// const newOTRSwitchboard = require('sendy-otr-ws').Switchboard

test('sendy', function (t) {
  contexts.twoFriends(function (err, friends) {
    if (err) throw err

    const port = 32145
    const relayPath = '/blah'
    const url = 'http://127.0.0.1:' + port + relayPath
    const relay = new WebSocketRelay({
      port: port,
      path: relayPath
    })

    const transports = friends.map(function (node, i) {
      const wsClient = new WebSocketClient({
        url: url + '?from=' + getOTRFingerprint(node.identity),
        autoConnect: true
      })

      const otrKey = getOTRKey(node)
      const transport = createSwitchboard({
        identifier: otrKey.fingerprint(),
        unreliable: wsClient,
        clientForRecipient: function (recipient) {
          const sendy = new Sendy(SENDY_OPTS)
          if (i) messUpConnection(sendy._client)
          return new OTRClient({
            key: otrKey.priv(),
            client: sendy,
            theirFingerprint: recipient
          })
        }
      })

      transport.on('404', function () {
        throw new Error('recipient not found')
      })

      transport.on('message', function (msg, from) {
        node.receive(msg, { fingerprint: from }, rethrow)
      })

      node._send = function (msg, recipient, cb) {
        const fingerprint = getOTRFingerprint(recipient.object)
        return transport.send(fingerprint, msg, cb)
      }

      return transport
    })

    const alice = friends[0]
    const bob = friends[1]
    alice.on('sent', msg => t.pass())
    bob.on('message', m => {
      t.same(m.object.object, object)
      cleanup()
    })

    const object = { [TYPE]: 'ho', hey: 'hey' }
    alice.signNSend({ object, recipient: bob._recipientOpts }, function (err) {
      if (err) throw err
    })

    function cleanup () {
      friends.forEach(friend => friend.destroy())
      transports.forEach(transport => transport.destroy())
      relay.destroy()
      t.end()
    }
  })
})

function getOTRKey (node) {
  return utils.find(node.keys, key => key.type() === 'dsa')
}

function getOTRFingerprint (identity) {
  return utils.find(identity.pubkeys, key => key.type === 'dsa').fingerprint
}

function rethrow (err) {
  if (err) throw err
}

function messUpConnection (c, factor) {
  const receive = c.receive
  let i = 0
  c.receive = function () {
    if (Math.random() < factor) return // drop

    return receive.apply(c, arguments)
  }
}
