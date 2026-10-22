'use strict';
/**
 * Assinatura dos replies gRPC (equivalente ao sign_reply do server.py).
 *
 * O app (DTunnel) valida a assinatura de cada resposta com a chave publica EC
 * guardada em wz.h (base64 do X509/SPKI DER). Buffer assinado:
 *
 *   "dtunnel-rpc-v1\0" | int32(len(method)) | method | nonce(32) |
 *   int64(issued) | int64(expires) | int64(len(pub)) | pub
 *
 * e a assinatura (SHA256withECDSA, DER) vai no trailer "x-dtunnel-signature-bin".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RPC_PREFIX = Buffer.from('dtunnel-rpc-v1\0', 'binary');
const SIG_HEADER = 'x-dtunnel-signature-bin';
const NONCE_HEADER = 'x-dtunnel-nonce-bin';
const ISSUED_HEADER = 'x-dtunnel-issued';
const EXPIRES_HEADER = 'x-dtunnel-expires';
const KEYID_HEADER = 'x-dtunnel-key-id';
const REPLY_KEY_ID = 'd19f969fd77d34f6';
const TTL_MS = 300000;

class ReplySigner {
  constructor(keyPath, serverDir) {
    this.keyPath = keyPath || path.join(serverDir || path.join(path.resolve(__dirname, '..'), 'keys'), 'server_reply.key');
    this.enabled = false;
    this.key = null;
    this.pubDer = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.keyPath)) {
        console.warn(`[signer] chave de reply ausente: ${this.keyPath}`);
        return;
      }
      const pem = fs.readFileSync(this.keyPath, 'utf8');
      const key = crypto.createPrivateKey(pem);
      if (key.asymmetricKeyType !== 'ec') {
        console.warn(`[signer] chave nao-ecc ignorada (${key.asymmetricKeyType})`);
        return;
      }
      this.key = key;
      // SPKI DER: DER do SubjectPublicKeyInfo, que e o que o app decodifica
      const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
      this.pubDer = spki;
      this.enabled = true;
      console.log(`[signer] assinatura de reply ativa (pub ${spki.length} bytes)`);
    } catch (e) {
      console.warn(`[signer] falha ao carregar chave: ${e.message}`);
    }
  }

  /** Monta o buffer assinado (big-endian, igual ao ByteBuffer do Java). */
  buildBuffer(methodName, nonce, issued, expires) {
    const m = Buffer.from(methodName, 'utf8');
    const len = Buffer.alloc(4);
    len.writeInt32BE(m.length, 0);
    const issuedBuf = Buffer.alloc(8);
    issuedBuf.writeBigInt64BE(BigInt(issued), 0);
    const expiresBuf = Buffer.alloc(8);
    expiresBuf.writeBigInt64BE(BigInt(expires), 0);
    const pubLen = Buffer.alloc(8);
    pubLen.writeBigInt64BE(BigInt(this.pubDer.length), 0);
    return Buffer.concat([RPC_PREFIX, len, m, nonce, issuedBuf, expiresBuf, pubLen, this.pubDer]);
  }

  /**
   * Monta os trailers x-dtunnel-* para a resposta.
   * @param {string} methodName nome do metodo RPC (ex.: "GetConfig")
   * @param {Buffer} nonce nonce de 32 bytes recebido no header x-dtunnel-nonce-bin
   * @returns {Array} array de pares [key, value] para trailing metadata
   */
  trailers(methodName, nonce) {
    if (!this.enabled) return [];
    let n = nonce;
    if (!n) {
      n = Buffer.alloc(0);
    } else if (typeof n === 'string') {
      // pode chegar como base64 (grpc-js converte -bin para base64 em getMap)
      n = Buffer.from(n, 'base64');
    } else if (!Buffer.isBuffer(n)) {
      n = Buffer.from(String(n), 'latin1');
    }
    if (n.length !== 32) {
      console.warn(`[signer] nonce invalido (${n.length} bytes) em ${methodName}`);
      n = Buffer.alloc(32);
    }
    const issued = Date.now();
    const expires = issued + TTL_MS;
    const buf = this.buildBuffer(methodName, n, issued, expires);
    const sig = crypto.sign('sha256', buf, { key: this.key, dsaEncoding: 'der' });
    return [
      [SIG_HEADER, sig],
      [ISSUED_HEADER, String(issued)],
      [EXPIRES_HEADER, String(expires)],
      [KEYID_HEADER, REPLY_KEY_ID],
      [NONCE_HEADER, n],
    ];
  }
}

module.exports = { ReplySigner, SIG_HEADER, NONCE_HEADER, ISSUED_HEADER, EXPIRES_HEADER, KEYID_HEADER, REPLY_KEY_ID };
