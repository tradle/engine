'use strict'

const EventEmitter = require('events').EventEmitter
const typeforce = require('typeforce')
const debug = require('debug')('tradle:actions')
const statuses = require('./status')
const SealStatus = statuses.seal
const constants = require('./constants')
const TYPE = constants.TYPE
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const types = require('./types')
const topics = require('./topics')
const utils = require('./utils')
const noop = function () {}

module.exports = function (opts) {
  typeforce({
    changes: types.changes,
    node: typeforce.maybe(typeforce.Object)
    // other env vars like networkName
  }, opts)

  const node = opts.node
  const changes = opts.changes

  function wroteSeal (data, tx, cb) {
    typeforce({
      link: typeforce.String,
      sealAddress: typeforce.String,
      networkName: typeforce.String
    }, data)

    typeforce({
      txId: typeforce.String
    }, tx)

    append({
      topic: topics.wroteseal,
      // uid: getSealUID(data),
      link: data.link,
      sealAddress: data.sealAddress,
      sealPrevAddress: data.sealPrevAddress,
      networkName: data.networkName,
      txId: tx.txId,
      status: SealStatus.sealed
    }, cb)
  }

  function addContact (identity, link, cb) {
    typeforce(types.identity, identity)
    typeforce(typeforce.String, link)

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
      prevLink: typeforce.maybe(typeforce.String)
    }, wrapper)

    const entry = utils.pick(wrapper, 'link', 'permalink', 'prevLink', 'author')
    utils.addLinks(entry)
    // entry._type = ''
    entry.topic = topics.newobj
    entry.type = wrapper.object[TYPE]
    if (entry.type === MESSAGE_TYPE) {
      if (!wrapper.received) {
        entry.sendstatus = statuses.send.pending
      }
    }

    append(entry, cb)
  }

  function writeSeal (data, cb) {
    typeforce({
      link: typeforce.String,
      networkName: typeforce.String,
      basePubKey: types.chainPubKey,
      sealPubKey: types.chainPubKey,
      prevLink: typeforce.maybe(typeforce.String),
      sealPrevPubKey: typeforce.maybe(types.chainPubKey),
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

    data.status = SealStatus.pending
    // data.uid = getSealUID(data)
    data.write = true
    append(data, cb)
  }

  function createWatch (watch, cb) {
    typeforce({
      address: typeforce.String,
      link: typeforce.String,
      basePubKey: types.chainPubKey,
      watchType: typeforce.String,
    }, watch, true)

    watch.topic = topics.newwatch
    append(watch, cb)
  }

  // function saveTx (txInfo, cb) {
  //   typeforce({
  //     txId: typeforce.String,
  //     txHex: typeforce.String,
  //     tx: typeforce.Object,
  //     from: typeforce.Object,
  //     to: typeforce.Object,
  //     confirmations: typeforce.Number,
  //   }, txInfo)

  //   append({
  //     topic: topics.tx,
  //     txHex: txInfo.txHex,
  //     from: txInfo.from,
  //     to: txInfo.to,
  //     confirmations: txInfo.confirmations,
  //   }, cb)
  // }

  function sentMessage (link, cb) {
    typeforce(typeforce.String, link)

    append({
      topic: topics.sent,
      link: link,
      sendstatus: statuses.send.sent
    }, cb)
  }

  function readSeal (data, cb) {
    typeforce({
      link: typeforce.maybe(typeforce.String),
      prevLink: typeforce.maybe(typeforce.String),
      basePubKey: types.chainPubKey,
      txId: typeforce.String,
      confirmations: typeforce.Number,
      addresses: typeforce.arrayOf(typeforce.String),
      // if we know sealAddress, we already know what version we're monitoring
      sealAddress: typeforce.maybe(typeforce.String),
      // if we only know sealPrevAddress, we've detected a seal for a version
      // we do not yet possess
      sealPrevAddress: typeforce.maybe(typeforce.String),
    }, data, true)

    if (!(data.sealAddress || data.sealPrevAddress)) {
      throw new Error('expected "sealAddress" or "sealPrevAddress"')
    }

    data.topic = topics.readseal
    append(data, cb)
  }

  function append (entry, cb) {
    cb = cb || noop

    typeforce(typeforce.String, entry.topic)

    entry.timestamp = entry.timestamp || utils.now()
    changes.append(entry, function (err) {
      if (err) return cb(err)

      cb()
      if (node) debug(node.name || node.shortlink, entry.topic)

      process.nextTick(function () {
        emitter.emit(entry.topic, entry)
      })
    })
  }

  const emitter = new EventEmitter()

  return utils.extend(emitter, {
    wroteSeal,
    sentMessage,
    addContact,
    createObject,
    writeSeal,
    createWatch,
    // saveTx,
    readSeal
  })
}
