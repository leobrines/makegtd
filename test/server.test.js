/* Unit tests for the pure helpers of the self-hosted server transport
 * (js/server.js). Run: npm test */
'use strict';

var assert = require('assert');
var path = require('path');

require(path.join(__dirname, '..', 'js', 'server.js'));
var pure = globalThis.GTD.server._pure;

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

test('filesUrl targets the protocol listing endpoint', function () {
  assert.strictEqual(pure.filesUrl('https://sync.example.com'), 'https://sync.example.com/gtd/files');
  assert.strictEqual(pure.filesUrl('https://host.tld/base'), 'https://host.tld/base/gtd/files');
});

test('fileUrl encodes the file name', function () {
  assert.strictEqual(
    pure.fileUrl('https://sync.example.com', 'gtd-device-a1.json'),
    'https://sync.example.com/gtd/files/gtd-device-a1.json'
  );
  assert.strictEqual(
    pure.fileUrl('https://sync.example.com', 'ra/ro'),
    'https://sync.example.com/gtd/files/ra%2Fro'
  );
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
