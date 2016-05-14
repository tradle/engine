const levelup = require('levelup')
const changesFeed = require('changes-feed')
const logs = {}

module.exports = function log (path, opts) {
  if (!logs[path]) {
    if (opts.valueEncoding) opts.valueEncoding = 'binary'

    logs[path] = changesFeed(levelup(path, opts))
  }

  return logs[path]
}
