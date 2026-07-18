/* Unit tests for the pure helpers of the Drive transport (js/drive.js). Run: npm test */
'use strict';

var assert = require('assert');
var path = require('path');

require(path.join(__dirname, '..', 'js', 'drive.js'));
var pure = globalThis.GTD.drive._pure;

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

test('buildAuthUrl targets the Google auth endpoint with the implicit flow', function () {
  var url = new URL(
    pure.buildAuthUrl({
      clientId: '123-abc.apps.googleusercontent.com',
      redirectUri: 'https://makegtd.example/app/',
      state: 'st4te',
    })
  );
  assert.strictEqual(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(url.searchParams.get('client_id'), '123-abc.apps.googleusercontent.com');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://makegtd.example/app/');
  assert.strictEqual(url.searchParams.get('response_type'), 'token');
  assert.strictEqual(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
  assert.strictEqual(url.searchParams.get('state'), 'st4te');
});

test('parseFragment reads the token response Google redirects back with', function () {
  var parsed = pure.parseFragment('#state=st4te&access_token=ya29.tok&token_type=Bearer&expires_in=3599&scope=x');
  assert.strictEqual(parsed.accessToken, 'ya29.tok');
  assert.strictEqual(parsed.expiresIn, 3599);
  assert.strictEqual(parsed.state, 'st4te');
  assert.strictEqual(parsed.error, null);
});

test('parseFragment reads error responses', function () {
  var parsed = pure.parseFragment('#error=access_denied&state=st4te');
  assert.strictEqual(parsed.error, 'access_denied');
  assert.strictEqual(parsed.accessToken, null);
});

test('parseFragment ignores ordinary app routes', function () {
  assert.strictEqual(pure.parseFragment('#/hoy'), null);
  assert.strictEqual(pure.parseFragment('#/ajustes'), null);
  assert.strictEqual(pure.parseFragment(''), null);
  assert.strictEqual(pure.parseFragment(undefined), null);
});

test('device file names round-trip and reject foreign names', function () {
  var name = pure.deviceFileName('a1b2c3d4');
  assert.strictEqual(name, 'gtd-device-a1b2c3d4.json');
  assert.strictEqual(pure.isDeviceFile(name), true);
  assert.strictEqual(pure.isDeviceFile('gtd-device-.json'), false);
  assert.strictEqual(pure.isDeviceFile('otra-cosa.json'), false);
  assert.strictEqual(pure.isDeviceFile('gtd-device-abc.txt'), false);
  assert.strictEqual(pure.isDeviceFile(null), false);
});

test('multipartBody builds a well-formed multipart/related payload', function () {
  var body = pure.multipartBody('BOUND', { name: 'f.json', parents: ['appDataFolder'] }, '{"v":1}');
  var parts = body.split('--BOUND');
  assert.strictEqual(parts.length, 4); // preamble, metadata, media, closing.
  assert.ok(parts[1].indexOf('Content-Type: application/json; charset=UTF-8') !== -1);
  assert.ok(parts[1].indexOf('"appDataFolder"') !== -1);
  assert.ok(parts[2].indexOf('{"v":1}') !== -1);
  assert.ok(body.slice(-9) === '--BOUND--');
});

var failed = 0;
tests.forEach(function (t) {
  try {
    t.fn();
    console.log('PASS  ' + t.name);
  } catch (err) {
    failed++;
    console.error('FAIL  ' + t.name + '\n      ' + err.message);
  }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' tests passed');
process.exit(failed ? 1 : 0);
