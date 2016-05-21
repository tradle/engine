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

  function sealedObject (data, tx, cb) {
    changes.append({
      topic: topics.sealed,
      link: data.link,
      txId: data.tx.getId()
    }, cb)
  }

  function addContact (identity, link, cb) {
    const entry = utils.getLinks({
      link: link,
      object: identity
    })

    entry.topic = topics.addcontact
    changes.append(entry, cb)
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
    changes.append(entry, cb)
  }

  function createSeal (sealData, cb) {
    typeforce({
      link: typeforce.String,
      basePubKey: types.chainPubKey,
      sealPubKey: types.chainPubKey,
      sealPrevPubKey: types.chainPubKey,
      amount: typeforce.maybe(typeforce.Number)
    }, sealData, true)

    sealData.topic = topics.newseal
    changes.append(sealData, cb)
  }

  function createWatch (address, link, cb) {
    changes.append({
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

    changes.append({
      topic: topics.tx,
      confirmations: txInfo.confirmations,
      txHex: txInfo.txHex,
      from: txInfo.from,
      to: txInfo.to
    }, cb)
  }

  function sentMessage (link, cb) {
    changes.append({
      topic: topics.sent,
      link: link
    }, cb)
  }

  return {
    sealedObject,
    sentMessage,
    addContact,
    createObject,
    createSeal,
    createWatch,
    saveTx
  }
}
