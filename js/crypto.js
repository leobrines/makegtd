/* End-to-end encryption for sync payloads (local-first phase 2).
 *
 * The sync transport (Google Drive, S3, WebDAV…) must never see readable GTD
 * data: documents are encrypted on-device before upload with a key derived
 * from a passphrase the user types once per device. Single-user system, so
 * there is no key exchange: same passphrase on every device, nothing stored
 * server-side, and losing the passphrase only loses the remote copies (each
 * device keeps its own plaintext replica).
 *
 * Everything is native WebCrypto (no dependencies): PBKDF2-SHA256 for key
 * derivation, AES-256-GCM for authenticated encryption. GCM authentication
 * doubles as integrity: a wrong passphrase and a tampered payload both fail
 * the same way. Requires a secure context (https or localhost), which the
 * PWA already needs for its service worker.
 *
 * Envelope: a self-describing JSON string carrying the KDF parameters, so
 * iterations can be raised later while old payloads keep decrypting:
 *   {"v":1,"kdf":"PBKDF2-SHA256","iter":600000,"salt":"…","iv":"…","data":"…"}
 */
(function (global) {
  'use strict';

  var VERSION = 1;
  var KDF = 'PBKDF2-SHA256';
  var KDF_ITERATIONS = 600000; // OWASP-recommended work factor for PBKDF2-SHA256.
  var MAX_ITERATIONS = 10000000; // Cap when decrypting: a hostile envelope must not DoS the device.
  var SALT_BYTES = 16;
  var IV_BYTES = 12; // AES-GCM standard nonce size.

  var subtle = global.crypto && global.crypto.subtle;

  function available() {
    return !!subtle;
  }

  function toBase64(bytes) {
    bytes = new Uint8Array(bytes);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin);
  }

  function fromBase64(text) {
    var bin = global.atob(text);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Key derivation is deliberately slow (~hundreds of ms); cache derived keys
  // per (salt, iterations, passphrase) so decrypting several device payloads
  // in one sync, or re-syncing in the same session, pays the cost once.
  var keyCache = {};

  function deriveKey(passphrase, salt, iterations) {
    var cacheKey = toBase64(salt) + ':' + iterations + ':' + passphrase;
    if (!keyCache[cacheKey]) {
      keyCache[cacheKey] = subtle
        .importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
        .then(function (material) {
          return subtle.deriveKey(
            { name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iterations },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
        });
    }
    return keyCache[cacheKey];
  }

  function encryptString(plaintext, passphrase) {
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    if (typeof plaintext !== 'string' || typeof passphrase !== 'string' || !passphrase) {
      return Promise.reject(new Error('invalid-input'));
    }
    var salt = global.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    var iv = global.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    return deriveKey(passphrase, salt, KDF_ITERATIONS)
      .then(function (key) {
        return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext));
      })
      .then(function (ciphertext) {
        return JSON.stringify({
          v: VERSION,
          kdf: KDF,
          iter: KDF_ITERATIONS,
          salt: toBase64(salt),
          iv: toBase64(iv),
          data: toBase64(ciphertext),
        });
      });
  }

  // Rejects with 'invalid-envelope' (not our format) or 'decrypt-failed'
  // (wrong passphrase or tampered data — GCM cannot tell them apart).
  function decryptString(envelopeText, passphrase) {
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    var envelope;
    try {
      envelope = JSON.parse(envelopeText);
    } catch (err) {
      return Promise.reject(new Error('invalid-envelope'));
    }
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      envelope.v !== VERSION ||
      envelope.kdf !== KDF ||
      typeof envelope.salt !== 'string' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.data !== 'string' ||
      !(Number(envelope.iter) >= 1 && Number(envelope.iter) <= MAX_ITERATIONS)
    ) {
      return Promise.reject(new Error('invalid-envelope'));
    }
    var salt, iv, data;
    try {
      salt = fromBase64(envelope.salt);
      iv = fromBase64(envelope.iv);
      data = fromBase64(envelope.data);
    } catch (err) {
      return Promise.reject(new Error('invalid-envelope'));
    }
    return deriveKey(passphrase, salt, Number(envelope.iter))
      .then(function (key) {
        return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data).then(
          function (buf) {
            return new TextDecoder().decode(buf);
          },
          function () {
            throw new Error('decrypt-failed');
          }
        );
      });
  }

  // True if the text looks like one of our envelopes (cheap shape check, no
  // key work). Lets the sync layer tell foreign/corrupt files apart from
  // wrong-passphrase failures.
  function isEnvelope(text) {
    try {
      var e = JSON.parse(text);
      return !!e && typeof e === 'object' && e.v === VERSION && e.kdf === KDF;
    } catch (err) {
      return false;
    }
  }

  global.GTD = global.GTD || {};
  global.GTD.crypto = {
    available: available,
    encryptString: encryptString,
    decryptString: decryptString,
    isEnvelope: isEnvelope,
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
