
const TypedError = require('error/typed')
const constants = require('./constants')
const LINK = constants.LINK

exports.ObjectExists = TypedError({
  type: 'exists',
  message: 'object {link} already exists',
  link: null
})

exports.SealExists = TypedError({
  type: 'exists',
  message: 'seal {uid} already exists',
  uid: null
})

exports.WatchExists = TypedError({
  type: 'exists',
  message: 'watch for link {link} and address {address} already exists',
  link: null,
  address: null
})
