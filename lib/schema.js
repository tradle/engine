// This file is auto generated by the protocol-buffers compiler

/* eslint-disable quotes */
/* eslint-disable indent */
/* eslint-disable no-redeclare */
/* eslint-disable camelcase */

// Remember to `npm install --save protocol-buffers-encodings`
var encodings = require('protocol-buffers-encodings')
var varint = encodings.varint
var skip = encodings.skip

exports.Network = {
  none: 1,
  btcmain: 2,
  btctest: 3,
  ethmain: 4,
  ethropsten: 5,
  ethmorden: 6,
  ethrinkeby: 7
}

exports.KeyType = {
  bitcoin: 1,
  ec: 2,
  dsa: 3,
  ethereum: 4
}

exports.ECurve = {
  none: 1,
  ed25519: 2,
  secp256k1: 3,
  p256: 4,
  curve25519: 5
}

exports.KeyPurpose = {
  payment: 1,
  sign: 2,
  update: 3,
  messaging: 4,
  tls: 5
}

var Message = exports.Message = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var Seal = exports.Seal = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var PubKey = exports.PubKey = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var Identity = exports.Identity = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var ECSignature = exports.ECSignature = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var ECPubKey = exports.ECPubKey = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

defineMessage()
defineSeal()
definePubKey()
defineIdentity()
defineECSignature()
defineECPubKey()

function defineMessage () {
  Message.encodingLength = encodingLength
  Message.encode = encode
  Message.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.object)) throw new Error("object is required")
    var len = encodings.bytes.encodingLength(obj.object)
    length += 1 + len
    if (!defined(obj._author)) throw new Error("_author is required")
    var len = encodings.bytes.encodingLength(obj._author)
    length += 1 + len
    if (!defined(obj._recipient)) throw new Error("_recipient is required")
    var len = encodings.bytes.encodingLength(obj._recipient)
    length += 1 + len
    if (!defined(obj._s)) throw new Error("_s is required")
    var len = ECSignature.encodingLength(obj._s)
    length += varint.encodingLength(len)
    length += 1 + len
    if (defined(obj._q)) {
      var len = encodings.bytes.encodingLength(obj._q)
      length += 1 + len
    }
    if (defined(obj._n)) {
      var len = encodings.varint.encodingLength(obj._n)
      length += 1 + len
    }
    if (defined(obj.other)) {
      var len = encodings.bytes.encodingLength(obj.other)
      length += 1 + len
    }
    if (defined(obj.seal)) {
      var len = Seal.encodingLength(obj.seal)
      length += varint.encodingLength(len)
      length += 1 + len
    }
    if (defined(obj.time)) {
      var len = encodings.varint.encodingLength(obj.time)
      length += 1 + len
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.object)) throw new Error("object is required")
    buf[offset++] = 10
    encodings.bytes.encode(obj.object, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (!defined(obj._author)) throw new Error("_author is required")
    buf[offset++] = 18
    encodings.bytes.encode(obj._author, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (!defined(obj._recipient)) throw new Error("_recipient is required")
    buf[offset++] = 26
    encodings.bytes.encode(obj._recipient, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (!defined(obj._s)) throw new Error("_s is required")
    buf[offset++] = 34
    varint.encode(ECSignature.encodingLength(obj._s), buf, offset)
    offset += varint.encode.bytes
    ECSignature.encode(obj._s, buf, offset)
    offset += ECSignature.encode.bytes
    if (defined(obj._q)) {
      buf[offset++] = 42
      encodings.bytes.encode(obj._q, buf, offset)
      offset += encodings.bytes.encode.bytes
    }
    if (defined(obj._n)) {
      buf[offset++] = 48
      encodings.varint.encode(obj._n, buf, offset)
      offset += encodings.varint.encode.bytes
    }
    if (defined(obj.other)) {
      buf[offset++] = 58
      encodings.bytes.encode(obj.other, buf, offset)
      offset += encodings.bytes.encode.bytes
    }
    if (defined(obj.seal)) {
      buf[offset++] = 66
      varint.encode(Seal.encodingLength(obj.seal), buf, offset)
      offset += varint.encode.bytes
      Seal.encode(obj.seal, buf, offset)
      offset += Seal.encode.bytes
    }
    if (defined(obj.time)) {
      buf[offset++] = 72
      encodings.varint.encode(obj.time, buf, offset)
      offset += encodings.varint.encode.bytes
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      object: null,
      _author: null,
      _recipient: null,
      _s: null,
      _q: null,
      _n: 0,
      other: null,
      seal: null,
      time: 0
    }
    var found0 = false
    var found1 = false
    var found2 = false
    var found3 = false
    while (true) {
      if (end <= offset) {
        if (!found0 || !found1 || !found2 || !found3) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj.object = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found0 = true
        break
        case 2:
        obj._author = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found1 = true
        break
        case 3:
        obj._recipient = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found2 = true
        break
        case 4:
        var len = varint.decode(buf, offset)
        offset += varint.decode.bytes
        obj._s = ECSignature.decode(buf, offset, offset + len)
        offset += ECSignature.decode.bytes
        found3 = true
        break
        case 5:
        obj._q = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        break
        case 6:
        obj._n = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        break
        case 7:
        obj.other = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        break
        case 8:
        var len = varint.decode(buf, offset)
        offset += varint.decode.bytes
        obj.seal = Seal.decode(buf, offset, offset + len)
        offset += Seal.decode.bytes
        break
        case 9:
        obj.time = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineSeal () {
  Seal.encodingLength = encodingLength
  Seal.encode = encode
  Seal.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.network)) throw new Error("network is required")
    var len = encodings.string.encodingLength(obj.network)
    length += 1 + len
    if (!defined(obj.basePubKey)) throw new Error("basePubKey is required")
    var len = encodings.bytes.encodingLength(obj.basePubKey)
    length += 1 + len
    if (!defined(obj.link)) throw new Error("link is required")
    var len = encodings.bytes.encodingLength(obj.link)
    length += 1 + len
    if (!defined(obj.blockchain)) throw new Error("blockchain is required")
    var len = encodings.string.encodingLength(obj.blockchain)
    length += 1 + len
    if (!defined(obj.headerHash)) throw new Error("headerHash is required")
    var len = encodings.bytes.encodingLength(obj.headerHash)
    length += 1 + len
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.network)) throw new Error("network is required")
    buf[offset++] = 10
    encodings.string.encode(obj.network, buf, offset)
    offset += encodings.string.encode.bytes
    if (!defined(obj.basePubKey)) throw new Error("basePubKey is required")
    buf[offset++] = 18
    encodings.bytes.encode(obj.basePubKey, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (!defined(obj.link)) throw new Error("link is required")
    buf[offset++] = 26
    encodings.bytes.encode(obj.link, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (!defined(obj.blockchain)) throw new Error("blockchain is required")
    buf[offset++] = 34
    encodings.string.encode(obj.blockchain, buf, offset)
    offset += encodings.string.encode.bytes
    if (!defined(obj.headerHash)) throw new Error("headerHash is required")
    buf[offset++] = 42
    encodings.bytes.encode(obj.headerHash, buf, offset)
    offset += encodings.bytes.encode.bytes
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      network: "",
      basePubKey: null,
      link: null,
      blockchain: "",
      headerHash: null
    }
    var found0 = false
    var found1 = false
    var found2 = false
    var found3 = false
    var found4 = false
    while (true) {
      if (end <= offset) {
        if (!found0 || !found1 || !found2 || !found3 || !found4) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj.network = encodings.string.decode(buf, offset)
        offset += encodings.string.decode.bytes
        found0 = true
        break
        case 2:
        obj.basePubKey = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found1 = true
        break
        case 3:
        obj.link = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found2 = true
        break
        case 4:
        obj.blockchain = encodings.string.decode(buf, offset)
        offset += encodings.string.decode.bytes
        found3 = true
        break
        case 5:
        obj.headerHash = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found4 = true
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function definePubKey () {
  PubKey.encodingLength = encodingLength
  PubKey.encode = encode
  PubKey.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.type)) throw new Error("type is required")
    var len = encodings.enum.encodingLength(obj.type)
    length += 1 + len
    if (!defined(obj.purpose)) throw new Error("purpose is required")
    var len = encodings.enum.encodingLength(obj.purpose)
    length += 1 + len
    if (!defined(obj.pub)) throw new Error("pub is required")
    var len = encodings.bytes.encodingLength(obj.pub)
    length += 1 + len
    if (defined(obj.curve)) {
      var len = encodings.enum.encodingLength(obj.curve)
      length += 1 + len
    }
    if (defined(obj.network)) {
      var len = encodings.enum.encodingLength(obj.network)
      length += 1 + len
    }
    if (defined(obj.fingerprint)) {
      var len = encodings.bytes.encodingLength(obj.fingerprint)
      length += 1 + len
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.type)) throw new Error("type is required")
    buf[offset++] = 8
    encodings.enum.encode(obj.type, buf, offset)
    offset += encodings.enum.encode.bytes
    if (!defined(obj.purpose)) throw new Error("purpose is required")
    buf[offset++] = 16
    encodings.enum.encode(obj.purpose, buf, offset)
    offset += encodings.enum.encode.bytes
    if (!defined(obj.pub)) throw new Error("pub is required")
    buf[offset++] = 26
    encodings.bytes.encode(obj.pub, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (defined(obj.curve)) {
      buf[offset++] = 32
      encodings.enum.encode(obj.curve, buf, offset)
      offset += encodings.enum.encode.bytes
    }
    if (defined(obj.network)) {
      buf[offset++] = 40
      encodings.enum.encode(obj.network, buf, offset)
      offset += encodings.enum.encode.bytes
    }
    if (defined(obj.fingerprint)) {
      buf[offset++] = 50
      encodings.bytes.encode(obj.fingerprint, buf, offset)
      offset += encodings.bytes.encode.bytes
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      type: 1,
      purpose: 1,
      pub: null,
      curve: 1,
      network: 1,
      fingerprint: null
    }
    var found0 = false
    var found1 = false
    var found2 = false
    while (true) {
      if (end <= offset) {
        if (!found0 || !found1 || !found2) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj.type = encodings.enum.decode(buf, offset)
        offset += encodings.enum.decode.bytes
        found0 = true
        break
        case 2:
        obj.purpose = encodings.enum.decode(buf, offset)
        offset += encodings.enum.decode.bytes
        found1 = true
        break
        case 3:
        obj.pub = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found2 = true
        break
        case 4:
        obj.curve = encodings.enum.decode(buf, offset)
        offset += encodings.enum.decode.bytes
        break
        case 5:
        obj.network = encodings.enum.decode(buf, offset)
        offset += encodings.enum.decode.bytes
        break
        case 6:
        obj.fingerprint = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineIdentity () {
  Identity.encodingLength = encodingLength
  Identity.encode = encode
  Identity.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj._s)) throw new Error("_s is required")
    var len = encodings.bytes.encodingLength(obj._s)
    length += 1 + len
    if (defined(obj._p)) {
      var len = encodings.bytes.encodingLength(obj._p)
      length += 1 + len
    }
    if (defined(obj._r)) {
      var len = encodings.bytes.encodingLength(obj._r)
      length += 1 + len
    }
    if (defined(obj.pubkeys)) {
      for (var i = 0; i < obj.pubkeys.length; i++) {
        if (!defined(obj.pubkeys[i])) continue
        var len = PubKey.encodingLength(obj.pubkeys[i])
        length += varint.encodingLength(len)
        length += 1 + len
      }
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj._s)) throw new Error("_s is required")
    buf[offset++] = 10
    encodings.bytes.encode(obj._s, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (defined(obj._p)) {
      buf[offset++] = 18
      encodings.bytes.encode(obj._p, buf, offset)
      offset += encodings.bytes.encode.bytes
    }
    if (defined(obj._r)) {
      buf[offset++] = 26
      encodings.bytes.encode(obj._r, buf, offset)
      offset += encodings.bytes.encode.bytes
    }
    if (defined(obj.pubkeys)) {
      for (var i = 0; i < obj.pubkeys.length; i++) {
        if (!defined(obj.pubkeys[i])) continue
        buf[offset++] = 34
        varint.encode(PubKey.encodingLength(obj.pubkeys[i]), buf, offset)
        offset += varint.encode.bytes
        PubKey.encode(obj.pubkeys[i], buf, offset)
        offset += PubKey.encode.bytes
      }
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      _s: null,
      _p: null,
      _r: null,
      pubkeys: []
    }
    var found0 = false
    while (true) {
      if (end <= offset) {
        if (!found0) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj._s = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found0 = true
        break
        case 2:
        obj._p = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        break
        case 3:
        obj._r = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        break
        case 4:
        var len = varint.decode(buf, offset)
        offset += varint.decode.bytes
        obj.pubkeys.push(PubKey.decode(buf, offset, offset + len))
        offset += PubKey.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineECSignature () {
  ECSignature.encodingLength = encodingLength
  ECSignature.encode = encode
  ECSignature.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.pubKey)) throw new Error("pubKey is required")
    var len = ECPubKey.encodingLength(obj.pubKey)
    length += varint.encodingLength(len)
    length += 1 + len
    if (!defined(obj.sig)) throw new Error("sig is required")
    var len = encodings.bytes.encodingLength(obj.sig)
    length += 1 + len
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.pubKey)) throw new Error("pubKey is required")
    buf[offset++] = 10
    varint.encode(ECPubKey.encodingLength(obj.pubKey), buf, offset)
    offset += varint.encode.bytes
    ECPubKey.encode(obj.pubKey, buf, offset)
    offset += ECPubKey.encode.bytes
    if (!defined(obj.sig)) throw new Error("sig is required")
    buf[offset++] = 18
    encodings.bytes.encode(obj.sig, buf, offset)
    offset += encodings.bytes.encode.bytes
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      pubKey: null,
      sig: null
    }
    var found0 = false
    var found1 = false
    while (true) {
      if (end <= offset) {
        if (!found0 || !found1) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        var len = varint.decode(buf, offset)
        offset += varint.decode.bytes
        obj.pubKey = ECPubKey.decode(buf, offset, offset + len)
        offset += ECPubKey.decode.bytes
        found0 = true
        break
        case 2:
        obj.sig = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found1 = true
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineECPubKey () {
  ECPubKey.encodingLength = encodingLength
  ECPubKey.encode = encode
  ECPubKey.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.curve)) throw new Error("curve is required")
    var len = encodings.string.encodingLength(obj.curve)
    length += 1 + len
    if (!defined(obj.pub)) throw new Error("pub is required")
    var len = encodings.bytes.encodingLength(obj.pub)
    length += 1 + len
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.curve)) throw new Error("curve is required")
    buf[offset++] = 10
    encodings.string.encode(obj.curve, buf, offset)
    offset += encodings.string.encode.bytes
    if (!defined(obj.pub)) throw new Error("pub is required")
    buf[offset++] = 18
    encodings.bytes.encode(obj.pub, buf, offset)
    offset += encodings.bytes.encode.bytes
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      curve: "",
      pub: null
    }
    var found0 = false
    var found1 = false
    while (true) {
      if (end <= offset) {
        if (!found0 || !found1) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj.curve = encodings.string.decode(buf, offset)
        offset += encodings.string.decode.bytes
        found0 = true
        break
        case 2:
        obj.pub = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found1 = true
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defined (val) {
  return val !== null && val !== undefined && (typeof val !== 'number' || !isNaN(val))
}