/**
 * @module  errors
 */

const TypedError = require('error/typed')
const constants = require('./constants')
const LINK = constants.LINK

exports.ObjectExists = TypedError({
  type: 'exists',
  message: 'object {link} already exists',
  link: null
})

exports.MessageExists = TypedError({
  type: 'exists',
  message: 'message {link} already exists',
  link: null
})

exports.AlreadySaving = TypedError({
  type: 'saving',
  message: 'already saving object with link {link}',
  link: null
})

exports.SealExists = TypedError({
  type: 'exists',
  message: 'seal {seal} already exists',
  seal: null
})

exports.WatchExists = TypedError({
  type: 'exists',
  message: 'watch with address {address} and link {link} already exists',
  address: null,
  link: null
})

exports.InvalidSignature = TypedError({
  type: 'invalidsignature',
  message: 'signature {sig} is invalid: {reason}',
  sig: null,
  reason: 'verification failed'
})

exports.Author = TypedError({
  type: 'author',
  message: 'author {author} doesn\'t match signature {sig}',
  sig: null,
  author: null
})

exports.InvalidVersion = TypedError({
  type: 'version',
  message: 'object is incorrectly versioned: {error}',
  error: null
})

exports.InvalidPartial = TypedError({
  type: 'partial',
  message: 'partial is malformed: {error}',
  error: null
})

exports.UnknownIdentity = TypedError({
  type: 'unknownidentity',
  message: 'unknown identity: {query}',
  query: null
})
