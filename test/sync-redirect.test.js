/* Regression test: the Google Drive OAuth redirect must not lose the sync
 * config when encryption at rest (the device vault) is on. Run: npm test
 *
 * With a vault enrolled the config is persisted asynchronously (encrypt ->
 * localStorage.setItem) and the plaintext copy is dropped synchronously. The
 * gdrive backend then leaves the page for Google's consent screen. If sync()
 * redirects before the encrypted write reaches disk, the config is lost and the
 * return trip reports 'not-configured' ("No se pudo conectar con Google").
 * syncer.sync() awaits syncer.whenConfigPersisted() first to prevent this. */
'use strict';

var assert = require('assert');
var path = require('path');

// ---- Minimal browser globals ----------------------------------------------

function makeStorage() {
  var map = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; },
    _dump: function () { return JSON.parse(JSON.stringify(map)); },
    _restore: function (d) { map = JSON.parse(JSON.stringify(d)); },
  };
}

globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

var assignedUrls = [];
var diskAtAssign = null;
globalThis.location = {
  origin: 'https://app.example',
  pathname: '/',
  search: '',
  hostname: 'app.example',
  href: 'https://app.example/',
  assign: function (url) {
    diskAtAssign = globalThis.localStorage._dump(); // What is durable when we leave.
    assignedUrls.push(url);
  },
};
globalThis.history = { replaceState: function () {}, go: function () {} };

globalThis.fetch = function (url, options) {
  var params = new URLSearchParams(String((options && options.body) || ''));
  var ok = !!params.get('client_id') && !!params.get('code_verifier');
  return Promise.resolve({
    ok: ok,
    status: ok ? 200 : 400,
    json: function () { return Promise.resolve(ok ? { access_token: 'tok', expires_in: 3600 } : { error: 'bad' }); },
    text: function () { return Promise.resolve(''); },
  });
};

var ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'crypto.js'));
require(path.join(ROOT, 'js', 'sync.js'));
require(path.join(ROOT, 'js', 'vault.js'));
require(path.join(ROOT, 'js', 'syncer.js'));
require(path.join(ROOT, 'js', 'drive.js'));

var GTD = globalThis.GTD;

// Make the config encryption slow so it would lose the race with the redirect
// unless sync() explicitly waits for it. Long enough to never land on its own
// during the test.
(function slowConfigEncrypt() {
  var real = GTD.vault.wrapString;
  GTD.vault.wrapString = function (key, plaintext) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () { real.call(GTD.vault, key, plaintext).then(resolve, reject); }, 4000);
    });
  };
})();

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('sync() does not redirect until the encrypted config is durable', async function () {
  await GTD.vault.enroll({ recoveryCode: 'recovery-code-123', useBiometric: false });
  await GTD.syncer.loadConfig();

  assert.ok(GTD.syncer.setGdriveConfig('123-abc.apps.googleusercontent.com', 'GOCSPX-secret', 'passphrase-xyz'));

  var result = await GTD.syncer.sync();
  assert.ok(result.redirecting, 'gdrive backend redirected to Google');
  // Let connect()'s PKCE digest resolve and call location.assign.
  await new Promise(function (r) { setTimeout(r, 30); });
  assert.strictEqual(assignedUrls.length, 1, 'exactly one redirect happened');

  // The core guarantee: the encrypted config was on disk before navigation, and
  // the plaintext copy is (correctly) not lingering.
  assert.ok(diskAtAssign['gtd:sync:config:enc'], 'CONFIG_ENC_KEY durable at redirect time');
  assert.ok(!diskAtAssign['gtd:sync:config'], 'no plaintext config left behind');
});

test('the OAuth return trip recovers the config and exchanges the code', async function () {
  // Emulate a fresh page load with only what survived the navigation on disk.
  globalThis.localStorage._restore(diskAtAssign);
  GTD.vault.lock();
  await GTD.vault.unlockWithRecovery('recovery-code-123');
  await GTD.syncer.loadConfig();

  var config = GTD.syncer.getConfig();
  assert.ok(config && config.gdrive, 'config recovered after the redirect');
  assert.strictEqual(config.gdrive.clientId, '123-abc.apps.googleusercontent.com');

  globalThis.location.search = '?code=4/authcode&state=' + globalThis.sessionStorage.getItem('gtd:gd:state');
  var auth = await GTD.drive.handleRedirect(config);
  assert.deepStrictEqual(auth, { ok: true }, 'token exchange proceeded (no not-configured error)');
});

(async function () {
  var failed = 0;
  for (var i = 0; i < tests.length; i++) {
    try {
      await tests[i].fn();
      console.log('PASS  ' + tests[i].name);
    } catch (err) {
      failed++;
      console.error('FAIL  ' + tests[i].name + '\n      ' + (err && err.message));
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' tests passed');
  process.exit(failed ? 1 : 0);
})();
