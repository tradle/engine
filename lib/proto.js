const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const SIG = constants.SIG
const SEQ = constants.SEQ
const PREV_TO_SENDER = constants.PREV_TO_SENDER
const types = require('./types')
const proto = exports.schema = require('protocol-buffers')(`
  ${protocol.protobufs.string}

  message PubKey {
    required PubKeyType type = 1;
    optional ECPubKey ec = 2;
    // optional DSAPubKey dsa = 3;
    // optional RSAPubKey rsa = 4;
  }

  enum PubKeyType {
    EC = 1;
    RSA = 2;
    DSA = 3;
  }

  enum Network {
    btcmain = 1;
    btctest = 2;
  }

  message Message {
    // don't need authorPubKey, SIG, already has it
    // required ECPubKey authorPubKey = 1;
    required ECPubKey recipientPubKey = 1;
    required bytes object = 2;
    required ECSignature ${SIG} = 3;
    optional bytes ${PREV_TO_SENDER} = 4;
    optional uint32 ${SEQ} = 5;
    optional bytes other = 6;
  }
`)

  // message Seal {
  //   required Network network = 1;
  //   // presumably all keys on a network
  //   // are homogenous (e.g. have the save curve)
  //   required bytes basePubKey = 2;
  //   required bytes link = 3;
  // }

  // message Message {
  //   required bytes object = 1;
  //   required Signature sig = 2;
  // }

  // enum IdentifierType {
  //   ROOT = 0;
  //   CUR = 1;
  //   PUBKEY = 2;
  // }

  // message Recipient {
  //   required IdentifierType identifierType = 1;
  //   required bytes identifier = 2;
  // }

  // message TxData {
  //   required bytes merkleRoot = 1;
  //   required Recipient recipient = 2;
  // }

  // message Object {
  //   required bytes json = 1;
  // }

  // message Message {
  //   repeated Header header = 1;
  //   required bytes object = 2;
  // }

  // message Object {
  //   required bytes body = 1;
  //   required Signature sig = 2;
  // }

  // message Object {
  //   required Signature sig = 1;
  //   required bytes body = 2;
  // }

  // message Share {
  //   required Header header = 1;
  //   required Signature sig = 2;
  //   required bytes body = 3;
  // }

// exports.serialize = function (opts) {
//   typeforce({
//     toKey: typeforce.Buffer,
//     object: typeforce.Object
//   }, opts)

//   return proto.Message.encode({
//     header: [
//       {
//         sig: header.sig,
//         sigKey: header.sigKey,
//         sigInput: {
//           merkleRoot: header.sigInput.merkleRoot,
//           recipient: {
//             identifierType: proto.IdentifierType.PUBKEY,
//             identifier: opts.toKey
//           }
//         }
//       }
//     ],
//     object: new Buffer(JSON.stringify(opts.object))
//   })
// }

// exports.unserialize = function (msg) {
//   msg = exports.proto.Message.decode(msg)
//   const sigInput = msg.header[0].sigInput
//   // only pubKeys for now
//   sigInput.recipient = sigInput.recipient.identifier
//   msg.object = JSON.parse(msg.object)
//   msg.headers = msg.header
//   delete msg.header
//   return msg
// }
