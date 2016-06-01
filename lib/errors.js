
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

exports.InvalidSignature = TypedError({
  type: 'invalidsignature',
  message: 'signature {sig} is invalid',
  sig: null
})

exports.Author = TypedError({
  type: 'author',
  message: 'author {author} doesn\'t match signature {sig}',
  sig: null,
  author: null
})
