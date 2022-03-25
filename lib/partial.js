
const merkleProofs = require('merkle-proofs')
const protocol = require('@tradle/protocol')
const flat = require('flat-tree')
const utils = require('./utils')
const types = require('./types')
const { SIG, TYPE, TYPES } = require('./constants')
const { PARTIAL } = TYPES

exports.from = function (object) {
  types.signedObject.assert(object)

  const neutered = utils.omit(object, SIG)
  const prover = protocol.prover(neutered)
  protocol.indices(neutered)
  const added = {}
  const builder = {
    add: opts => {
      const { property, key, value } = opts
      if (!key && !value) {
        throw new Error('"key" and/or "value" must be true')
      }

      if (key === SIG) {
        throw new Error(SIG + ' is a signature of the merkle root, ' +
          'and thus is not covered by it...and thus can\'t proven with a merkle proof')
      }

      if (added[property]) {
        throw new Error('already added ' + property)
      }

      added[property] = true
      prover.add(opts)
      return builder
    },
    build: () => {
      const proof = prover.proof().map(stripBuffers)
      const leaves = prover
        .leaves()
        .map(leaf => utils.pick(leaf, 'index', 'data'))
        .map(stripBuffers)

      return {
        [TYPE]: PARTIAL,
        root: proof.pop(),
        leaves,
        proof,
        sig: object[SIG]
      }
    }
  }

  return builder
}

exports.verify = function (partial) {
  const proof = partial.proof.concat(partial.root).map(bufferizeMerkleNode)
  const opts = utils.extend({ proof }, protocol.DEFAULT_MERKLE_OPTS)
  const verify = merkleProofs.verifier(opts)
  return partial.leaves.every(node => verify(node))
}

exports.extractSigPubKey = function (partial, cb) {
  const { pubKey, sig } = utils.parseSig(partial.sig)
  pubKey.type = 'ec'
  const nkey = utils.importKey(pubKey)
  nkey.verify(Buffer.from(partial.root.hash, 'hex'), sig, function (err, verified) {
    if (err) return cb(err)

    cb(null, verified && pubKey)
  })
}

exports.interpretLeaves = function interpretLeaves (leaves) {
  // assumes flat-tree was used to index nodes
  leaves = leaves.slice().sort(function (a, b) {
    return a.index - b.index
  })

  const props = []
  for (var i = 0; i < leaves.length; i++) {
    let leaf = leaves[i]
    let isKey = leaf.index % 4 === 0
    if (isKey) {
      props.push({ key: leaf.data })
    } else {
      // merkle tree uses stringified values
      let value = leaf.data
      let prev = i > 0 && leaves[i - 1]
      if (prev && flat.sibling(prev.index) === leaf.index) {
        props[props.length - 1].value = value
      } else {
        props.push({ value: leaf.data })
      }
    }
  }

  props.forEach(function parse (prop) {
    if ('key' in prop) prop.key = JSON.parse(prop.key)
    if ('value' in prop) prop.value = JSON.parse(prop.value)
  })

  return props
}

function stripBuffers (node) {
  const clean = {
    index: node.index
  }

  if (node.hash) {
    clean.hash = node.hash.toString('hex')
  }

  if (node.data) {
    clean.data = node.data.toString()
  }

  return clean
}

function bufferizeMerkleNode (node) {
  const withBufs = {
    index: node.index
  }

  if (node.hash) {
    withBufs.hash = Buffer.from(node.hash, 'hex')
  }

  if (node.data) {
    withBufs.data = Buffer.from(node.data)
  }

  return withBufs
}
