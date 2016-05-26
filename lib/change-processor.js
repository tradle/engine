
const subdown = require('subleveldown')
const changeProcessor = require('level-change-processor')
const utils = require('./utils')

module.exports = function createChangeProcessor (opts) {
  const processor = changeProcessor({
    feed: opts.feed,
    db: subdown(opts.db, opts.counterPrefix || '~'),
    worker: opts.worker
  })

  utils.live(opts.db, processor)
  return processor
}
