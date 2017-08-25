
/**
 * API manifests, for promisification, etc.
 * @module manifest
 */

exports.node = {
  sign              : {type: 'async'},
  send              : {type: 'async'},
  signAndSend       : {type: 'async'},
  receive           : {type: 'async'},
  seal              : {type: 'async'},
  watchSeal         : {type: 'async'},
  watchNextVersion  : {type: 'async'},
  forget            : {type: 'async'},
  addContact        : {type: 'async'},
  addContactIdentity: {type: 'async'},
  destroy           : {type: 'async'},
  saveObject        : {type: 'async'},
  createObject      : {type: 'async'},
  objectSealStatus  : {type: 'async'},
  identitySealStatus: {type: 'async'},
  abortMessages     : {type: 'async'},
  abortUnsent       : {type: 'async'},
  conversation      : {type: 'readable'},
  pause             : {type: 'sync'},
  resume            : {type: 'sync'},
}

exports.objects = {
  get               : {type: 'async'},
  list              : {type: 'async'},
  createReadStream  : {type:'readable'},
  type              : {type: 'readable'},
  sealed            : {type: 'readable'},
  unsealed          : {type: 'readable'},
  unsent            : {type: 'readable'},
  unsentTo          : {type: 'readable'},
  byPermalink       : {type: 'async'},
  from              : {type: 'readable'},
  to                : {type: 'readable'},
  lastMessage       : {type: 'async'},
  exists            : {type: 'async'},
  messages          : {type: 'readable'},
  messagesWithObject: {type: 'readable'}
}

exports.addressBook = {
  lookupIdentity    : {type: 'async'},
  byPubKey          : {type: 'async'},
  byFingerprint     : {type: 'async'},
  byPermalink       : {type: 'async'},
  byLink            : {type: 'async'},
  createReadStream  : {type:'readable'}
}

exports.seals = {
  pending           : {type: 'readable'},
  sealed            : {type: 'readable'},
  find              : {type: 'async'},
  findOne           : {type: 'async'},
}

exports.watches = {
  get               : {type: 'async'},
  exists            : {type: 'async'},
  list              : {type: 'async'},
  find              : {type: 'async'},
  findOne           : {type: 'async'},
}
