const changesFeed = require('changes-feed')
const utils = require('./utils')

module.exports = function () {
  const feed = changesFeed.apply(null, arguments)
  const append = feed.append
  feed.append = function (data, cb) {
    data.timestamp = data.timestamp || utils.now()
    return append.apply(feed, arguments)
  }
}
