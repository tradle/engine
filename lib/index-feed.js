const levelup = require('levelup')
const ixfeed = require('index-feed')
const through = require('through2')
const collect = require('stream-collector')

module.exports = function (opts) {
  const logDB = levelup(opts.log, { db: opts.leveldown })
  const indexDB = levelup(opts.index, { opts.leveldown })
  const feed =ixfeed({
    data: logDB,
    index: indexDB,
    valueEncoding: 'json'
  })

  feed.index.firstWithValue = function (indexName, value, cb) {
    utils.firstFromIndex(ixf.index, indexName, value, cb)
  }

  feed.index.getWithValue = function (indexName, value, cb) {
    utils.getFromIndex(ixf.index, indexName, value, cb)
  }

  return feed
}
