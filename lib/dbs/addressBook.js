
'use strict'

const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
const indexer = require('feed-indexer')
const extend = require('xtend/mutable')
const clone = require('xtend')
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
    keeper: types.keeper
  }, opts)

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

        const newState = clone(state || {}, change)
        delete newState.topic
        newState.object = body
        cb(null, newState)
      })
    }
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

  // function addContact (change, cb) {
  //   const val = change.value
  //   const permalink = val.permalink
  //   const link = val.link

  //   keeper.get(link, function (err, object) {
  //     if (err) return cb(err)

  //     const prevLink = object[PREVLINK]
  //     const put = getBatch({ link, permalink, object })
  //     let del
  //     if (!prevLink) {
  //       commit()
  //     } else {
  //       keeper.get(prevLink, function (err, prev) {
  //         if (err) return cb(err)

  //         del = getBatch({ permalink, link: object[PREVLINK], object: prev })
  //         commit()
  //       })
  //     }

  //     function commit () {
  //       const batch = utils.encodeBatch(put.concat(del || []))
  //       db.batch(batch, cb)
  //     }
  //   })
  // }

  // function getBatch (identityInfo, op) {
  //   op = op || 'put'
  //   const vals = utils.identityIndices(identityInfo)
  //   return vals.map(val => {
  //     return {
  //       type: op,
  //       key: val,
  //       db: index,
  //       value: identityInfo.link
  //     }
  //   })
  // }

  // function bySecondaryIndex (str, cb) {
  //   typeforce(typeforce.String, str)
  //   processor.onLive(function () {
  //     index.live.get(str, function (err, val) {
  //       // if lookup was issued by `link`, err will be NotFoundError
  //       getBody(val || str, cb)
  //     })
  //   })
  // }

  // function getBody (link, cb) {
  //   typeforce(typeforce.String, link)
  //   keeper.get(link, function (err, object) {
  //     if (err) return cb(err)

  //     cb(null, utils.objectInfo({ link, object }))
  //   })
  // }

  // function createReadStream (opts) {
  //   opts = opts || {}
  //   return pump(
  //     indexedDB.createReadStream(opts),
  //     through.obj(function (link, enc, cb) {
  //       getBody(link, cb)
  //     })
  //   )
  // }

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
        if (err) return done(err)

        match = match || result
        done(null, match)
      })
    }, function (err) {
      if (err) return cb(err)

      cb(null, match)
    })
  }

  function findOneByProp (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  return {
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
  }
}
