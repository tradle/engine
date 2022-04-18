const crypto = require('crypto')
const Wallet = require('@tradle/simple-wallet')
const bitcoin = require('@tradle/bitcoinjs-lib')
const typeforce = require('@tradle/typeforce')
const utils = require('@tradle/utils')
const { testnet } = require('@tradle/bitcoin-adapter')

const walletOpts = typeforce.object({
  unspents: 'Array',
  network: 'Object'
})

module.exports = function (options) {
  walletOpts.assert(options)

  const { network } = options
  const walletUnspents = options.unspents
  const total = walletUnspents.reduce(function (sum, n) {
    return sum + n
  }, 0)

  let { priv } = options
  if (typeof priv === 'string') {
    priv = bitcoin.ECKey.fromWIF(priv)
  } else if (!priv) {
    priv = bitcoin.ECKey.makeRandom(true)
  }

  if (!priv) throw new Error('invalid "priv"')

  const unspents = []
  let { blockchain } = options
  if (!blockchain) {
    const commonBlockchain = createFakeChain({
      network: bitcoin.networks[network.name],
      unspents
    })

    blockchain = network.wrapCommonBlockchain(commonBlockchain)
  }

  const w = new Wallet({ networkName: network.name, blockchain, priv })
  const tx = fund(w.address, walletUnspents)
  tx.outs.forEach(function (o, i) {
    unspents.push({
      txId: tx.getId(),
      confirmations: 6,
      address: w.addressString,
      value: o.value,
      vout: i
    })
  })

  return w
}

function createFakeChain ({ network, unspents }) {
  const ADDR_CACHE = {}
  const blocks = []
  return {
    info: function (cb) {
      process.nextTick(function () {
        const last = blocks[blocks.length - 1]
        const blockHeight = last ? last.blockHeight : -1
        cb(null, { blockHeight })
      })
    },
    blocks: {
      get: function (heights, cb) {
        process.nextTick(function () {
          const matched = blocks.filter(function (b) {
            return heights.indexOf(b.blockHeight) !== -1
          })

          if (matched.length) return cb(null, matched)

          cb(new Error('no blocks found'))
        })
      },
      latest: function (cb) {
        process.nextTick(function () {
          cb(null, blocks[blocks.length - 1])
        })
      }
    },
    addresses: {
      transactions: function (addrs, height, cb) {
        process.nextTick(function () {
          if (typeof height === 'function') {
            cb = height
            height = 0
          }

          height = height || 0
          const txs = blocks.filter(function (b) {
            return b.blockHeight >= height
          })
          .reduce(function (txs, b) {
            return txs.concat(b.transactions.filter(function (tx) {
              tx.block = b // ugly side effect

              const txId = tx.getId()
              let cached = ADDR_CACHE[txId]
              if (!cached) {
                cached = ADDR_CACHE[txId] = tx.outs.map(function (out) {
                  return getAddressFromOutput(out, network)
                }).concat(tx.ins.map(function (input) {
                  return getAddressFromInput(input, network)
                })).filter(function (a) {
                  return a // filter out nulls
                })
              }

              return cached.some(function (addr) {
                return addrs.indexOf(addr) !== -1
              })
            }))
          }, [])

          if (!txs.length) return cb(null, [])

          cb(null, txs.map(function (tx) {
            return {
              txId: tx.getId(),
              txHex: tx.toHex(),
              blockId: tx.block.getId(),
              blockHeight: tx.block.blockHeight
            }
          }))
        })
      },
      unspents: function (addr, cb) {
        process.nextTick(function () {
          cb(null, unspents)
        })
      },
      // summary: function (addrs, cb) {
      //   process.nextTick(function () {
      //     cb(null, addrs.map(function (a) {
      //       return {
      //         balance: total
      //       }
      //     }))
      //   })
      // }
    },
    transactions: {
      get: function (txIds, cb) {
        process.nextTick(function () {
          const txs = blocks.reduce(function (soFar, b) {
            return soFar.concat(b.transactions)
          }, [])
          .filter(function (tx) {
            return txIds.indexOf(tx.getId()) !== -1
          })
          .map(function (tx) {
            return {
              txId: tx.getId(),
              txHex: tx.toHex(),
              blockId: tx.block.getId(),
              blockHeight: tx.block.blockHeight
            }
          })

          cb(null, txs)
        })
      },
      propagate: function (tx, cb) {
        const b = addFakeBlock(blocks)
        b.transactions.push(bitcoin.Transaction.fromHex(tx))
        sendTx(tx, cb)
      }
    },
    _advanceToNextBlock: function () {
      addFakeBlock(blocks)
    }
  }
}

function fund (address, walletUnspents) {
  const prevTx = new bitcoin.Transaction()
  prevTx.addInput(new bitcoin.Transaction(), 0)
  walletUnspents.forEach(function (amount) {
    prevTx.addOutput(address.toString(), amount)
  })

  return prevTx
}

function sendTx (tx, cb) {
  process.nextTick(cb)
}

function addFakeBlock (blocks) {
  const b = new bitcoin.Block()
  if (blocks.length) {
    b.prevHash = blocks[blocks.length - 1].getHash()
  } else {
    b.prevHash = crypto.randomBytes(32)
  }

  b.merkleRoot = crypto.randomBytes(32)
  b.timestamp = Date.now() / 1000
  b.bits = Math.random() * 100000000 | 0
  b.nonce = Math.random() * 100000000 | 0
  b.height = b.blockHeight = blocks.length
  b.transactions = []
  blocks.push(b)
  return b
}

function getAddressFromOutput (output, network) {
  if (bitcoin.scripts.classifyOutput(output.script) === 'pubkeyhash') {
    return bitcoin.Address
      .fromOutputScript(output.script, network)
      .toString()
  }
}

function getAddressFromInput (input, network) {
  const pubKeyBuf = input.script.chunks[1]
  const pub = bitcoin.ECPubKey.fromBuffer(pubKeyBuf)
  return pub.getAddress(network).toString()
}
