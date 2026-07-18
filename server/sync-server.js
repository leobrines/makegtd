#!/usr/bin/env node
/* makegtd sync server — zero-dependency reference implementation.
 *
 * Stores the app's encrypted per-device files (opaque blobs: payloads are
 * end-to-end encrypted on-device before upload, so this server can never
 * read GTD data). Protocol, matching js/server.js:
 *
 *   GET  /gtd/files          -> {"files":[{"name":"…","modifiedAt":"…"}]}
 *   GET  /gtd/files/{name}   -> raw stored content
 *   PUT  /gtd/files/{name}   -> store raw body
 *
 * Every request must carry "Authorization: Bearer <ACCESS_KEY>".
 *
 * Configuration (environment variables):
 *   ACCESS_KEY      required — the bearer key devices must present.
 *   PORT            listen port (default 8787).
 *   DATA_DIR        storage directory (default ./gtd-sync-data).
 *   ALLOWED_ORIGIN  CORS origin of the app, e.g. https://gtd.example.com
 *                   (default *; tighten it in production).
 *
 * Run:  ACCESS_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))") \
 *       node server/sync-server.js
 *
 * Put it behind TLS (Caddy, nginx, a Cloudflare tunnel…): browsers block
 * plain-http requests from an https-served app. See server/README.md.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var PORT = Number(process.env.PORT) || 8787;
var DATA_DIR = path.resolve(process.env.DATA_DIR || './gtd-sync-data');
var ACCESS_KEY = process.env.ACCESS_KEY || '';
var ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
var MAX_BYTES = 10 * 1024 * 1024; // A whole encrypted state document is far smaller.

// Same shape js/syncer.js produces; anything else is rejected, which also
// rules out path traversal.
var NAME_RE = /^gtd-device-[A-Za-z0-9-]{1,64}\.json$/;

if (!ACCESS_KEY) {
  console.error('ACCESS_KEY is required. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'base64url\'))"');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function authorized(req) {
  var header = req.headers.authorization || '';
  if (header.indexOf('Bearer ') !== 0) return false;
  var presented = Buffer.from(header.slice(7));
  var expected = Buffer.from(ACCESS_KEY);
  return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign(
    {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Cache-Control': 'no-store',
    },
    headers || {}
  ));
  res.end(body);
}

function sendJSON(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json' });
}

http
  .createServer(function (req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    var url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      return send(res, 200, 'makegtd sync server\n', { 'Content-Type': 'text/plain' });
    }

    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/gtd/files') {
      var files = fs.readdirSync(DATA_DIR).filter(function (name) {
        return NAME_RE.test(name);
      });
      return sendJSON(res, 200, {
        files: files.map(function (name) {
          return { name: name, modifiedAt: fs.statSync(path.join(DATA_DIR, name)).mtime.toISOString() };
        }),
      });
    }

    var match = url.pathname.match(/^\/gtd\/files\/([^/]+)$/);
    var name = match && decodeURIComponent(match[1]);
    if (!match || !NAME_RE.test(name)) return sendJSON(res, 404, { error: 'not-found' });
    var filePath = path.join(DATA_DIR, name);

    if (req.method === 'GET') {
      if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'not-found' });
      return send(res, 200, fs.readFileSync(filePath), { 'Content-Type': 'application/json' });
    }

    if (req.method === 'PUT') {
      var chunks = [];
      var size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_BYTES) {
          sendJSON(res, 413, { error: 'too-large' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', function () {
        if (res.writableEnded) return;
        // Atomic write: never leave a half-written file for a reader.
        var tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
        fs.writeFileSync(tmp, Buffer.concat(chunks));
        fs.renameSync(tmp, filePath);
        sendJSON(res, 200, { name: name });
      });
      return;
    }

    return sendJSON(res, 405, { error: 'method-not-allowed' });
  })
  .listen(PORT, function () {
    console.log('makegtd sync server listening on port ' + PORT);
    console.log('Data directory: ' + DATA_DIR);
    console.log('Allowed origin: ' + ALLOWED_ORIGIN);
  });
