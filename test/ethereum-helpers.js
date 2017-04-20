
const once = require('once')
const networkName = 'ropsten'
const Wallet = require('ethereumjs-wallet')
const constants = require('@tradle/ethereum-adapter/networks')[networkName]
const port = 28532
const Network = require('@tradle/ethereum-adapter')
const { blocktime } = require('./constants')
const network = Network.createNetwork({
  networkName,
  constants
})

module.exports = {
  network,
  constants,
  port,
  transactor: createTransactor,
  blockchain: network.createBlockchainAPI
}

function createTransactor ({ privateKey }) {
  privateKey = new Buffer(privateKey.priv, 'hex')
  const wallet = Wallet.fromPrivateKey(privateKey)
  const engine = Network.createEngine({
    privateKey,
    rpcUrl: `http://localhost:${port}`,
    pollingInterval: blocktime / 2
  })

  const transactor = Network.createTransactor({ network, wallet, engine })
  transactor.blockchain = Network.createBlockchainAPI({ engine })
  return transactor
}
