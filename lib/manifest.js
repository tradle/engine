
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
  conversation      : {type: 'readable'},
  pause             : {type: 'sync'},
  resume            : {type: 'sync'},
}

exports.objects = {
  get               : {type: 'async'},
  list              : {type: 'async'},
  type              : {type: 'async'},
  sealed            : {type: 'async'},
  unsealed          : {type: 'async'},
  unsent            : {type: 'async'},
  unsentTo          : {type: 'async'},
  byPermalink       : {type: 'async'},
  from              : {type: 'async'},
  to                : {type: 'async'},
  lastMessage       : {type: 'async'},
  exists            : {type: 'async'},
  messages          : {type: 'async'},
  messagesWithObject: {type: 'async'}
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
  pending           : {type: 'async'},
  sealed            : {type: 'async'},
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
