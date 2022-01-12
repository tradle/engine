/**
 * protocol buffers schema
 * @module protobufs
 */

const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const {
  SIG,
  SEQ,
  PREV_TO_RECIPIENT,
  PREVLINK,
  PERMALINK,
  AUTHOR,
  RECIPIENT,
} = constants
const types = require('./types')
const proto = exports.schema = require('protocol-buffers')(`
  ${protocol.protobufs.string}

  // message PubKey {
  //   required PubKeyType type = 1;
  //   optional ECPubKey ec = 2;
  //   // optional DSAPubKey dsa = 3;
  //   // optional RSAPubKey rsa = 4;
  // }

  // enum PubKeyType {
  //   EC = 1;
  //   RSA = 2;
  //   DSA = 3;
  // }

  message Message {
    required bytes object = 1;
    required bytes ${AUTHOR} = 2;
    required bytes ${RECIPIENT} = 3;
    required ECSignature ${SIG} = 4;
    optional bytes ${PREV_TO_RECIPIENT} = 5;
    optional uint32 ${SEQ} = 6;
    optional bytes other = 7;
    optional Seal seal = 8;
    optional uint64 time = 9;
  }

  enum Network {
    none = 1;
    btcmain = 2;
    btctest = 3;
    ethmain = 4;
    ethropsten = 5;
    ethmorden = 6;
    ethrinkeby = 7;
  }

  message Seal {
    required string network = 1;
    // presumably all keys on a network
    // are homogenous (e.g. have the save curve for elliptic curve based networks)
    required bytes basePubKey = 2;
    required bytes link = 3;
    required string blockchain = 4;
    required bytes headerHash = 5;
  }

  enum KeyType {
    bitcoin = 1;
    ec = 2;
    dsa = 3;
    ethereum  = 4;
  }

  enum ECurve {
    none = 1;
    ed25519 = 2;
    secp256k1 = 3;
    p256 = 4;
    curve25519 = 5;
  }

  enum KeyPurpose {
    payment = 1;
    sign = 2;
    update = 3;
    messaging = 4;
    tls = 5;
  }

  message PubKey {
    required KeyType type = 1;
    required KeyPurpose purpose = 2;
    required bytes pub = 3;
    optional ECurve curve = 4 [default = none];
    optional Network network = 5 [default = none];
    optional bytes fingerprint = 6;
  }

  message Identity {
    required bytes ${SIG} = 1;
    optional bytes ${PREVLINK} = 2;
    optional bytes ${PERMALINK} = 3;
    repeated PubKey pubkeys = 4;
  }
`)

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
//     object: Buffer.from(JSON.stringify(opts.object))
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
