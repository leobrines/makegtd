/* Self-hosted sync server transport (used through js/syncer.js).
 *
 * Talks to any server implementing the tiny makegtd sync protocol over
 * HTTPS (see server/sync-server.js for a zero-dependency reference
 * implementation and server/README.md for the spec):
 *
 *   GET  {base}/gtd/files          -> {"files":[{"name":"…"}]}
 *   GET  {base}/gtd/files/{name}   -> raw stored content
 *   PUT  {base}/gtd/files/{name}   -> store raw body
 *
 * Auth is a bearer access key (Authorization: Bearer <key>) configured in
 * Settings like a proxy: base URL + key — or imported from an encrypted
 * key file (js/syncer.js). Payloads are already end-to-end encrypted
 * before they reach this transport, so the server only ever stores opaque
 * envelopes.
 */
(function (global) {
  'use strict';

  // ---- Pure helpers (unit-tested in Node via test/server.test.js) ----

  function filesUrl(base) {
    return base + '/gtd/files';
  }

  function fileUrl(base, name) {
    return base + '/gtd/files/' + encodeURIComponent(name);
  }

  // ---- HTTP ----

  function request(config, url, options) {
    options = options || {};
    options.headers = Object.assign(
      { Authorization: 'Bearer ' + config.server.key },
      options.headers || {}
    );
    return global.fetch(url, options).then(function (response) {
      if (response.status === 401 || response.status === 403) throw new Error('auth-invalid');
      if (!response.ok) throw new Error('server-http-' + response.status);
      return response;
    });
  }

  // ---- Transport interface (consumed by js/syncer.js) ----

  var transport = {
    ensureAuth: function () {
      return { ctx: null }; // Bearer key travels with every request; nothing to do.
    },
    list: function (config) {
      return request(config, filesUrl(config.server.url))
        .then(function (response) {
          return response.json();
        })
        .then(function (body) {
          return (body.files || []).map(function (file) {
            return { id: file.name, name: file.name };
          });
        });
    },
    download: function (config, ctx, file) {
      return request(config, fileUrl(config.server.url, file.name)).then(function (response) {
        return response.text();
      });
    },
    upload: function (config, ctx, name, content) {
      return request(config, fileUrl(config.server.url, name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      });
    },
  };

  global.GTD = global.GTD || {};
  global.GTD.server = {
    transport: transport,
    _pure: {
      filesUrl: filesUrl,
      fileUrl: fileUrl,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
