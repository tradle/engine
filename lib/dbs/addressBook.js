
'use strict'

const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
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
  const db = opts.db
  const processor = changeProcessor({
    feed: opts.changes,
    db: db,
    worker: worker
  })

  // processor.on('live', console.log.bind(console, 'live'))

  // secondary index map to current hash

  // TODO: move this to indexers
  const dbOpts = { valueEncoding: utils.defaultValueEncoding }
  const byPermalink = utils.live(subdown(db, 'r', dbOpts), processor)
  const index = utils.live(subdown(db, 's', dbOpts), processor)

  function worker (change, cb) {
    const val = change.value
    switch (val.topic) {
    case topics.addcontact:
      return addContact(change, cb)
    // case topics.setidentity:
    //   return setIdentity(change, cb)

    }

    cb()
  }

  function addContact (change, cb) {
    const val = change.value
    const permalink = val.permalink
    const link = val.link

    keeper.get(link, function (err, object) {
      if (err) return cb(err)

      const prevLink = object[PREVLINK]
      const put = getBatch({ link, permalink, object })
      let del
      if (!prevLink) {
        commit()
      } else {
        keeper.get(prevLink, function (err, prev) {
          if (err) return cb(err)

          del = getBatch({ permalink, link: object[PREVLINK], object: prev })
          commit()
        })
      }

      function commit () {
        const batch = utils.encodeBatch(put.concat(del || []))
        db.batch(batch, cb)
      }
    })
  }

  function getBatch (identityInfo, op) {
    op = op || 'put'
    const vals = utils.identityIndices(identityInfo)
    return vals.map(val => {
      return {
        type: op,
        key: val,
        db: index,
        value: identityInfo.link
      }
    })
  }

  function bySecondaryIndex (str, cb) {
    typeforce(typeforce.String, str)
    processor.onLive(function () {
      index.live.get(str, function (err, val) {
        // if lookup was issued by `link`, err will be NotFoundError
        getBody(val || str, cb)
      })
    })
  }

  function getBody (link, cb) {
    typeforce(typeforce.String, link)
    keeper.get(link, function (err, object) {
      if (err) return cb(err)

      cb(null, utils.objectInfo({ link, object }))
    })
  }

  function createReadStream (opts) {
    opts = opts || {}
    return pump(
      db.live.createReadStream({
        keys: false,
        gt: byPermalink.db.prefix,
        lt: byPermalink.db.prefix + '\xff'
      }),
      through.obj(function (link, enc, cb) {
        getBody(link, cb)
      })
    )
  }

  return {
    _db: db,
    lookupIdentity: bySecondaryIndex,
    createReadStream: createReadStream
  }
}
