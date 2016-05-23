
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
  message: 'seal {seal} already exists',
  seal: null
})

exports.WatchExists = TypedError({
  type: 'exists',
  message: 'watch {uid} already exists',
  uid: null
})
