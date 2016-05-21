const debug = require('debug')('tradle:reducer')
const statuses = require('./status')
const SealStatus = statuses.seal
const SendStatus = statuses.send
const topics = require('./topics')
const utils = require('./utils')
const constants = require('./constants')

module.exports = {
  objectDB: objectDBReducer,
  // addressBook: addressBookReducer
}

function objectDBReducer (state, change) {
  state = state && utils.clone(state)

  switch (change.topic) {
  case topics.newobj:
    if (state && state.uid === change.uid) {
      throw new Error('refusing to overwrite existing object')
      // return state
    }

    // if (state && change.type && state.type !== change.type) {
    //   throw new Error('refusing to change object type')
    // }

    state = utils.omit(change, 'topic')
    if (state.type === constants.TYPES.MESSAGE) {
      state.sendstatus = SendStatus.pending
    }

    break
  case topics.queueseal:
    if (state && state.sealstatus === SealStatus.sealed) {
      throw new Error('invalid change, sealed already exists')
      // return state
    }

    state = state || utils.omit(change, 'topic')
    state.sealstatus = SealStatus.pending
    break
  case topics.wroteseal:
  // TODO: differentiate between seals written
  // by node owner and others
  case topics.readseal:
    state.sealstatus = SealStatus.sealed
    state.txId = change.txId
    break
  case topics.sent:
    if (state.sendstatus === SendStatus.sent) {
      throw new Error('invalid change, message already sent')
      // return state
    }

    state.sendstatus = SendStatus.sent
    break
  }

  return state
}
