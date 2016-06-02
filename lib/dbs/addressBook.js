
'use strict'

const EventEmitter = require('events').EventEmitter
const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
const indexer = require('feed-indexer')
const levelErrors = require('level-errors')
const protocol = require('@tradle/protocol')
// const LiveStream = require('level-live-stream')
const changeProcessor = require('../change-processor')
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

  const shortlink = utils.shortlink(opts.identityInfo.permalink.slice(0, 6))
  const myDebug = utils.subdebugger(debug, shortlink)
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
      keeper.get(change.link, function (err, body) {
        if (err) return cb(err)

        const newState = utils.clone(state || {}, change)
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

  /**
   * lookup an identity by a fingerprint, pubKey, link or permalink
   * @param  {[type]}   propVal [description]
   * @param  {Function} cb      [description]
   * @return {[type]}           [description]
   */
  function lookupIdentity (propVal, cb) {
    let match
    async.some(indexedProps, function iterator (prop, done) {
      indexes[prop].findOne(propVal, function (err, result) {
        if (err) return done()

        match = match || result
        done(null, true)
      })
    }, function (err) {
      if (err) return cb(err)
      if (!match) return cb(new levelErrors.NotFoundError())

      cb(null, match)
    })
  }

  function findOneByProp (prop, val, cb) {
    indexes[prop].findOne(val, cb)
    // indexes[prop].findOne(val, function (err, result) {
    //   myDebug((err ? 'not' : '') + 'found: ' + prop + ' ' + val)
    //   cb(err, result)
    // })
  }

  return utils.extend(emitter, {
    lookupIdentity: lookupIdentity,
    byFingerprint: findOneByProp.bind(null, 'fingerprint'),
    byPubKey: findOneByProp.bind(null, 'pub'),
    byLink: findOneByProp.bind(null, 'link'),
    byPermalink: findOneByProp.bind(null, 'permalink'),
    createReadStream: function (opts) {
      opts = opts || {}
      if (opts.keys !== true) opts.keys = false

      return indexedDB.createReadStream(opts)
    }
  })
}
