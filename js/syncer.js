/* Provider-agnostic sync core (local-first phase 3).
 *
 * The app syncs against multiple backends behind one transport interface;
 * any subset (Google Drive, self-hosted server, or both) can be active at
 * once — redundant cloud peers, in local-first terms: every backend holds
 * the same encrypted per-device files and none is authoritative, so the
 * deterministic merge (js/sync.js) converges no matter how many take part.
 * A transport implements:
 *   ensureAuth(config) -> {ctx} when ready, or {redirecting: true} when an
 *                         auth round-trip (e.g. OAuth redirect) is underway
 *   list(config, ctx)              -> Promise<[{id, name}]>
 *   download(config, ctx, file)    -> Promise<string>
 *   upload(config, ctx, name, content, existingId) -> Promise
 * Registered transports: 'gdrive' (js/drive.js) and 'server' (js/server.js).
 *
 * sync() runs the backends sequentially — server first, then Google Drive,
 * because Drive may leave the page for an OAuth redirect and everything
 * before it must have finished. The local state is re-merged after each
 * backend, so a device connected to both acts as a bridge between devices
 * that only use one of them. Per-backend failures do not stop the others;
 * the result carries one entry per backend.
 *
 * One encrypted file per device (gtd-device-<id>.json) so writes never
 * conflict; every pass downloads the other devices' files, decrypts
 * (js/crypto.js), merges with the local state, replaces it and re-uploads
 * this device's file. The encryption passphrase is shared by all backends
 * (same files everywhere).
 *
 * Key file: for the self-hosted server backend, the whole device setup
 * (url, access key, passphrase) can be exported as a password-encrypted
 * file (a js/crypto.js envelope) and imported on another device, so only
 * the first device is configured by hand.
 *
 * Device-local storage (never part of the synced document):
 * - localStorage 'gtd:sync:config' — {passphrase, gdrive|null, server|null}.
 *   The passphrase is deliberately device-local: the device already holds
 *   the plaintext state, so storing it here does not weaken E2E against a
 *   compromised backend. (Earlier single-backend shapes — {provider, …} and
 *   the gdrive-only 'gtd:sync:gdrive' key — are migrated on first read.)
 * - localStorage 'gtd:device-id', 'gtd:sync:last' (per-backend timestamps).
 */
(function (global) {
  'use strict';

  var CONFIG_KEY = 'gtd:sync:config';
  var LEGACY_GDRIVE_KEY = 'gtd:sync:gdrive';
  var DEVICE_KEY = 'gtd:device-id';
  var LAST_SYNC_KEY = 'gtd:sync:last';
  var FILE_PREFIX = 'gtd-device-';
  var FILE_SUFFIX = '.json';

  // ---- Pure helpers (unit-tested in Node via test/syncer.test.js) ----

  function deviceFileName(deviceId) {
    return FILE_PREFIX + deviceId + FILE_SUFFIX;
  }

  function isDeviceFile(name) {
    return (
      typeof name === 'string' &&
      name.indexOf(FILE_PREFIX) === 0 &&
      name.slice(-FILE_SUFFIX.length) === FILE_SUFFIX &&
      name.length > FILE_PREFIX.length + FILE_SUFFIX.length
    );
  }

  // Accepts what the user types ("sync.example.com/", "http://…") and
  // returns a canonical base URL without trailing slash, or null.
  function normalizeServerUrl(raw) {
    var text = String(raw || '').trim();
    if (!text) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text; // No scheme: assume https.
    var url;
    try {
      url = new URL(text);
    } catch (err) {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.search || url.hash) return null;
    return (url.origin + url.pathname).replace(/\/+$/, '');
  }

  // Normalizes any stored shape to a valid config ({passphrase, gdrive|null,
  // server|null}, at least one backend), or null. Also accepts the earlier
  // single-backend shape ({provider, passphrase, gdrive|server}) and the
  // original gdrive-only shape ({clientId, passphrase}).
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.passphrase !== 'string' || !raw.passphrase) return null;
    var gdrive = null;
    var clientId = String((raw.gdrive && raw.gdrive.clientId) || raw.clientId || '').trim();
    if (clientId) gdrive = { clientId: clientId };
    var server = null;
    if (raw.server) {
      var url = normalizeServerUrl(raw.server.url);
      var key = String(raw.server.key || '').trim();
      if (url && key) server = { url: url, key: key };
    }
    if (!gdrive && !server) return null;
    return { passphrase: raw.passphrase, gdrive: gdrive, server: server };
  }

  // Key file payload for the self-hosted server backend. Always shipped
  // inside a password-encrypted envelope by exportKeyFile(); parse accepts
  // the decrypted (or a hand-written plain) JSON.
  function buildKeyFile(config) {
    if (!config || !config.server) return null;
    return JSON.stringify({
      makegtd: 1,
      type: 'sync-server',
      url: config.server.url,
      key: config.server.key,
      passphrase: config.passphrase,
    });
  }

  function parseKeyFile(text) {
    var data = JSON.parse(text); // Throws on invalid JSON; callers handle it.
    if (!data || data.makegtd !== 1 || data.type !== 'sync-server' || !data.url || !data.key) {
      throw new Error('invalid-key-file');
    }
    return {
      url: String(data.url),
      key: String(data.key),
      passphrase: typeof data.passphrase === 'string' ? data.passphrase : '',
    };
  }

  // ---- Device-local storage ----

  function readJSON(key) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      if (value === null) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, JSON.stringify(value));
    } catch (ignored) {}
  }

  function getConfig() {
    var config = normalizeConfig(readJSON(CONFIG_KEY));
    if (config) return config;
    // One-time migration from the gdrive-only config key.
    var legacy = normalizeConfig(readJSON(LEGACY_GDRIVE_KEY));
    if (legacy) {
      writeJSON(CONFIG_KEY, legacy);
      writeJSON(LEGACY_GDRIVE_KEY, null);
    }
    return legacy;
  }

  // Adding a backend keeps the other one; an empty passphrase reuses the
  // stored one (adding a second backend never asks for it again — the
  // encrypted files must be identical on every backend).
  function setGdriveConfig(clientId, passphrase) {
    var existing = getConfig();
    var config = normalizeConfig({
      passphrase: String(passphrase || '') || (existing ? existing.passphrase : ''),
      gdrive: { clientId: clientId },
      server: existing ? existing.server : null,
    });
    if (!config || !config.gdrive) return false;
    writeJSON(CONFIG_KEY, config);
    return true;
  }

  function setServerConfig(url, key, passphrase) {
    var existing = getConfig();
    var config = normalizeConfig({
      passphrase: String(passphrase || '') || (existing ? existing.passphrase : ''),
      clientId: existing && existing.gdrive ? existing.gdrive.clientId : '',
      server: { url: url, key: key },
    });
    if (!config || !config.server) return false;
    writeJSON(CONFIG_KEY, config);
    return true;
  }

  // Removes one backend; removing the last one clears the whole sync setup.
  function removeBackend(provider) {
    var config = getConfig();
    if (!config) return;
    if (provider === 'gdrive') {
      config.gdrive = null;
      if (global.GTD.drive && global.GTD.drive.clearSession) global.GTD.drive.clearSession();
    }
    if (provider === 'server') config.server = null;
    if (!config.gdrive && !config.server) {
      disconnect();
      return;
    }
    writeJSON(CONFIG_KEY, config);
    var last = readLastSyncMap();
    delete last[provider];
    writeJSON(LAST_SYNC_KEY, last);
  }

  function disconnect() {
    writeJSON(CONFIG_KEY, null);
    writeJSON(LEGACY_GDRIVE_KEY, null);
    writeJSON(LAST_SYNC_KEY, null);
    if (global.GTD.drive && global.GTD.drive.clearSession) global.GTD.drive.clearSession();
  }

  // Per-backend timestamps; the pre-multi-backend value was a plain string
  // (unknown backend), which is simply discarded.
  function readLastSyncMap() {
    var value = readJSON(LAST_SYNC_KEY);
    return value && typeof value === 'object' ? value : {};
  }

  function deviceId() {
    var id = null;
    try {
      id = global.localStorage.getItem(DEVICE_KEY);
    } catch (ignored) {}
    if (!id) {
      var bytes = global.crypto.getRandomValues(new Uint8Array(8));
      id = Array.prototype.map
        .call(bytes, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        })
        .join('');
      try {
        global.localStorage.setItem(DEVICE_KEY, id);
      } catch (ignored) {}
    }
    return id;
  }

  function status() {
    var config = getConfig();
    var id = deviceId();
    var last = readLastSyncMap();
    var backends = [];
    if (config && config.server) backends.push({ provider: 'server', serverUrl: config.server.url, lastSyncAt: last.server || null });
    if (config && config.gdrive) backends.push({ provider: 'gdrive', serverUrl: null, clientId: config.gdrive.clientId, lastSyncAt: last.gdrive || null });
    return {
      configured: !!config,
      backends: backends,
      hasGdrive: !!(config && config.gdrive),
      hasServer: !!(config && config.server),
      deviceId: id,
      fileName: deviceFileName(id),
      origin: global.location.origin,
      redirectUri: global.location.origin + global.location.pathname,
    };
  }

  // ---- Orchestration ----

  var TRANSPORTS = {
    gdrive: function () {
      return global.GTD.drive.transport;
    },
    server: function () {
      return global.GTD.server.transport;
    },
  };

  // One full pass against one backend: list, download+decrypt the other
  // devices' files, merge into the local state, re-upload this device's
  // file. Resolves {devices: n} or {redirecting: true}; rejects with a coded
  // Error ('auth-expired', 'auth-invalid', 'decrypt-failed', '*-http-*',
  // network failures…).
  function syncBackend(config, provider) {
    var transport = TRANSPORTS[provider]();
    var auth = transport.ensureAuth(config);
    if (auth.redirecting) return Promise.resolve({ redirecting: true });
    var ctx = auth.ctx;
    var ownName = deviceFileName(deviceId());
    var ownFileId = null;
    return transport
      .list(config, ctx)
      .then(function (files) {
        var others = [];
        files.forEach(function (file) {
          if (!isDeviceFile(file.name)) return;
          if (file.name === ownName) ownFileId = file.id;
          else others.push(file);
        });
        return Promise.all(
          others.map(function (file) {
            return transport.download(config, ctx, file).then(function (content) {
              // Foreign or corrupt files are ignored; a proper envelope that
              // fails to decrypt aborts the sync (wrong passphrase).
              if (!global.GTD.crypto.isEnvelope(content)) return null;
              return global.GTD.crypto.decryptString(content, config.passphrase).then(function (json) {
                try {
                  return JSON.parse(json);
                } catch (err) {
                  return null;
                }
              });
            });
          })
        );
      })
      .then(function (remoteDocs) {
        remoteDocs = remoteDocs.filter(Boolean);
        if (remoteDocs.length) {
          var merged = global.GTD.sync.merge([global.GTD.store.load()].concat(remoteDocs));
          global.GTD.store.replaceState(merged);
        }
        return global.GTD.crypto
          .encryptString(JSON.stringify(global.GTD.store.load()), config.passphrase)
          .then(function (envelope) {
            return transport.upload(config, ctx, ownName, envelope, ownFileId);
          })
          .then(function () {
            var last = readLastSyncMap();
            last[provider] = new Date().toISOString();
            writeJSON(LAST_SYNC_KEY, last);
            return { devices: remoteDocs.length + 1 };
          });
      });
  }

  // Syncs every active backend sequentially — server first, Google Drive
  // last (it may leave the page for an OAuth redirect). A failing backend
  // does not stop the others. Resolves {redirecting: true} or
  // {ok: <all succeeded>, results: [{provider, ok, devices|error}]};
  // rejects only when sync is not configured at all.
  function sync() {
    var config = getConfig();
    if (!config) return Promise.reject(new Error('not-configured'));
    var providers = [];
    if (config.server) providers.push('server');
    if (config.gdrive) providers.push('gdrive');
    var results = [];
    var redirecting = false;
    return providers
      .reduce(function (chain, provider) {
        return chain.then(function () {
          if (redirecting) return;
          return syncBackend(config, provider).then(
            function (result) {
              if (result.redirecting) {
                redirecting = true;
                return;
              }
              results.push({ provider: provider, ok: true, devices: result.devices });
            },
            function (err) {
              results.push({ provider: provider, ok: false, error: err });
            }
          );
        });
      }, Promise.resolve())
      .then(function () {
        if (redirecting) return { redirecting: true, results: results };
        return {
          ok: results.every(function (r) {
            return r.ok;
          }),
          results: results,
        };
      });
  }

  // ---- Key file (self-hosted server provider) ----

  // The file carries the access key AND the passphrase, so it is always
  // encrypted with a password chosen at export time.
  function exportKeyFile(password) {
    var config = getConfig();
    var payload = buildKeyFile(config);
    if (!payload) return Promise.reject(new Error('not-configured'));
    return global.GTD.crypto.encryptString(payload, password);
  }

  // Accepts an encrypted envelope (needs the password) or a hand-written
  // plain JSON key file. Resolves {url, key, passphrase}.
  function importKeyFile(text, password) {
    if (global.GTD.crypto.isEnvelope(text)) {
      return global.GTD.crypto.decryptString(text, String(password || '')).then(parseKeyFile);
    }
    return Promise.resolve().then(function () {
      return parseKeyFile(text);
    });
  }

  global.GTD = global.GTD || {};
  global.GTD.syncer = {
    status: status,
    getConfig: getConfig,
    setGdriveConfig: setGdriveConfig,
    setServerConfig: setServerConfig,
    removeBackend: removeBackend,
    disconnect: disconnect,
    sync: sync,
    exportKeyFile: exportKeyFile,
    importKeyFile: importKeyFile,
    _pure: {
      deviceFileName: deviceFileName,
      isDeviceFile: isDeviceFile,
      normalizeServerUrl: normalizeServerUrl,
      normalizeConfig: normalizeConfig,
      buildKeyFile: buildKeyFile,
      parseKeyFile: parseKeyFile,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
