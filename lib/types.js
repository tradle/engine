/**
 * complex types used in type checks throughout the library
 */

const typeforce = require('@tradle/typeforce')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const {
  TYPE,
} = constants

const db = typeforce.compile({
  get: typeforce.Function,
  put: typeforce.Function,
  batch: typeforce.Function,
  createReadStream: typeforce.Function,
  close: typeforce.Function
})

const pubKey = typeforce.object({
  fingerprint: typeforce.String,
  purpose: typeforce.String,
  type: typeforce.String,
  pub: typeforce.String,
  networkName: typeforce.maybe(typeforce.String)
})

const identity = typeforce.object({
  [TYPE]: typeforce.value(constants.TYPES.IDENTITY),
  pubkeys: typeforce.arrayOf(pubKey)
})

module.exports = {
  ...protocol.types,
  bufferOrString: typeforce.anyOf(typeforce.Buffer, typeforce.String),
  identifier: typeforce.object({
    permalink: typeforce.String
  }),
  pubKey,
  identity,
  transactor: typeforce.object({
    send: typeforce.Function
  }),
  leveldown: typeforce.anyOf(typeforce.Object, typeforce.Function),
  changes: typeforce.object({
    append: typeforce.Function
  }),
  db,
  keeper: db,
  objectInfo: typeforce.object({
    object: protocol.types.object,
    permalink: typeforce.String,
    link: typeforce.String,
    prevLink: typeforce.maybe(typeforce.String)
  }),
  someObjectInfo: typeforce.object({
    object: typeforce.maybe(protocol.types.signedObject),
    permalink: typeforce.maybe(typeforce.String),
    link: typeforce.maybe(typeforce.String),
    prevLink: typeforce.maybe(typeforce.String)
  }),
  identityInfo: typeforce.object({
    object: identity,
    permalink: typeforce.String,
    link: typeforce.String,
    prevLink: typeforce.maybe(typeforce.String)
  }),
  blockchainReader: typeforce.object({
    transactions: typeforce.object({
      get: typeforce.Function
    }),
    addresses: typeforce.object({
      transactions: typeforce.Function
    })
  }),
  blockchainAdapter: typeforce.object({
    blockchain: typeforce.String,
    name: typeforce.String,
    pubKeyToAddress: typeforce.Function,
    minOutputAmount: typeforce.Number,
    createBlockchainAPI: typeforce.Function,
    createTransactor: typeforce.Function
  }),
  seal: typeforce.object({
    basePubKey: protocol.types.chainPubKey,
    link: typeforce.String
  }),
  blockchainIdentifier: typeforce.object({
    blockchain: typeforce.String,
    networkName: typeforce.String
  })
}
