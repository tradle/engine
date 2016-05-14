#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const async = require('async')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const kiki = require('@tradle/kiki')
const constants = require('@tradle/constants')
const identityLib = require('@tradle/identity')
const utils = require('../lib/utils')
const TYPE = constants.TYPE
// const NONCE = constants.NONCE
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'file',
    n: 'number'
  }
})

genUsers(argv)

function genUsers (opts) {
  typeforce({
    file: 'String',
    number: 'Number'
  }, opts)

  const file = path.resolve(opts.file)
  const number = opts.number
  const tmp = []
  for (let i = 0; i < number; i++) {
    tmp.push(null)
  }

  async.parallel(tmp.map(() => genOne), function (err, results) {
    if (err) throw err

    fs.writeFile(file, JSON.stringify(results, null, 2))
  })
}

function genOne (cb) {
  const keys = identityLib.defaultKeySet({
    networkName: 'testnet'
  })

  const pub = {
    [TYPE]: constants.TYPES.IDENTITY,
    pubkeys: keys.map(k => k.exportPublic()).map(k => {
      k.pub = k.value
      return k
    })
  }

  const sigKey = utils.sigKey(keys)
  const sigPubKey = utils.sigPubKey(pub)
  protocol.sign({
    sender: {
      sigPubKey: sigPubKey,
      sign: sigKey.sign.bind(sigKey)
    },
    object: pub
  }, err => {
    if (err) return cb(err)

    cb(null, {
      pub: pub,
      priv: keys.map(k => k.exportPrivate()),
      rootHash: protocol.link(pub)
    })
  })
}
