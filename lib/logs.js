
const levelup = require('levelup')
const logs = {}

module.exports = function (opts) {
  const path = opts.path
  if (!logs[path]) {
    logs[path] = levelup(path, { db: opts.leveldown })
  }

  return logs[path]
}
