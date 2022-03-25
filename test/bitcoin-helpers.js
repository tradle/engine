const network = require('@tradle/bitcoin-adapter').testnet
const users = require('./fixtures/users')
const fakeChain = require('./bitcoin-fakechain')
const utils = require('../lib/utils')

let api
network.createBlockchainAPI = opts => {
  if (!api) api = exports.createAPI(opts)

  return api
}

exports.network = network

exports.transactor = function ({ privateKey }) {
  privateKey = privateKey.priv

  if (!api) api = exports.createAPI()


  const transactor = network.createTransactor({ privateKey, api })
  transactor.api = api
  transactor.network = network
  return transactor
}

exports.createAPI = function () {
  const addresses = users.map(u => u.identity.pubkeys.find(k => utils.isChainKey(k, network)).fingerprint)
  return fakeChain({
    network,
    unspents: addresses.map(address => {
      return {
        address,
        amounts: new Array(20).fill(100000)
      }
    })
  })
}
