'use strict'

const typeforce = require('typeforce')
const clone = require('xtend')
const extend = require('xtend/mutable')

let id = 0
const nextID = () => {
  return '' + (id++)
}

// topics are like actions in react
module.exports = {
  newobj: 'newobj',
  // setidentity: 'setidentity',
  addcontact: 'addcontact',
  tx: 'tx',
  newseal: 'newseal',
  sealed: 'sealed',
  detectedseal: 'detectedseal',
  sent: 'sent',
  received: 'received'
}

// events.newseal = nextID()
// events.addwatch = nextID()
// events.tx = nextID()
// events.newobj = nextID()
// events.addcontact = nextID()
// events.sealed = nextID()
// events.foundseal = nextID()
// events.sent = nextID()
// events.received = nextID()

// module.exports = {
//   seal: 'seal',
//   watch: 'watch',
//   tx: 'tx',
//   obj: 'obj',
//   addcontact: 'addcontact',
//   sent: ''
// }

// const actions = {}
// actions.newobj = function (opts) {
//   typeforce({
//     object: typeforce.String,
//     author: typeforce.String,
//     type: typeforce.String
//   }, opts)

//   const action = {
//     action: events.newobj
//   }

//   extend(action, utils.pick(opts, 'object', 'author', 'type'))
//   if (opts.type === 'tradle.Message') {
//     typeforce({
//       recipient: typeforce.String
//     }, opts)

//     action.recipient = opts.recipient
//   }

//   return action
// }

// const reducers = {}
// reducers.main = function (state, action) {
//   switch (action.action) {
//   case 'newobj':
//     return state || action
//   case 'newseal':
//     if (state.sealstatus) return state

//     return clone(state, { sealstatus: SealStatus.pending })
//   case 'sent':
//     return clone(state, { sendstatus: SendStatus.sent })
//   case 'sealed':
//     return clone(state, { sealstatus: SealStatus.sealed })
//   }
// }

// reducers.newobj = function (state, action) {
//   return state || action
// }

// reducers.sent = function (state, action) {
//   return extend(state, { sendstatus: 'sent' })
// }

// // sketch
// let state = {

// }
