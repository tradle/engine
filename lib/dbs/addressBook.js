
'use strict'

const EventEmitter = require('events').EventEmitter
const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
const indexer = require('feed-indexer')
const protocol = require('@tradle/protocol')
// const LiveStream = require('level-live-stream')
const constants = require('../constants')
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const utils = require('../utils')
const topics = require('../topics')
const types = require('../types')
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const LINK_PREFIX = 'c!'

module.exports = function createAddressBook (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: types.keeper,
    identityInfo: types.identityInfo
  }, opts)

  let me
  let shortlink
  let myDebug
  setMyIdentity(opts.identityInfo)

  const keeper = opts.keeper
  const relevantTopics = [
    topics.addcontact
  ]

  const primaryKey = 'permalink'
  const indexedDB = indexer({
    feed: opts.changes,
    db: opts.db,
    primaryKey: primaryKey,
    filter: function (val) {
      return relevantTopics.indexOf(val.topic) !== -1
    },
    reduce: function (state, change, cb) {
      keeper.get(change.value.link, function (err, body) {
        if (err) return cb(err)

        const newState = indexedDB.merge(state, change)
        delete newState.topic
        newState.object = body
        cb(null, newState)
      })
    }
  })

  const emitter = new EventEmitter()
  indexedDB.on('change', function (change, state) {
    myDebug('added contact: ' + utils.uid(state))
    emitter.emit('contact', state)
  })

  // maybe these props should
  const simple = ['link', 'permalink'] //, 'prevLink']
  const complex = ['fingerprint', 'pub']
  const indexedProps = simple.concat(complex)
  const indexes = {}

  simple.forEach(prop => indexes[prop] = indexedDB.by(prop))
  complex.forEach(prop => {
    indexes[prop] = indexedDB.by(prop, function reducer (state, cb) {
      return state.object.pubkeys.map(key => {
        return key[prop] + indexedDB.separator + state[primaryKey]
      })
    })
  })

  const indexMap = {}
  indexes.pub.on('change', function (state, iMap) {
    utils.extend(indexMap, iMap)
  })

  indexes.link.on('change', function (state, val) {
    indexMap[val] = state.permalink
  })

  function setMyIdentity (identityInfo) {
    me = identityInfo
    shortlink = utils.shortlink(me.permalink.slice(0, 6))
    myDebug = utils.subdebugger(debug, shortlink)
  }

  /**
   * lookup an identity by a fingerprint, pubKey, link or permalink
   * @param  {[type]}   propVal [description]
   * @param  {Function} cb      [description]
   * @return {[type]}           [description]
   */
  function lookupIdentity (propVal, cb) {
    if (typeof propVal === 'object') {
      if (propVal.permalink) return findOneByProp('permalink', propVal.permalink, cb)
      if (propVal.link) return findOneByProp('link', propVal.link, cb)
      if (propVal.fingerprint) return findOneByProp('fingerprint', propVal.fingerprint, cb)
      if (propVal.pubKey) return findOneByProp('link', utils.pubKeyString(propVal.pubKey), cb)
    }

    let match
    async.some(indexedProps, function iterator (prop, done) {
      findOneByProp(prop, propVal, function (err, result) {
        if (err) return done()

        match = match || result
        done(null, true)
      })
    }, function (err) {
      if (err) return cb(err)
      if (!match) return cb(utils.notFoundErr())

      cb(null, match)
    })
  }

  function findOneByProp (prop, val, cb) {
    // switch (prop) {
    // case 'link':
    // case 'permalink':
    //   if (val === me[prop]) {
    //     return cb(null, me)
    //   }

    //   break
    // case 'pub':
    // case 'fingerprint':
    //   if (me.object.pubkeys.some(k => k[prop] === val)) {
    //     return cb(null, me)
    //   }
    // }

    indexes[prop].findOne({ eq: val, keys: false }, cb)
  }

  return utils.extend(emitter, {
    lookupIdentity: lookupIdentity,
    byFingerprint: findOneByProp.bind(null, 'fingerprint'),
    byPubKey: findOneByProp.bind(null, 'pub'),
    // byPubKey: function (pubKey) {
    //   findOneByProp('pub', pubKey, function () {
    //     console.log(arguments)
    //   })
    // },
    byLink: findOneByProp.bind(null, 'link'),
    // byLink: function (link) {
    //   findOneByProp('link', link, function () {
    //     console.log(arguments)
    //   })
    // },
    byPermalink: findOneByProp.bind(null, 'permalink'),
    createReadStream: function (opts) {
      opts = opts || {}
      if (opts.keys !== true) opts.keys = false

      return indexedDB.createReadStream(opts)
    },
    setMyIdentity: setMyIdentity
  })
}
