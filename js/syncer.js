/* Provider-agnostic sync core (local-first phase 3).
 *
 * The app supports multiple sync backends behind one transport interface;
 * exactly one is active at a time. A transport implements:
 *   ensureAuth(config) -> {ctx} when ready, or {redirecting: true} when an
 *                         auth round-trip (e.g. OAuth redirect) is underway
 *   list(config, ctx)              -> Promise<[{id, name}]>
 *   download(config, ctx, file)    -> Promise<string>
 *   upload(config, ctx, name, content, existingId) -> Promise
 * Registered transports: 'gdrive' (js/drive.js) and 'server' (js/server.js).
 *
 * The orchestration here is transport-independent: one encrypted file per
 * device (gtd-device-<id>.json) so writes never conflict; every sync
 * downloads the other devices' files, decrypts (js/crypto.js), merges with
 * the local state (js/sync.js), replaces it and re-uploads this device's
 * file.
 *
 * Key file: for the self-hosted server provider, the whole device setup
 * (url, access key, passphrase) can be exported as a password-encrypted
 * file (a js/crypto.js envelope) and imported on another device, so only
 * the first device is configured by hand.
 *
 * Device-local storage (never part of the synced document):
 * - localStorage 'gtd:sync:config' — {provider, passphrase, gdrive|server}.
 *   The passphrase is deliberately device-local: the device already holds
 *   the plaintext state, so storing it here does not weaken E2E against a
 *   compromised backend. (Replaces the legacy 'gtd:sync:gdrive' key, which
 *   is migrated on first read.)
 * - localStorage 'gtd:device-id', 'gtd:sync:last'.
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

  // Normalizes any stored shape (current or legacy) to a valid config, or
  // null. Legacy shape: {clientId, passphrase} from the gdrive-only era.
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.passphrase !== 'string' || !raw.passphrase) return null;
    var provider = raw.provider || (raw.clientId ? 'gdrive' : null);
    if (provider === 'gdrive') {
      var clientId = String((raw.gdrive && raw.gdrive.clientId) || raw.clientId || '').trim();
      if (!clientId) return null;
      return { provider: 'gdrive', passphrase: raw.passphrase, gdrive: { clientId: clientId } };
    }
    if (provider === 'server') {
      var url = normalizeServerUrl(raw.server && raw.server.url);
      var key = String((raw.server && raw.server.key) || '').trim();
      if (!url || !key) return null;
      return { provider: 'server', passphrase: raw.passphrase, server: { url: url, key: key } };
    }
    return null;
  }

  // Key file payload for the self-hosted server provider. Always shipped
  // inside a password-encrypted envelope by exportKeyFile(); parse accepts
  // the decrypted (or a hand-written plain) JSON.
  function buildKeyFile(config) {
    if (!config || config.provider !== 'server') return null;
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

  function setGdriveConfig(clientId, passphrase) {
    var config = normalizeConfig({
      provider: 'gdrive',
      passphrase: String(passphrase || ''),
      gdrive: { clientId: clientId },
    });
    if (!config) return false;
    writeJSON(CONFIG_KEY, config);
    return true;
  }

  function setServerConfig(url, key, passphrase) {
    var config = normalizeConfig({
      provider: 'server',
      passphrase: String(passphrase || ''),
      server: { url: url, key: key },
    });
    if (!config) return false;
    writeJSON(CONFIG_KEY, config);
    return true;
  }

  function disconnect() {
    writeJSON(CONFIG_KEY, null);
    writeJSON(LEGACY_GDRIVE_KEY, null);
    writeJSON(LAST_SYNC_KEY, null);
    if (global.GTD.drive && global.GTD.drive.clearSession) global.GTD.drive.clearSession();
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
    return {
      configured: !!config,
      provider: config ? config.provider : null,
      serverUrl: config && config.provider === 'server' ? config.server.url : null,
      lastSyncAt: readJSON(LAST_SYNC_KEY),
      deviceId: deviceId(),
      origin: global.location.origin,
      redirectUri: global.location.origin + global.location.pathname,
    };
  }

  // ---- Orchestration ----

  function transportFor(config) {
    if (config.provider === 'gdrive') return global.GTD.drive.transport;
    if (config.provider === 'server') return global.GTD.server.transport;
    return null;
  }

  // Resolves {ok: true, devices: n} on success or {redirecting: true} when
  // an auth round-trip is needed first; rejects with a coded Error
  // ('not-configured', 'auth-expired', 'auth-invalid', 'decrypt-failed',
  // '*-http-*', network failures…).
  function sync() {
    var config = getConfig();
    if (!config) return Promise.reject(new Error('not-configured'));
    var transport = transportFor(config);
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
            writeJSON(LAST_SYNC_KEY, new Date().toISOString());
            return { ok: true, devices: remoteDocs.length + 1 };
          });
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
