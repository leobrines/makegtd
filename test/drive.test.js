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

test('buildAuthUrl targets the Google auth endpoint with the PKCE code flow', function () {
  var url = new URL(
    pure.buildAuthUrl({
      clientId: '123-abc.apps.googleusercontent.com',
      redirectUri: 'https://makegtd.example/app/',
      state: 'st4te',
      codeChallenge: 'abc123challenge',
    })
  );
  assert.strictEqual(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(url.searchParams.get('client_id'), '123-abc.apps.googleusercontent.com');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://makegtd.example/app/');
  assert.strictEqual(url.searchParams.get('response_type'), 'code'); // Not the implicit token.
  assert.strictEqual(url.searchParams.get('code_challenge'), 'abc123challenge');
  assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
  assert.strictEqual(url.searchParams.get('state'), 'st4te');
  // Offline access so background sync can refresh the token without re-consent.
  assert.strictEqual(url.searchParams.get('access_type'), 'offline');
  assert.strictEqual(url.searchParams.get('prompt'), 'consent');
});

test('base64url encodes without padding or +/ characters', function () {
  // 0xFB 0xFF -> standard base64 "+/8=" -> url-safe "-_8" (padding stripped).
  assert.strictEqual(pure.base64url(new Uint8Array([0xfb, 0xff])), '-_8');
  assert.strictEqual(pure.base64url(new Uint8Array([])), '');
});

test('parseRedirectQuery reads the code response Google redirects back with', function () {
  var parsed = pure.parseRedirectQuery('?code=4/abc-code&state=st4te&scope=x');
  assert.strictEqual(parsed.code, '4/abc-code');
  assert.strictEqual(parsed.state, 'st4te');
  assert.strictEqual(parsed.error, null);
});

test('parseRedirectQuery reads error responses', function () {
  var parsed = pure.parseRedirectQuery('?error=access_denied&state=st4te');
  assert.strictEqual(parsed.error, 'access_denied');
  assert.strictEqual(parsed.code, null);
});

test('parseRedirectQuery ignores non-OAuth query strings', function () {
  assert.strictEqual(pure.parseRedirectQuery('?utm=x'), null);
  assert.strictEqual(pure.parseRedirectQuery(''), null);
  assert.strictEqual(pure.parseRedirectQuery(undefined), null);
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
