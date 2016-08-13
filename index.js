
const tradle = module.exports = exports
// tradle.keeper = require('./lib/keeper')
tradle.protocol = require('@tradle/protocol')
tradle.sender = require('./lib/sender')
tradle.sealer = require('./lib/sealer')
tradle.sealwatch = require('./lib/sealwatch')
tradle.dbs = {
  objects: require('./lib/dbs/objects'),
  // tx: require('./lib/dbs/txs'),
  seals: require('./lib/dbs/seals'),
  watches: require('./lib/dbs/watches'),
  addressBook: require('./lib/dbs/addressBook')
}

tradle.retrystream = require('./lib/retrystream')
tradle.validator = require('./lib/validator')
tradle.types = require('./lib/types')
tradle.utils = require('./lib/utils')
tradle.constants = require('./lib/constants')
// tradle.constants = {
//   status: require('./lib/status'),
//   topics: require('./lib/topics')
// }

tradle.protobuf = require('./lib/proto')
tradle.node = require('./lib/node')
