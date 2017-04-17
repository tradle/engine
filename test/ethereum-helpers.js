
const once = require('once')
const networkName = 'ropsten'
const constants = require('@tradle/ethereum-adapter/networks')[networkName]
const port = 28532
const blocktime = 500
const network = require('@tradle/ethereum-adapter/api')({
  networkName,
  constants,
  rpcUrl: `http://localhost:${port}`,
  pollingInterval: blocktime / 2
})

module.exports = {
  network,
  constants,
  port,
  blocktime,
  transactor,
  blockchain: network.createBlockchainAPI,
  mintBlocks
}

function transactor ({ privateKey }) {
  return network.createTransactor({
    privateKey: new Buffer(privateKey.priv, 'hex')
  })
}

function mintBlocks ({ n }, cb) {
  setTimeout(cb, n * (blocktime + 1))
}
