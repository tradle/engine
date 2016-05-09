const levelup = require('levelup')
const ixfeed = require('index-feed')
const through = require('through2')
const collect = require('stream-collector')
const logs = require('./logs')
const feeds = {}

module.exports = function (opts) {
  const path = opts.index
  let feed = feeds[path]
  if (!feed) {
    var logDB = logs(opts.log)
    var indexDB = levelup(path, { opts.leveldown })
    feed = feeds[path] = ixfeed({
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
  }

  return feed
}
