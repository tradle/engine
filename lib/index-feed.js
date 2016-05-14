const levelup = require('levelup')
const typeforce = require('typeforce')
const changesdown = require('changesdown')
const types = require('./types')

module.exports = function (opts) {
  typeforce({
    leveldown: types.leveldown,
    log: types.log,
    db: typeforce.String,
    indexer: typeforce.Function
  }, opts)

  const db = levelup(opts.index, { db: opts.leveldown })
  const indexFeed = changesdown(db, {
    changes: opts.log,
    indexer: opts.indexer
  }, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  })

  return indexFeed
}
