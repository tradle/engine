const Wallet = require('@tradle/simple-wallet')
const fakeWallet = require('./wallet')
const network = require('@tradle/bitcoin-adapter').testnet
const users = require('./fixtures/users')
const fakeChain = require('./blockchain')

exports.network = network

exports.transactor = function ({ privateKey, blockchain }) {
  privateKey = privateKey.priv

  if (!blockchain) blockchain = exports.blockchain()

  const wallet = new Wallet({
    networkName: network.name,
    blockchain: blockchain,
    priv: privateKey
  })

  const transactor = network.createTransactor({ privateKey, blockchain })
  // const transactor = Wallet.transactor({ wallet })
  transactor.blockchain = blockchain
  transactor.network = network
  return transactor
}

exports.blockchain = function () {
  const addresses = users.map(u => {
    return u.identity.pubkeys.find(key => {
      return key.purpose === 'messaging' &&
        key.type === network.blockchain &&
        key.networkName === network.name
    }).fingerprint
  })

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

exports.mintBlocks = function ({ blockchain, n }, cb) {
  while (n--) {
    blockchain._advanceToNextBlock()
  }

  process.nextTick(cb)
}

// exports.wallet = function (key, blockchain) {
//   var unspents = []
//   for (var i = 0; i < 20; i++) {
//     unspents.push(100000)
//   }

//   return fakeWallet({
//     network: network,
//     blockchain: blockchain,
//     unspents: unspents,
//     priv: key
//   })
// }
