/* Device vault: encryption at rest for the local replica (local-first phase 4).
 *
 * The E2E sync layer (js/crypto.js) protects data on its way to a backend, but
 * the on-device replica (IndexedDB and the localStorage fallback) and the sync
 * secrets (js/syncer.js config: the passphrase and the server access key) used
 * to sit in the clear — readable by malware, a browser extension, a stolen
 * device, a profile backup or a forensic tool. This module encrypts all of
 * that at rest behind a key the device only releases after the user proves
 * presence, using what modern browsers already expose as a keychain:
 *
 *  - WebAuthn platform authenticator + the PRF extension: Touch ID / Face ID /
 *    Windows Hello / a fingerprint sensor both gate access AND derive a stable
 *    32-byte secret, released only after the biometric/PIN check. That secret
 *    never leaves the authenticator's control and is not stored anywhere.
 *  - A non-extractable AES-GCM CryptoKey: the working data key (DEK) is
 *    imported so its raw bytes never return to JavaScript, so a script running
 *    in the page (XSS, extension) cannot exfiltrate it for offline profile
 *    decryption — it can only ask the browser to use it while the tab lives.
 *
 * Key hierarchy (envelope encryption):
 *   DEK (random 32 bytes) encrypts the app document + sync config at rest.
 *   The DEK is wrapped once per unlock method and only the wrapped forms are
 *   stored:
 *     - recovery: PBKDF2-SHA256(recovery code) -> KEK -> AES-GCM wrap. Always
 *       present so losing/resetting the biometric never bricks the data; the
 *       user also keeps the JSON export as a last resort.
 *     - biometric (optional): HKDF(WebAuthn PRF output) -> KEK -> AES-GCM wrap.
 *   Both wrap the SAME DEK, so either method unlocks the same data.
 *
 * The vault record (localStorage 'gtd:vault') is device-local: it is never part
 * of the synced document and never included in the JSON export/import.
 *
 * Everything is native WebCrypto; requires a secure context (https/localhost),
 * which the PWA already needs. If WebCrypto is missing the vault reports itself
 * unavailable and the app runs unencrypted-at-rest as before.
 */
(function (global) {
  'use strict';

  var VAULT_KEY = 'gtd:vault';
  var VERSION = 1;
  var KDF_ITERATIONS = 600000; // Matches js/crypto.js (OWASP PBKDF2-SHA256).
  var MAX_ITERATIONS = 10000000; // Cap so a tampered record cannot DoS unlock.
  var SALT_BYTES = 16;
  var IV_BYTES = 12;
  var DEK_BYTES = 32; // AES-256.
  var PRF_SALT_BYTES = 32;

  var subtle = global.crypto && global.crypto.subtle;

  // The unlocked data key for this session (non-extractable AES-GCM CryptoKey),
  // or null while locked. Single source of truth for js/store.js and
  // js/syncer.js at-rest crypto.
  var sessionKey = null;

  function available() {
    return !!subtle;
  }

  // ---- base64 <-> bytes (same shape as js/crypto.js) ----

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

  function randomBytes(n) {
    return global.crypto.getRandomValues(new Uint8Array(n));
  }

  // ---- Low-level AES-GCM over raw bytes (used to wrap the DEK) ----

  function aesGcmEncrypt(kek, bytes) {
    var iv = randomBytes(IV_BYTES);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, kek, bytes).then(function (ct) {
      return { iv: toBase64(iv), data: toBase64(ct) };
    });
  }

  // Rejects (OperationError) on a wrong key or tampered data — GCM auth.
  function aesGcmDecrypt(kek, ivB64, dataB64) {
    return subtle
      .decrypt({ name: 'AES-GCM', iv: fromBase64(ivB64) }, kek, fromBase64(dataB64))
      .then(function (buf) {
        return new Uint8Array(buf);
      });
  }

  // ---- Key derivation ----

  function deriveKekFromCode(code, salt, iterations) {
    return subtle
      .importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
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

  // HKDF domain-separates the raw PRF secret into an AES-GCM wrapping key.
  function deriveKekFromPrf(prfBytes) {
    return subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']).then(function (material) {
      return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('makegtd-vault-kek') },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  // The DEK is imported non-extractable: its raw bytes never come back to JS.
  function importDek(dekBytes) {
    return subtle.importKey('raw', dekBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  // ---- Vault record (device-local storage) ----

  function readVault() {
    try {
      var raw = global.localStorage.getItem(VAULT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeVault(record) {
    global.localStorage.setItem(VAULT_KEY, JSON.stringify(record));
  }

  function isEnrolled() {
    var record = readVault();
    return !!(record && record.methods && record.methods.recovery);
  }

  function hasBiometric() {
    var record = readVault();
    return !!(record && record.methods && record.methods.biometric);
  }

  function isUnlocked() {
    return !!sessionKey;
  }

  function getKey() {
    return sessionKey;
  }

  // ---- WebAuthn (platform authenticator + PRF) ----

  // Async: the platform has a user-verifying built-in authenticator. PRF
  // support itself can only be confirmed by actually enrolling, so the UI
  // treats biometric as best-effort and always keeps the recovery code.
  function biometricSupported() {
    if (!global.PublicKeyCredential || !global.navigator || !global.navigator.credentials) {
      return Promise.resolve(false);
    }
    return global.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then(function (ok) {
        return !!ok;
      })
      .catch(function () {
        return false;
      });
  }

  function rpId() {
    return global.location.hostname;
  }

  // Registers a resident platform credential and returns its id plus the PRF
  // output for prfSalt. Some browsers hand back the PRF result at creation;
  // the rest need an immediate assertion, so we fall back to get().
  function createBiometricCredential(prfSalt) {
    var pk = {
      challenge: randomBytes(32),
      rp: { name: 'makeGTD', id: rpId() },
      user: { id: randomBytes(16), name: 'makeGTD', displayName: 'makeGTD' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    };
    return global.navigator.credentials.create({ publicKey: pk }).then(function (cred) {
      if (!cred) throw new Error('biometric-cancelled');
      var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
      var prf = ext && ext.prf;
      if (prf && prf.enabled === false) throw new Error('prf-unsupported');
      if (prf && prf.results && prf.results.first) {
        return { credentialId: new Uint8Array(cred.rawId), prfOutput: new Uint8Array(prf.results.first) };
      }
      // No PRF at creation: obtain it with a follow-up assertion.
      return getPrfOutput(new Uint8Array(cred.rawId), prfSalt).then(function (out) {
        return { credentialId: new Uint8Array(cred.rawId), prfOutput: out };
      });
    });
  }

  function getPrfOutput(credentialId, prfSalt) {
    var pk = {
      challenge: randomBytes(32),
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: credentialId, transports: ['internal', 'hybrid'] }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    };
    return global.navigator.credentials.get({ publicKey: pk }).then(function (assertion) {
      if (!assertion) throw new Error('biometric-cancelled');
      var ext = assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
      if (!ext || !ext.prf || !ext.prf.results || !ext.prf.results.first) throw new Error('prf-unavailable');
      return new Uint8Array(ext.prf.results.first);
    });
  }

  // Wraps the DEK under a fresh biometric credential and returns the record
  // fragment to store. Rejects (leaving the caller free to keep recovery-only)
  // if the user declines or the platform lacks PRF.
  function buildBiometricMethod(dekBytes) {
    var prfSalt = randomBytes(PRF_SALT_BYTES);
    return createBiometricCredential(prfSalt).then(function (res) {
      return deriveKekFromPrf(res.prfOutput)
        .then(function (kek) {
          return aesGcmEncrypt(kek, dekBytes);
        })
        .then(function (wrapped) {
          return {
            credentialId: toBase64(res.credentialId),
            prfSalt: toBase64(prfSalt),
            iv: wrapped.iv,
            wrapped: wrapped.data,
          };
        });
    });
  }

  // ---- Enrollment ----

  // Turns encryption at rest on. recoveryCode is mandatory (the always-present
  // fallback). useBiometric attempts to also register a biometric unlock;
  // failure there is non-fatal and reported as biometricError. Resolves the
  // session DEK (CryptoKey) so the caller can re-persist the store encrypted.
  function enroll(opts) {
    opts = opts || {};
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    var code = opts.recoveryCode;
    if (typeof code !== 'string' || code.length < 8) return Promise.reject(new Error('weak-recovery'));
    if (isEnrolled()) return Promise.reject(new Error('already-enrolled'));

    var dek = randomBytes(DEK_BYTES);
    var salt = randomBytes(SALT_BYTES);
    var record = { v: VERSION, methods: {} };
    var biometricError = null;

    return deriveKekFromCode(code, salt, KDF_ITERATIONS)
      .then(function (kek) {
        return aesGcmEncrypt(kek, dek);
      })
      .then(function (wrapped) {
        record.methods.recovery = { salt: toBase64(salt), iter: KDF_ITERATIONS, iv: wrapped.iv, wrapped: wrapped.data };
        if (!opts.useBiometric) return;
        return buildBiometricMethod(dek).then(
          function (method) {
            record.methods.biometric = method;
          },
          function (err) {
            biometricError = String((err && err.message) || err);
          }
        );
      })
      .then(function () {
        writeVault(record);
        return importDek(dek);
      })
      .then(function (key) {
        sessionKey = key;
        return { key: key, biometric: !!record.methods.biometric, biometricError: biometricError };
      });
  }

  // Adds a biometric unlock to a recovery-only vault. Needs the recovery code
  // to recover the raw DEK (the session key is non-extractable, so it cannot
  // be re-wrapped directly).
  function addBiometric(recoveryCode) {
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    var record = readVault();
    if (!record || !record.methods || !record.methods.recovery) return Promise.reject(new Error('not-enrolled'));
    var m = record.methods.recovery;
    return unwrapDek(recoveryCode, m).then(function (dek) {
      return buildBiometricMethod(dek).then(function (method) {
        record.methods.biometric = method;
        writeVault(record);
        return true;
      });
    });
  }

  // Replaces the recovery code, keeping the same DEK (so stored data still
  // decrypts) and any biometric method untouched.
  function changeRecovery(currentCode, newCode) {
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    if (typeof newCode !== 'string' || newCode.length < 8) return Promise.reject(new Error('weak-recovery'));
    var record = readVault();
    if (!record || !record.methods || !record.methods.recovery) return Promise.reject(new Error('not-enrolled'));
    return unwrapDek(currentCode, record.methods.recovery).then(function (dek) {
      var salt = randomBytes(SALT_BYTES);
      return deriveKekFromCode(newCode, salt, KDF_ITERATIONS)
        .then(function (kek) {
          return aesGcmEncrypt(kek, dek);
        })
        .then(function (wrapped) {
          record.methods.recovery = { salt: toBase64(salt), iter: KDF_ITERATIONS, iv: wrapped.iv, wrapped: wrapped.data };
          writeVault(record);
          return true;
        });
    });
  }

  // Removes the vault record (turns encryption at rest off). The caller
  // (js/store.js) must re-persist the document in the clear afterwards. The
  // session key is kept so in-flight writes still work until then.
  function disable() {
    try {
      global.localStorage.removeItem(VAULT_KEY);
    } catch (ignored) {}
  }

  // ---- Unlock ----

  function unwrapDek(code, recoveryMethod) {
    var iter = Number(recoveryMethod.iter);
    if (!(iter >= 1 && iter <= MAX_ITERATIONS)) return Promise.reject(new Error('invalid-vault'));
    var salt;
    try {
      salt = fromBase64(recoveryMethod.salt);
    } catch (err) {
      return Promise.reject(new Error('invalid-vault'));
    }
    return deriveKekFromCode(code, salt, iter).then(function (kek) {
      return aesGcmDecrypt(kek, recoveryMethod.iv, recoveryMethod.wrapped).then(null, function () {
        throw new Error('unlock-failed'); // Wrong code or tampered record.
      });
    });
  }

  function unlockWithRecovery(code) {
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    var record = readVault();
    if (!record || !record.methods || !record.methods.recovery) return Promise.reject(new Error('not-enrolled'));
    return unwrapDek(code, record.methods.recovery)
      .then(importDek)
      .then(function (key) {
        sessionKey = key;
        return key;
      });
  }

  function unlockWithBiometric() {
    if (!available()) return Promise.reject(new Error('webcrypto-unavailable'));
    var record = readVault();
    if (!record || !record.methods || !record.methods.biometric) return Promise.reject(new Error('no-biometric'));
    var m = record.methods.biometric;
    var credentialId, prfSalt;
    try {
      credentialId = fromBase64(m.credentialId);
      prfSalt = fromBase64(m.prfSalt);
    } catch (err) {
      return Promise.reject(new Error('invalid-vault'));
    }
    return getPrfOutput(credentialId, prfSalt)
      .then(deriveKekFromPrf)
      .then(function (kek) {
        return aesGcmDecrypt(kek, m.iv, m.wrapped).then(null, function () {
          throw new Error('unlock-failed');
        });
      })
      .then(importDek)
      .then(function (key) {
        sessionKey = key;
        return key;
      });
  }

  // Clears the in-memory key (used when locking the app / tests).
  function lock() {
    sessionKey = null;
  }

  // ---- At-rest document/string crypto (used by store.js and syncer.js) ----

  // Self-describing envelope, distinct from the sync envelope (js/crypto.js):
  // this one is keyed by the session DEK, not a passphrase, so it carries no
  // KDF parameters. { v, iv, data } base64.
  function wrapString(key, plaintext) {
    key = key || sessionKey;
    if (!key) return Promise.reject(new Error('locked'));
    var iv = randomBytes(IV_BYTES);
    return subtle
      .encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(String(plaintext)))
      .then(function (ct) {
        return JSON.stringify({ v: VERSION, iv: toBase64(iv), data: toBase64(ct) });
      });
  }

  function unwrapString(key, envelopeText) {
    key = key || sessionKey;
    if (!key) return Promise.reject(new Error('locked'));
    var env;
    try {
      env = JSON.parse(envelopeText);
    } catch (err) {
      return Promise.reject(new Error('invalid-envelope'));
    }
    if (!env || env.v !== VERSION || typeof env.iv !== 'string' || typeof env.data !== 'string') {
      return Promise.reject(new Error('invalid-envelope'));
    }
    var iv, data;
    try {
      iv = fromBase64(env.iv);
      data = fromBase64(env.data);
    } catch (err) {
      return Promise.reject(new Error('invalid-envelope'));
    }
    return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data).then(
      function (buf) {
        return new TextDecoder().decode(buf);
      },
      function () {
        throw new Error('unlock-failed');
      }
    );
  }

  // Cheap shape check: is this text one of our at-rest envelopes?
  function isWrapped(text) {
    try {
      var e = JSON.parse(text);
      return !!e && e.v === VERSION && typeof e.iv === 'string' && typeof e.data === 'string' && !e.kdf;
    } catch (err) {
      return false;
    }
  }

  global.GTD = global.GTD || {};
  global.GTD.vault = {
    available: available,
    biometricSupported: biometricSupported,
    isEnrolled: isEnrolled,
    hasBiometric: hasBiometric,
    isUnlocked: isUnlocked,
    getKey: getKey,
    enroll: enroll,
    addBiometric: addBiometric,
    changeRecovery: changeRecovery,
    disable: disable,
    unlockWithRecovery: unlockWithRecovery,
    unlockWithBiometric: unlockWithBiometric,
    lock: lock,
    wrapString: wrapString,
    unwrapString: unwrapString,
    isWrapped: isWrapped,
    _pure: {
      toBase64: toBase64,
      fromBase64: fromBase64,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
