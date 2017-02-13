/** @module addressBook */

const EventEmitter = require('events').EventEmitter
const async = require('async')
const pump = require('pump')
const typeforce = require('../typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
const indexer = require('feed-indexer')
const protocol = require('@tradle/protocol')
const clone = require('clone')
// const LiveStream = require('level-live-stream')
const constants = require('../constants')
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const utils = require('../utils')
const topics = require('../topics')
const types = require('../types')
const Errors = require('../errors')
const TEST = process.env.NODE_ENV === 'test'
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const LINK_PREFIX = 'c!'

/**
 * @typedef {Object} AddressBook
 * @property {Function} lookupIdentity
 * @property {Function} byFingerprint
 * @property {Function} byPubKey
 * @property {Function} byLink
 * @property {Function} byPermalink
 * @property {Function} createReadStream
 */

/**
 * address book database, bootstrapped from log
 * @alias module:addressBook
 * @param  {Object} opts
 * @param  {changes} opts.changes           changes-feed
 * @param  {levelup} opts.db                database to use to track identities
 * @param  {Keeper} opts.keeper             object storage
 * @param  {Object} [opts.name]             name, for logging
 * @return {AddressBook}
 */
module.exports = function createAddressBook (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: types.keeper,
    // identityInfo: types.identityInfo,
    name: typeforce.maybe(typeforce.String)
  }, opts)

  let cache
  let closed
  opts.db.once('closing', () => closed = true)

  let me
  let myDebug
  if (opts.identityInfo) setIdentityInfo(opts.identityInfo)

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
      if (closed) return

      keeper.get(change.value.link, function (err, body) {
        if (err) return cb(err)
        if (state) uncacheIdentity(state)

        const newState = indexedDB.merge(state, change)
        delete newState.topic
        newState.object = body
        cacheIdentity(newState)
        cb(null, newState)
      })
    }
  })

  const emitter = new EventEmitter()
  indexedDB.on('change', function (change, state) {
    myDebug('added contact: ' + utils.uid(state))
    emitter.emit('contact', state)
  })

  const simple = ['link', 'permalink']
  const complex = ['fingerprint', 'pub']
  const indexedProps = simple.concat(complex)
  const indexes = {}

  simple.forEach(prop => indexes[prop] = indexedDB.by(prop))
  complex.forEach(prop => {
    indexes[prop] = indexedDB.by(prop, function reducer (state, cb) {
      return state.object.pubkeys.map(key => {
        myDebug('indexing by ' + prop, key[prop])
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

  /**
   * lookup an identity by a fingerprint, pubKey, link or permalink
   * @param  {String}   propVal
   * @param  {Function} cb
   */
  function lookupIdentity (propVal, cb) {
    if (!propVal) throw new Error('expected "propVal"')

    if (typeof propVal === 'object') {
      if (propVal.permalink) return findOneByProp('permalink', propVal.permalink, cb)
      if (propVal.link) return findOneByProp('link', propVal.link, cb)
      if (propVal.fingerprint) return findOneByProp('fingerprint', propVal.fingerprint, cb)
      if (propVal.pubKey) return findOneByProp('pub', utils.pubKeyString(propVal.pubKey), cb)
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

  function setIdentityInfo (identityInfo) {
    me = opts.identityInfo
    myDebug = utils.subdebugger(debug, opts.name || me.permalink.slice(0, 6))
  }

  function findOneByProp (prop, val, cb) {
    const has = hasCachedBy(prop, val)
    if (!has) {
      return findOneByPropInDB(prop, val, cb)
    }

    indexedDB.onLive(() => {
      // may have been deleted from cache
      const cached = getCachedBy(prop, val)
      if (cached) {
        // return defensive copy
        return process.nextTick(() => cb(null, clone(cached)))
      }

      findOneByPropInDB(prop, val, cb)
    })
  }

  function findOneByPropInDB (property, value, cb) {
    indexes[property].findOne({ eq: value, keys: false }, function (err, result) {
      if (err) {
        if (err.notFound) {
          cb(new Errors.UnknownIdentity({ property, value }))
        } else {
          cb(err)
        }

        return
      }

      cacheIdentity(result)
      cb(null, result)
    })
  }

  function close () {
    closed = true
  }

  function uncacheIdentity (identityInfo) {
    updateCache(identityInfo, true)
  }

  function cacheIdentity (identityInfo) {
    updateCache(identityInfo)
  }

  function updateCache (identityInfo, remove) {
    if (!cache) return

    updateCacheBy('permalink', identityInfo.permalink, identityInfo, remove)
    updateCacheBy('link', identityInfo.link, identityInfo, remove)
    // const prevlink = identityInfo.object[PREVLINK]
    // if (prevlink) {
    //   updateCacheBy('prevlink', identityInfo.link, identityInfo, remove)
    // }

    identityInfo.object.pubkeys.forEach(pubKey => {
      updateCacheBy('pub', pubKey.pub, identityInfo, remove)
      updateCacheBy('fingerprint', pubKey.fingerprint, identityInfo, remove)
    })
  }

  function updateCacheBy (prop, val, identityInfo, remove) {
    if (cache) {
      if (remove) cache.del(prop + val)
      else {
        // make defensive copy before storing
        cache.set(prop + val, clone(identityInfo))
      }
    }
  }

  function getCachedBy (prop, val) {
    return cache && cache.get(prop + val)
  }

  function hasCachedBy (prop, val) {
    return cache && cache.has(prop + val)
  }

  return utils.extend(emitter, {
    lookupIdentity: lookupIdentity,
    byFingerprint: findOneByProp.bind(null, 'fingerprint'),
    byPubKey: function (val, cb) {
      findOneByProp('pub', utils.pubKeyString(val), cb)
    },
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
    setIdentityInfo: setIdentityInfo,
    setCache: c => cache = c,
    getCache: TEST ? () => cache : null
  })
}
