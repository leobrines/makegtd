/* Unit tests for the device vault (js/vault.js). Run: npm test
 *
 * Exercises the recovery-code path and the at-rest string crypto, which run
 * entirely on Node's WebCrypto. The biometric (WebAuthn PRF) path needs a
 * browser authenticator and is not covered here. */
'use strict';

var assert = require('assert');
var path = require('path');

// Minimal localStorage shim (the vault record lives here). Node has WebCrypto,
// btoa/atob and TextEncoder globally.
globalThis.localStorage = (function () {
  var store = {};
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem: function (k, v) {
      store[k] = String(v);
    },
    removeItem: function (k) {
      delete store[k];
    },
  };
})();

require(path.join(__dirname, '..', 'js', 'vault.js'));
var vault = globalThis.GTD.vault;

var CODE = 'correct-horse-battery';

function reset() {
  globalThis.localStorage.removeItem('gtd:vault');
  vault.lock();
}

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function rejectsWith(promise, message) {
  return promise.then(
    function () {
      throw new Error('expected rejection ' + message);
    },
    function (err) {
      assert.strictEqual(err.message, message);
    }
  );
}

test('WebCrypto is available and biometric is not (Node)', function () {
  assert.strictEqual(vault.available(), true);
  return vault.biometricSupported().then(function (ok) {
    assert.strictEqual(ok, false);
  });
});

test('enroll (recovery-only) turns the vault on and unlocks the session', function () {
  reset();
  assert.strictEqual(vault.isEnrolled(), false);
  return vault.enroll({ recoveryCode: CODE, useBiometric: false }).then(function (res) {
    assert.strictEqual(res.biometric, false);
    assert.ok(res.key);
    assert.strictEqual(vault.isEnrolled(), true);
    assert.strictEqual(vault.hasBiometric(), false);
    assert.strictEqual(vault.isUnlocked(), true);
  });
});

test('enroll rejects a weak recovery code and a second enrollment', function () {
  reset();
  return rejectsWith(vault.enroll({ recoveryCode: 'short', useBiometric: false }), 'weak-recovery').then(function () {
    return vault.enroll({ recoveryCode: CODE, useBiometric: false }).then(function () {
      return rejectsWith(vault.enroll({ recoveryCode: CODE, useBiometric: false }), 'already-enrolled');
    });
  });
});

test('wrapString/unwrapString round-trip under the data key; wrong key fails', function () {
  reset();
  return vault.enroll({ recoveryCode: CODE, useBiometric: false }).then(function (res) {
    var text = JSON.stringify({ items: [{ id: 'a', title: 'ñandú 🧭' }] });
    return vault.wrapString(res.key, text).then(function (envelope) {
      assert.strictEqual(vault.isWrapped(envelope), true);
      // Our at-rest envelope must not be confused with a sync (kdf) envelope.
      assert.strictEqual(vault.isWrapped(JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256' })), false);
      assert.strictEqual(vault.isWrapped('no json'), false);
      return vault.unwrapString(res.key, envelope).then(function (out) {
        assert.strictEqual(out, text);
      });
    });
  });
});

test('lock then unlock: correct code restores a working key, wrong code fails', function () {
  reset();
  var envelope;
  return vault
    .enroll({ recoveryCode: CODE, useBiometric: false })
    .then(function (res) {
      return vault.wrapString(res.key, 'secreto');
    })
    .then(function (env) {
      envelope = env;
      vault.lock();
      assert.strictEqual(vault.isUnlocked(), false);
      return rejectsWith(vault.unlockWithRecovery('nope-nope-nope'), 'unlock-failed');
    })
    .then(function () {
      return vault.unlockWithRecovery(CODE);
    })
    .then(function (key) {
      assert.strictEqual(vault.isUnlocked(), true);
      return vault.unwrapString(key, envelope).then(function (out) {
        assert.strictEqual(out, 'secreto');
      });
    });
});

test('changeRecovery keeps the same data key (old envelopes still decrypt)', function () {
  reset();
  var NEW = 'staple-battery-horse';
  var envelope;
  return vault
    .enroll({ recoveryCode: CODE, useBiometric: false })
    .then(function (res) {
      return vault.wrapString(res.key, 'persistente');
    })
    .then(function (env) {
      envelope = env;
      return vault.changeRecovery(CODE, NEW);
    })
    .then(function () {
      vault.lock();
      return rejectsWith(vault.unlockWithRecovery(CODE), 'unlock-failed');
    })
    .then(function () {
      return vault.unlockWithRecovery(NEW);
    })
    .then(function (key) {
      return vault.unwrapString(key, envelope).then(function (out) {
        assert.strictEqual(out, 'persistente'); // Same DEK survived the code change.
      });
    });
});

test('unwrapString rejects a tampered or foreign envelope', function () {
  reset();
  return vault.enroll({ recoveryCode: CODE, useBiometric: false }).then(function (res) {
    return rejectsWith(vault.unwrapString(res.key, 'not-an-envelope'), 'invalid-envelope').then(function () {
      return vault.wrapString(res.key, 'x').then(function (env) {
        var obj = JSON.parse(env);
        obj.data = vault._pure.toBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
        return rejectsWith(vault.unwrapString(res.key, JSON.stringify(obj)), 'unlock-failed');
      });
    });
  });
});

test('disable removes the vault record', function () {
  reset();
  return vault.enroll({ recoveryCode: CODE, useBiometric: false }).then(function () {
    assert.strictEqual(vault.isEnrolled(), true);
    vault.disable();
    assert.strictEqual(vault.isEnrolled(), false);
  });
});

// ---- Runner (async, sequential) ----

var failed = 0;
tests
  .reduce(function (chain, t) {
    return chain.then(function () {
      return Promise.resolve()
        .then(t.fn)
        .then(
          function () {
            console.log('PASS  ' + t.name);
          },
          function (err) {
            failed++;
            console.error('FAIL  ' + t.name + '\n      ' + err.message);
          }
        );
    });
  }, Promise.resolve())
  .then(function () {
    console.log('\n' + (tests.length - failed) + '/' + tests.length + ' tests passed');
    process.exit(failed ? 1 : 0);
  });
