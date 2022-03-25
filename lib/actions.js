/** @module actions */

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('tradle:actions')
const protocol = require('@tradle/protocol')
const typeforce = require('@tradle/typeforce')
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

const actionOpts = typeforce.compile({
  changes: types.changes,
  node: typeforce.maybe(typeforce.Object)
  // other env vars like networkName
})

const wroteSealData = typeforce.compile({
  link: typeforce.String,
  sealAddress: typeforce.String,
  blockchain: typeforce.String,
  networkName: typeforce.String
})

const createWatchWatch = typeforce.compile({
  blockchain: typeforce.String,
  networkName: typeforce.String,
  address: typeforce.String,
  link: typeforce.String,
  headerHash: typeforce.String,
  basePubKey: types.chainPubKey,
  watchType: typeforce.String,
  txId: typeforce.maybe(typeforce.String)
})

const wroteSealTx = typeforce.compile({
  txId: typeforce.String
})

const createObjectWrapper = typeforce.compile({
  object: types.signedObject,
  link: typeforce.String,
  author: typeforce.String,
  permalink: typeforce.maybe(typeforce.String),
  prevLink: typeforce.maybe(typeforce.String),
  objectinfo: typeforce.maybe(typeforce.Object),
  partialinfo: typeforce.maybe(typeforce.Object)
})

const writeSealData = typeforce.compile({
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
})

const readSealData = typeforce.compile({
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
})

/**
 * actions
 * @alias module:actions
 * @param {Object}  opts
 * @param {changes} opts.changes
 * @param {node}    [opts.node]
 */
module.exports = function (opts) {
  actionOpts.assert(opts)

  const node = opts.node
  const changes = opts.changes

  function wroteSeal (data, tx, cb) {
    wroteSealData.assert(data)
    wroteSealTx.assert(tx)

    if ((data.prevLink || data.sealPrevAddress) && !(data.prevLink && data.sealPrevAddress)) {
      return cb(new Error('expected either both prevLink and sealPrevAddress or neither'))
    }

    const action = utils.pick(data, WROTE_SEAL_COPY_PROPS)
    action.status = SealStatus.sealed
    action.txId = tx.txId
    action.topic = topics.wroteseal
    append(action, cb)
  }

  function addContact (identity, link, cb) {
    types.identity.assert(identity)
    typeforce.String.assert(link)

    const entry = utils.getLinks({
      link,
      object: identity
    })

    entry.topic = topics.addcontact
    append(entry, cb)
  }

  function createObject (wrapper, cb) {
    createObjectWrapper.assert(wrapper)

    const entry = utils.pick(wrapper, 'link', 'permalink', 'prevLink', 'author', 'recipient', 'objectinfo', 'partialinfo')
    utils.addLinks(entry)
    entry.topic = topics.newobj
    entry.type = wrapper.object[TYPE]
    if (entry.type === MESSAGE) {
      entry.seq = wrapper.object[SEQ]
      entry.timestamp = wrapper.object._time
      typeforce.String.assert(entry.recipient)
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
    writeSealData.assert(data, true)
    

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
    createWatchWatch.assert(watch, true)

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
    typeforce.String.assert(link)

    append({
      topic: topics.sent,
      link: link,
      sendstatus: statuses.send.sent
    }, cb)
  }

  function abortMessage (link, cb) {
    typeforce.String.assert(link)

    append({
      topic: topics.sendaborted,
      link: link,
      sendstatus: statuses.send.aborted
    }, cb)
  }

  function readSeal (data, cb) {
    readSealData.assert(data, true)

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

    typeforce.String.assert(entry.topic)

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
