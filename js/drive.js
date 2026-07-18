/* Google Drive sync transport + orchestration (local-first phase 2).
 *
 * Opt-in multi-device sync over the user's own Google Drive appDataFolder
 * (a hidden per-app, per-user folder). Each user creates their own OAuth
 * client in the Google Cloud console (the Settings view walks them through
 * it), so there is no shared developer infrastructure: the app talks
 * directly to Google with the user's own credentials.
 *
 * Auth is the OAuth 2.0 implicit flow for client-side apps
 * (https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow):
 * a full-page redirect to accounts.google.com returns a short-lived access
 * token in the URL fragment — no client secret, no external script (Google's
 * GIS library is a CDN load, which this project forbids), and it works in an
 * installed PWA where popups are unreliable. The state parameter guards
 * against CSRF.
 *
 * Sync model: one encrypted file per device (gtd-device-<id>.json) so writes
 * never conflict; every sync downloads the other devices' files, decrypts
 * them (js/crypto.js), merges with the local state (js/sync.js), replaces
 * the local state with the merge and uploads it as this device's file.
 *
 * Device-local storage (never part of the synced document):
 * - localStorage 'gtd:device-id'    — stable id naming this device's file.
 * - localStorage 'gtd:sync:gdrive'  — {clientId, passphrase}. The passphrase
 *   stays on the device by design: the device already holds the plaintext
 *   state, so storing it here does not weaken E2E against a stolen server.
 * - sessionStorage 'gtd:gd:token'   — current access token (~1 h).
 * - sessionStorage 'gtd:gd:state'   — pending OAuth state (CSRF check).
 * - localStorage 'gtd:sync:last'    — last successful sync timestamp.
 */
(function (global) {
  'use strict';

  var AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  var FILE_PREFIX = 'gtd-device-';
  var FILE_SUFFIX = '.json';
  var TOKEN_MARGIN_MS = 60 * 1000; // Treat tokens expiring within a minute as expired.

  var CONFIG_KEY = 'gtd:sync:gdrive';
  var DEVICE_KEY = 'gtd:device-id';
  var LAST_SYNC_KEY = 'gtd:sync:last';
  var TOKEN_KEY = 'gtd:gd:token';
  var STATE_KEY = 'gtd:gd:state';

  // ---- Pure helpers (unit-tested in Node via test/drive.test.js) ----

  function buildAuthUrl(opts) {
    return (
      AUTH_ENDPOINT +
      '?client_id=' + encodeURIComponent(opts.clientId) +
      '&redirect_uri=' + encodeURIComponent(opts.redirectUri) +
      '&response_type=token' +
      '&scope=' + encodeURIComponent(SCOPE) +
      '&state=' + encodeURIComponent(opts.state) +
      '&include_granted_scopes=true'
    );
  }

  // Parses the URL fragment Google redirects back with. Returns null when the
  // fragment is not an OAuth response (e.g. a normal '#/hoy' route).
  function parseFragment(hash) {
    var fragment = String(hash || '').replace(/^#/, '');
    if (fragment.indexOf('access_token=') === -1 && fragment.indexOf('error=') === -1) return null;
    var params = {};
    fragment.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq === -1) return;
      params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    });
    if (!params.access_token && !params.error) return null;
    return {
      accessToken: params.access_token || null,
      expiresIn: Number(params.expires_in) || 0,
      state: params.state || '',
      error: params.error || null,
    };
  }

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

  function multipartBody(boundary, metadata, content) {
    return (
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      content + '\r\n' +
      '--' + boundary + '--'
    );
  }

  // ---- Device-local config ----

  function readJSON(storage, key) {
    try {
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJSON(storage, key, value) {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch (ignored) {}
  }

  function getConfig() {
    var config = readJSON(global.localStorage, CONFIG_KEY);
    return config && config.clientId && config.passphrase ? config : null;
  }

  function setConfig(clientId, passphrase) {
    clientId = String(clientId || '').trim();
    passphrase = String(passphrase || '');
    if (!clientId || !passphrase) return false;
    writeJSON(global.localStorage, CONFIG_KEY, { clientId: clientId, passphrase: passphrase });
    return true;
  }

  function disconnect() {
    writeJSON(global.localStorage, CONFIG_KEY, null);
    writeJSON(global.localStorage, LAST_SYNC_KEY, null);
    try {
      global.sessionStorage.removeItem(TOKEN_KEY);
      global.sessionStorage.removeItem(STATE_KEY);
    } catch (ignored) {}
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

  function redirectUri() {
    return global.location.origin + global.location.pathname;
  }

  function status() {
    var last = readJSON(global.localStorage, LAST_SYNC_KEY);
    var id = deviceId();
    return {
      configured: !!getConfig(),
      lastSyncAt: last || null,
      deviceId: id,
      fileName: deviceFileName(id),
      redirectUri: redirectUri(),
      origin: global.location.origin,
    };
  }

  // ---- OAuth (implicit flow, full-page redirect) ----

  function validToken() {
    var token = readJSON(global.sessionStorage, TOKEN_KEY);
    if (token && token.accessToken && token.expiresAt - TOKEN_MARGIN_MS > Date.now()) return token.accessToken;
    return null;
  }

  // Leaves the app for Google's consent page; the flow resumes in
  // handleRedirect() when Google sends the browser back.
  function connect() {
    var config = getConfig();
    if (!config) return false;
    var bytes = global.crypto.getRandomValues(new Uint8Array(16));
    var state = Array.prototype.map
      .call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
    try {
      global.sessionStorage.setItem(STATE_KEY, state);
    } catch (err) {
      return false; // Without the CSRF check the redirect cannot be trusted.
    }
    global.location.assign(
      buildAuthUrl({ clientId: config.clientId, redirectUri: redirectUri(), state: state })
    );
    return true;
  }

  // Called once at boot, before the router touches location.hash. Returns
  // null (not an OAuth redirect), {ok: true} (token stored; caller should
  // sync) or {error: message}.
  function handleRedirect() {
    var response = parseFragment(global.location.hash);
    if (!response) return null;
    var expected = null;
    try {
      expected = global.sessionStorage.getItem(STATE_KEY);
      global.sessionStorage.removeItem(STATE_KEY);
    } catch (ignored) {}
    // Land on Settings either way: it is where the flow started.
    global.history.replaceState(null, '', global.location.pathname + '#/ajustes');
    if (response.error) return { error: response.error };
    if (!expected || response.state !== expected) return { error: 'state-mismatch' };
    writeJSON(global.sessionStorage, TOKEN_KEY, {
      accessToken: response.accessToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
    });
    return { ok: true };
  }

  // ---- Drive REST (appDataFolder) ----

  function api(token, url, options) {
    options = options || {};
    options.headers = Object.assign({ Authorization: 'Bearer ' + token }, options.headers || {});
    return global.fetch(url, options).then(function (response) {
      if (response.status === 401 || response.status === 403) {
        writeJSON(global.sessionStorage, TOKEN_KEY, null); // Token stale or revoked.
        throw new Error('auth-expired');
      }
      if (!response.ok) throw new Error('drive-http-' + response.status);
      return response;
    });
  }

  function listFiles(token) {
    return api(
      token,
      API + '/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=100'
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (body) {
        return (body.files || []).filter(function (f) {
          return isDeviceFile(f.name);
        });
      });
  }

  function downloadFile(token, id) {
    return api(token, API + '/files/' + encodeURIComponent(id) + '?alt=media').then(function (response) {
      return response.text();
    });
  }

  function uploadFile(token, name, content, existingId) {
    if (existingId) {
      return api(token, UPLOAD_API + '/files/' + encodeURIComponent(existingId) + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      });
    }
    var boundary = 'gtd' + Date.now().toString(36);
    return api(token, UPLOAD_API + '/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: multipartBody(boundary, { name: name, parents: ['appDataFolder'] }, content),
    });
  }

  // ---- Sync orchestration ----

  // Resolves {ok: true, devices: n} on success, {redirecting: true} when an
  // OAuth round-trip is needed first, or rejects with a coded Error
  // ('auth-expired', 'decrypt-failed', 'drive-http-*', network failures…).
  function sync() {
    var config = getConfig();
    if (!config) return Promise.reject(new Error('not-configured'));
    var token = validToken();
    if (!token) {
      if (connect()) return Promise.resolve({ redirecting: true });
      return Promise.reject(new Error('not-configured'));
    }
    var ownName = deviceFileName(deviceId());
    var ownFileId = null;
    return listFiles(token)
      .then(function (files) {
        var others = [];
        files.forEach(function (file) {
          if (file.name === ownName) ownFileId = file.id;
          else others.push(file);
        });
        return Promise.all(
          others.map(function (file) {
            return downloadFile(token, file.id).then(function (content) {
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
        var local = global.GTD.store.load();
        if (remoteDocs.length) {
          var merged = global.GTD.sync.merge([local].concat(remoteDocs));
          global.GTD.store.replaceState(merged);
        }
        return global.GTD.crypto.encryptString(JSON.stringify(global.GTD.store.load()), config.passphrase).then(
          function (envelope) {
            return uploadFile(token, ownName, envelope, ownFileId);
          }
        ).then(function () {
          writeJSON(global.localStorage, LAST_SYNC_KEY, new Date().toISOString());
          return { ok: true, devices: remoteDocs.length + 1 };
        });
      });
  }

  global.GTD = global.GTD || {};
  global.GTD.drive = {
    status: status,
    setConfig: setConfig,
    disconnect: disconnect,
    connect: connect,
    handleRedirect: handleRedirect,
    sync: sync,
    _pure: {
      buildAuthUrl: buildAuthUrl,
      parseFragment: parseFragment,
      deviceFileName: deviceFileName,
      isDeviceFile: isDeviceFile,
      multipartBody: multipartBody,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
