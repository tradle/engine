/** @module actions */

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('tradle:actions')
const protocol = require('@tradle/protocol')
const typeforce = require('./typeforce')
const statuses = require('./status')
const SealStatus = statuses.seal
const { TYPES, TYPE, SEQ } = require('./constants')
const { PARTIAL, MESSAGE } = TYPES
const types = require('./types')
const topics = require('./topics')
const utils = require('./utils')
const noop = function () {}
const WROTE_SEAL_COPY_PROPS = [
  'link',
  'prevLink',
  'headerHash',
  'prevHeaderHash',
  'sealAddress',
  'sealPrevAddress',
  'blockchain',
  'networkName',
  'status'
]

// const WRITE_SEAL_ACTION_PROPS = [
//   'basePubKey',
//   'link',
//   'prevLink',
//   'headerHash',
//   'prevHeaderHash',
//   'sealAddress',
//   'sealPrevAddress',
//   'blockchain',
//   'networkName',
//   'amount'
// ]

/**
 * @typedef {Object} Actions
 */

/**
 * actions
 * @alias module:actions
 * @param {Object}  opts
 * @param {changes} opts.changes
 * @param {node}    [opts.node]
 */
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
      blockchain: typeforce.String,
      networkName: typeforce.String
    }, data)

    typeforce({
      txId: typeforce.String
    }, tx)

    if ((data.prevLink || data.sealPrevAddress) && !(data.prevLink && data.sealPrevAddress)) {
      throw new Error('expected either both prevLink and sealPrevAddress or neither')
    }

    const action = utils.pick(data, WROTE_SEAL_COPY_PROPS)
    action.status = SealStatus.sealed
    action.txId = tx.txId
    action.topic = topics.wroteseal
    append(action, cb)
  }

  function addContact (identity, link, cb) {
    typeforce(types.identity, identity)
    typeforce(typeforce.String, link)

    const entry = utils.getLinks({
      link,
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
      prevLink: typeforce.maybe(typeforce.String),
      objectinfo: typeforce.maybe(typeforce.Object),
      partialinfo: typeforce.maybe(typeforce.Object)
    }, wrapper)

    const entry = utils.pick(wrapper, 'link', 'permalink', 'prevLink', 'author', 'recipient', 'objectinfo', 'partialinfo')
    utils.addLinks(entry)
    entry.topic = topics.newobj
    entry.type = wrapper.object[TYPE]
    if (entry.type === MESSAGE) {
      entry.seq = wrapper.object[SEQ]
      entry.timestamp = wrapper.object.time
      typeforce(typeforce.String, entry.recipient)
      if (!wrapper.received) {
        entry.sendstatus = statuses.send.pending
      }

      if (!entry.objectinfo) entry.objectinfo = {}
      const objinfo = entry.objectinfo

      if (!objinfo.type) objinfo.type = wrapper.object.object[TYPE]
      if (!objinfo.link || !objinfo.permalink) {
        const links = utils.getLinks({ object: wrapper.object.object })
        utils.extend(objinfo, links)
      }
    }

    entry.archived = false
    append(entry, cb)
  }

  function writeSeal (data, cb) {
    typeforce({
      link: typeforce.String,
      headerHash: typeforce.String,
      blockchain: typeforce.String,
      networkName: typeforce.String,
      basePubKey: types.chainPubKey,
      sealPubKey: types.chainPubKey,
      prevLink: typeforce.maybe(typeforce.String),
      prevHeaderHash: typeforce.maybe(typeforce.String),
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

    if ((data.prevLink || data.sealPrevAddress) && !(data.prevLink && data.sealPrevAddress)) {
      throw new Error('expected either both prevLink and sealPrevAddress or neither')
    }

    data.status = SealStatus.pending
    // data.uid = getSealUID(data)
    data.write = true
    append(data, cb)
  }

  function createWatch (watch, cb) {
    typeforce({
      blockchain: typeforce.String,
      networkName: typeforce.String,
      address: typeforce.String,
      link: typeforce.String,
      headerHash: typeforce.String,
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

  function abortMessage (link, cb) {
    typeforce(typeforce.String, link)

    append({
      topic: topics.sendaborted,
      link: link,
      sendstatus: statuses.send.aborted
    }, cb)
  }

  function readSeal (data, cb) {
    typeforce({
      blockchain: typeforce.String,
      networkName: typeforce.String,
      link: typeforce.maybe(typeforce.String),
      prevLink: typeforce.maybe(typeforce.String),
      headerHash: typeforce.maybe(typeforce.String),
      prevHeaderHash: typeforce.maybe(typeforce.String),
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

    if (!(data.headerHash || data.prevHeaderHash)) {
      throw new Error('expected "headerHash" or "prevHeaderHash"')
    }

    // data.confirmed = data.confirmations >= node.confirmedAfter
    data.topic = topics.readseal
    append(data, cb)
  }

  function forgetObject (link, cb) {
    append({
      topic: topics.archiveobj,
      link: link
    }, cb)
  }

  function rememberObject (link, cb) {
    append({
      topic: topics.unarchiveobj,
      link: link
    }, cb)
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
    abortMessage,
    addContact,
    createObject,
    writeSeal,
    createWatch,
    // saveTx,
    readSeal,
    forgetObject,
    rememberObject
  })
}
