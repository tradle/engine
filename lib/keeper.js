
const levelup = require('levelup')

module.exports = function keeper (opts) {
  // may want to have a safe/dangerous API
  //   safe: generate key from value on 'put'
  //   dangerous: accept passed in key on 'put'
  return levelup(opts.path, opts)
}
