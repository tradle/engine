
const once = require('once')
const networkName = 'rinkeby'
const Wallet = require('@tradle/ethereumjs-wallet')
const constants = require('@tradle/ethereum-adapter/networks')[networkName]
const port = 28532
const Network = require('@tradle/ethereum-adapter')
const { blocktime } = require('./constants')
const network = Network.createNetwork({
  engineOpts: {
    rpcUrl: `http://localhost:${port}`,
    pollingInterval: blocktime / 2
  },
  networkName,
  constants
})

module.exports = {
  network,
  networkName,
  constants,
  port,
  transactor: createTransactor,
  createAPI: network.createBlockchainAPI
}

function createTransactor ({ privateKey }) {
  privateKey = Buffer.from(privateKey.priv, 'hex')
  const wallet = Wallet.fromPrivateKey(privateKey)
  const engine = Network.createEngine({
    privateKey,
    rpcUrl: `http://localhost:${port}`,
    pollingInterval: blocktime / 2
  })

  const transactor = Network.createTransactor({ network, wallet, engine })
  transactor.blockchain = network.createBlockchainAPI({ engine })
  return transactor
}
