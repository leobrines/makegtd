/* Unit tests for the encryption layer (js/crypto.js). Run: npm test */
'use strict';

var assert = require('assert');
var path = require('path');

require(path.join(__dirname, '..', 'js', 'crypto.js'));
var gtdCrypto = globalThis.GTD.crypto;

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function rejects(promise, message) {
  return promise.then(
    function () {
      throw new Error('expected rejection ' + message);
    },
    function (err) {
      assert.strictEqual(err.message, message);
    }
  );
}

test('WebCrypto is available in the test environment', function () {
  assert.strictEqual(gtdCrypto.available(), true);
  return Promise.resolve();
});

test('round-trip: decrypt(encrypt(text)) returns the text', function () {
  var text = JSON.stringify({ items: [{ id: 'a', title: 'Llamar al dentista' }] });
  return gtdCrypto.encryptString(text, 'frase secreta').then(function (envelope) {
    return gtdCrypto.decryptString(envelope, 'frase secreta').then(function (out) {
      assert.strictEqual(out, text);
    });
  });
});

test('unicode and empty payloads survive the round-trip', function () {
  return gtdCrypto.encryptString('', 'clave').then(function (envelope) {
    return gtdCrypto.decryptString(envelope, 'clave').then(function (out) {
      assert.strictEqual(out, '');
      var text = 'ñandú 🧭 «mañana»  ';
      return gtdCrypto.encryptString(text, 'clave').then(function (env2) {
        return gtdCrypto.decryptString(env2, 'clave').then(function (out2) {
          assert.strictEqual(out2, text);
        });
      });
    });
  });
});

test('envelope is self-describing JSON with the KDF parameters', function () {
  return gtdCrypto.encryptString('hola', 'clave').then(function (envelopeText) {
    var envelope = JSON.parse(envelopeText);
    assert.strictEqual(envelope.v, 1);
    assert.strictEqual(envelope.kdf, 'PBKDF2-SHA256');
    assert.ok(envelope.iter >= 600000);
    assert.ok(typeof envelope.salt === 'string' && envelope.salt.length > 0);
    assert.ok(typeof envelope.iv === 'string' && envelope.iv.length > 0);
    assert.ok(typeof envelope.data === 'string' && envelope.data.length > 0);
    assert.ok(envelopeText.indexOf('hola') === -1);
    assert.strictEqual(gtdCrypto.isEnvelope(envelopeText), true);
  });
});

test('same plaintext encrypts to different envelopes (fresh salt and iv)', function () {
  return Promise.all([gtdCrypto.encryptString('hola', 'clave'), gtdCrypto.encryptString('hola', 'clave')]).then(
    function (envelopes) {
      var a = JSON.parse(envelopes[0]);
      var b = JSON.parse(envelopes[1]);
      assert.notStrictEqual(a.salt, b.salt);
      assert.notStrictEqual(a.iv, b.iv);
      assert.notStrictEqual(a.data, b.data);
    }
  );
});

test('wrong passphrase rejects with decrypt-failed', function () {
  return gtdCrypto.encryptString('hola', 'clave buena').then(function (envelope) {
    return rejects(gtdCrypto.decryptString(envelope, 'clave mala'), 'decrypt-failed');
  });
});

test('tampered ciphertext rejects with decrypt-failed', function () {
  return gtdCrypto.encryptString('hola', 'clave').then(function (envelopeText) {
    var envelope = JSON.parse(envelopeText);
    var bytes = Buffer.from(envelope.data, 'base64');
    bytes[0] = bytes[0] ^ 0xff;
    envelope.data = bytes.toString('base64');
    return rejects(gtdCrypto.decryptString(JSON.stringify(envelope), 'clave'), 'decrypt-failed');
  });
});

test('garbage and foreign JSON reject with invalid-envelope', function () {
  return rejects(gtdCrypto.decryptString('no es json', 'clave'), 'invalid-envelope').then(function () {
    return rejects(gtdCrypto.decryptString('{"otra":"cosa"}', 'clave'), 'invalid-envelope');
  });
});

test('hostile iteration counts reject with invalid-envelope', function () {
  return gtdCrypto.encryptString('hola', 'clave').then(function (envelopeText) {
    var envelope = JSON.parse(envelopeText);
    envelope.iter = 999999999; // Above the cap: a malicious payload must not freeze the device.
    return rejects(gtdCrypto.decryptString(JSON.stringify(envelope), 'clave'), 'invalid-envelope').then(function () {
      envelope.iter = 0;
      return rejects(gtdCrypto.decryptString(JSON.stringify(envelope), 'clave'), 'invalid-envelope');
    });
  });
});

test('empty passphrase is rejected up front', function () {
  return rejects(gtdCrypto.encryptString('hola', ''), 'invalid-input');
});

test('isEnvelope: cheap shape check without key work', function () {
  assert.strictEqual(gtdCrypto.isEnvelope('no es json'), false);
  assert.strictEqual(gtdCrypto.isEnvelope('{"otra":"cosa"}'), false);
  assert.strictEqual(gtdCrypto.isEnvelope(JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256' })), true);
  return Promise.resolve();
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
