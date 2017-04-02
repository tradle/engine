require('./env')

// const WHY = require('why-is-node-running')
const test = require('tape')
const Sendy = require('sendy')
const SendyWS = require('sendy-ws')
const WebSocketRelay = require('sendy-ws-relay')
const AxolotlClient = require('sendy-axolotl')
const memdown = require('memdown')
const WebSocketClient = SendyWS.Client
const createSwitchboard = SendyWS.Switchboard
// const OTRClient = require('sendy-otr')
// const nkey = require('nkey')
// const nkeyEC = require('nkey-ec')
const createKeeper = require('@tradle/keeper')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
const utils = require('../lib/utils')
const helpers = require('./helpers')
const contexts = require('./contexts')

const SENDY_OPTS = { resendInterval: 1000, autoConnect: true }
// const newOTRSwitchboard = require('sendy-otr-ws').Switchboard

test('sendy', function (t) {
  t.timeoutAfter(60000)
  console.warn('this could take some time')
  const helpersKeeper = helpers.keeper
  helpers.keeper = createKeeper.bind(null, {
    encryption: { password: 'something' },
    db: memdown,
    path: 'some/path'
  })

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
        url: url + '?from=' + getTLSPubKey(node.identity),
        autoConnect: true
      })

      const tlsKey = getTLSKey(node)
      const transport = createSwitchboard({
        identifier: tlsKey.pubKeyString,
        unreliable: wsClient,
        clientForRecipient: function (recipient) {
          const sendy = new Sendy(SENDY_OPTS)
          if (i) messUpConnection(sendy._client)

          return new AxolotlClient({
            key: {
              secretKey: tlsKey.priv,
              publicKey: tlsKey.pub
            },
            client: sendy,
            theirPubKey: new Buffer(recipient, 'hex')
          })
        }
      })

      transport.on('404', function () {
        throw new Error('recipient not found')
      })

      transport.on('message', function (msg, from) {
        const pubKey = {
          type: 'ec',
          curve: 'curve25519',
          pub: new Buffer(from, 'hex')
        }

        node.receive(msg, { pubKey }, rethrow)
      })

      node._send = function (msg, recipient, cb) {
        const pubKey = getTLSPubKey(recipient.object)
        return transport.send(pubKey, msg, cb)
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

    let object
    alice.signAndSend({
      object: { [TYPE]: 'ho', hey: 'hey' },
      to: bob._recipientOpts
    }, function (err, result) {
      if (err) throw err

      object = result.object.object // signed
    })

    function cleanup () {
      friends.forEach(friend => friend.destroy())
      transports.forEach(transport => transport.destroy())
      relay.destroy()
      helpers.keeper = helpersKeeper
      t.end()
    }
  })
})

function getTLSKey (node) {
  return utils.find(node.keys, key => key.get('purpose') === 'tls')
}

function getTLSPubKey (identity) {
  return utils.find(identity.pubkeys, key => key.purpose === 'tls').pub
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
