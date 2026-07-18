/* Unit tests for the pure helpers of the sync core (js/syncer.js). Run: npm test */
'use strict';

var assert = require('assert');
var path = require('path');

require(path.join(__dirname, '..', 'js', 'crypto.js'));
require(path.join(__dirname, '..', 'js', 'syncer.js'));
var pure = globalThis.GTD.syncer._pure;
var gtdCrypto = globalThis.GTD.crypto;

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

test('device file names round-trip and reject foreign names', function () {
  var name = pure.deviceFileName('a1b2c3d4');
  assert.strictEqual(name, 'gtd-device-a1b2c3d4.json');
  assert.strictEqual(pure.isDeviceFile(name), true);
  assert.strictEqual(pure.isDeviceFile('gtd-device-.json'), false);
  assert.strictEqual(pure.isDeviceFile('otra-cosa.json'), false);
  assert.strictEqual(pure.isDeviceFile(null), false);
});

test('normalizeServerUrl canonicalizes what users type', function () {
  assert.strictEqual(pure.normalizeServerUrl('sync.example.com'), 'https://sync.example.com');
  assert.strictEqual(pure.normalizeServerUrl(' https://sync.example.com/ '), 'https://sync.example.com');
  assert.strictEqual(pure.normalizeServerUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.strictEqual(pure.normalizeServerUrl('https://host.tld/base/path/'), 'https://host.tld/base/path');
  assert.strictEqual(pure.normalizeServerUrl('https://host.tld/?q=1'), null);
  assert.strictEqual(pure.normalizeServerUrl('ftp://host.tld'), null);
  assert.strictEqual(pure.normalizeServerUrl(''), null);
  assert.strictEqual(pure.normalizeServerUrl('   '), null);
});

test('normalizeConfig accepts current gdrive and server shapes', function () {
  var gdrive = pure.normalizeConfig({ provider: 'gdrive', passphrase: 'p', gdrive: { clientId: ' abc.apps ' } });
  assert.deepStrictEqual(gdrive, { provider: 'gdrive', passphrase: 'p', gdrive: { clientId: 'abc.apps' } });
  var server = pure.normalizeConfig({ provider: 'server', passphrase: 'p', server: { url: 'sync.example.com/', key: ' k1 ' } });
  assert.deepStrictEqual(server, { provider: 'server', passphrase: 'p', server: { url: 'https://sync.example.com', key: 'k1' } });
});

test('normalizeConfig migrates the legacy gdrive-only shape', function () {
  var migrated = pure.normalizeConfig({ clientId: 'abc.apps', passphrase: 'p' });
  assert.deepStrictEqual(migrated, { provider: 'gdrive', passphrase: 'p', gdrive: { clientId: 'abc.apps' } });
});

test('normalizeConfig rejects incomplete configs', function () {
  assert.strictEqual(pure.normalizeConfig(null), null);
  assert.strictEqual(pure.normalizeConfig({}), null);
  assert.strictEqual(pure.normalizeConfig({ provider: 'gdrive', passphrase: '', gdrive: { clientId: 'x' } }), null);
  assert.strictEqual(pure.normalizeConfig({ provider: 'gdrive', passphrase: 'p', gdrive: { clientId: '  ' } }), null);
  assert.strictEqual(pure.normalizeConfig({ provider: 'server', passphrase: 'p', server: { url: 'bad url', key: 'k' } }), null);
  assert.strictEqual(pure.normalizeConfig({ provider: 'server', passphrase: 'p', server: { url: 'https://h.tld', key: '' } }), null);
  assert.strictEqual(pure.normalizeConfig({ provider: 'otro', passphrase: 'p' }), null);
});

test('key file round-trips through build + parse', function () {
  var config = pure.normalizeConfig({ provider: 'server', passphrase: 'frase', server: { url: 'https://s.tld', key: 'k1' } });
  var parsed = pure.parseKeyFile(pure.buildKeyFile(config));
  assert.deepStrictEqual(parsed, { url: 'https://s.tld', key: 'k1', passphrase: 'frase' });
});

test('buildKeyFile only applies to the server provider', function () {
  assert.strictEqual(pure.buildKeyFile(pure.normalizeConfig({ clientId: 'x', passphrase: 'p' })), null);
  assert.strictEqual(pure.buildKeyFile(null), null);
});

test('parseKeyFile rejects foreign or incomplete files', function () {
  assert.throws(function () {
    pure.parseKeyFile('{"otra":"cosa"}');
  }, /invalid-key-file/);
  assert.throws(function () {
    pure.parseKeyFile(JSON.stringify({ makegtd: 1, type: 'sync-server', url: 'https://s.tld' }));
  }, /invalid-key-file/);
  assert.throws(function () {
    pure.parseKeyFile('no es json');
  });
});

test('an exported key file decrypts and parses on the other device', function () {
  var config = pure.normalizeConfig({ provider: 'server', passphrase: 'frase', server: { url: 'https://s.tld', key: 'k1' } });
  return gtdCrypto.encryptString(pure.buildKeyFile(config), 'password del archivo').then(function (envelope) {
    assert.strictEqual(gtdCrypto.isEnvelope(envelope), true);
    return gtdCrypto.decryptString(envelope, 'password del archivo').then(function (json) {
      assert.deepStrictEqual(pure.parseKeyFile(json), { url: 'https://s.tld', key: 'k1', passphrase: 'frase' });
    });
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
