const TestRPC = require('ethereumjs-testrpc')
const users = require('./fixtures/users')
const { blocktime } = require('./constants')
const { network, constants, port } = require('./ethereum-helpers')
const server = TestRPC.server({
  network_id: constants.chainId,
  blocktime: blocktime / 1000,
  accounts: users.map(user => {
    const key = user.keys.find(key => key.networkName === network.name && key.purpose === 'messaging')
    return {
      secretKey: new Buffer(key.priv, 'hex'),
      balance: '0x0000000000000056bc75e2d63100000'
    }
  })
})

server.listen(port, function (err) {
  if (err) throw err
})
