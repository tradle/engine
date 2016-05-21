'use strict'

const typeforce = require('typeforce')
const constants = require('./constants')
const TYPE = constants.TYPE
const types = require('./types')
const topics = require('./topics')
const utils = require('./utils')

module.exports = function (opts) {
  typeforce({
    changes: types.changes
  }, opts)

  const changes = opts.changes

  function wroteSeal (data, tx, cb) {
    append({
      topic: topics.wroteseal,
      link: data.link,
      sealAddress: data.sealAddress,
      txId: data.txId,
      networkName: data.networkName
    }, cb)
  }

  function addContact (identity, link, cb) {
    const entry = utils.getLinks({
      link: link,
      object: identity
    })

    entry.topic = topics.addcontact
    append(entry, cb)
  }

  function createObject (wrapper, cb) {
    typeforce({
      object: types.signedObject,
      link: typeforce.String,
      author: typeforce.String,
      permalink: typeforce.maybe(typeforce.String),
      prevlink: typeforce.maybe(typeforce.String)
    }, wrapper)

    const entry = utils.pick(wrapper, 'link', 'permalink', 'prevlink', 'author')
    utils.addLinks(entry)
    entry.topic = topics.newobj
    entry.type = wrapper.object[TYPE]
    append(entry, cb)
  }

  function createSeal (data, cb) {
    typeforce({
      link: typeforce.String,
      networkName: typeforce.String,
      basePubKey: types.chainPubKey,
      sealPubKey: types.chainPubKey,
      sealPrevPubKey: types.chainPubKey,
      sealAddress: typeforce.maybe(typeforce.String),
      sealPrevAddress: typeforce.maybe(typeforce.String),
      amount: typeforce.maybe(typeforce.Number)
    }, data, true)

    data.topic = topics.queueseal
    if (!data.sealAddress) {
      data.sealAddress = utils.pubKeyToAddress(data.sealPubKey, data.networkName)
    }

    if (!data.sealPrevAddress && data.sealPrevPubKey) {
      data.sealPrevAddress = utils.pubKeyToAddress(data.sealPrevPubKey, data.networkName)
    }

    append(data, cb)
  }

  function createWatch (address, link, cb) {
    append({
      topic: topics.watch,
      address: address,
      link: link
    }, cb)
  }

  function saveTx (txInfo, cb) {
    typeforce({
      txId: typeforce.String,
      confirmations: typeforce.Number,
      txHex: typeforce.String,
      tx: typeforce.Object
    }, txInfo)

    append({
      topic: topics.tx,
      confirmations: txInfo.confirmations,
      txHex: txInfo.txHex,
      from: txInfo.from,
      to: txInfo.to
    }, cb)
  }

  function sentMessage (link, cb) {
    append({
      topic: topics.sent,
      link: link
    }, cb)
  }

  function readSeal (data, cb) {
    throw new Error('not implemented')
  }

  function append (entry, cb) {
    entry.timestamp = entry.timestamp || utils.now()
    changes.append(entry, cb)
  }

  return {
    wroteSeal,
    sentMessage,
    addContact,
    createObject,
    createSeal,
    createWatch,
    saveTx,
    readSeal
  }
}
