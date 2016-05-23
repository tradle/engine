const debug = require('debug')('tradle:reducer')
const statuses = require('./status')
const SealStatus = statuses.seal
const SendStatus = statuses.send
const topics = require('./topics')
const utils = require('./utils')
const constants = require('./constants')
const docTypes = constants.docTypes
const CONFIRMED_AFTER = 10

module.exports = {
  object: objReducer,
  seal: sealReducer,
  watch: watchReducer,
  // tx: txReducer
}

// function reducer (state, change) {
//   const docType = state ? state._type : change._type
//   if (!docType) throw new Error('expected "_type"')

//   const docReducer = reducers[docType]
//   if (!docType) throw new Error('unknown doc type: ' + docType)

//   return docReducer(state, change)
// }

// function txReducer (state, change) {
//   if (state) state = utils.clone(state)

//   switch (change.topic) {
//   case topics.tx:
//     state = state || utils.omit(change, 'topic')
//     if ('confirmations' in change) {
//       state.confirmations = change.confirmations
//       if (state.confirmations >= CONFIRMED_AFTER) {
//         state.confirmed = true
//       }
//     }

//     break
//   }

//   return state
// }

function watchReducer (state, change) {
  if (state) state = utils.clone(state)

  switch (change.topic) {
  case topics.newwatch:
    state = utils.omit(change, 'topic')
    break
  case topics.readseal:
    state = state || utils.omit(change, 'topic')
    state.txId = change.txId
    if ('confirmations' in change) {
      state.confirmations = change.confirmations
      if (state.confirmations >= CONFIRMED_AFTER) {
        // state.confirmed = true
        // delete this watch
        return null
      }
    }

    break
  }

  if (!state.uid) state.uid = utils.watchUID(state)

  return state
}

function sealReducer (state, change) {
  if (state) state = utils.clone(state)

  switch (change.topic) {
  case topics.queueseal:
    if (state && state.status === SealStatus.sealed) {
      throw new Error('invalid change, sealed already exists')
      // return state
    }

    state = state || utils.omit(change, 'topic')
    state.status = SealStatus.pending
    break
  // TODO: differentiate between seals written
  // by node owner and others
  case topics.readseal:
    utils.extend(state, utils.omit(change, 'topic'))
  case topics.wroteseal:
    state.status = SealStatus.sealed
    state.txId = change.txId
    break
  }

  return state
}

// function watchReducer (state, change) {
//   if (state) state = utils.clone(state)

//   switch (change.topic) {
//   case topics.watch:
//     if (state && state.status === SealStatus.sealed) {
//       throw new Error('invalid change, sealed already exists')
//       // return state
//     }

//     state = state || utils.omit(change, 'topic')
//     state.status = SealStatus.pending
//     break
//   // TODO: differentiate between seals written
//   // by node owner and others
//   case topics.readseal:
//     utils.extend(state, utils.omit(change, 'topic'))
//   case topics.wroteseal:
//     state.status = SealStatus.sealed
//     state.txId = change.txId
//     break
//   }

//   return state
// }

function objReducer (state, change) {
  if (state) state = utils.clone(state)

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
    if (!state) return state

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
