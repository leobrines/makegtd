/* Google Drive sync transport (used through js/syncer.js).
 *
 * Auth is the OAuth 2.0 implicit flow for client-side apps
 * (https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow):
 * a full-page redirect to accounts.google.com returns a short-lived access
 * token in the URL fragment — no client secret, no external script (Google's
 * GIS library is a CDN load, which this project forbids), and it works in an
 * installed PWA where popups are unreliable. The state parameter guards
 * against CSRF. Each user brings their own OAuth Client ID (the Settings
 * view walks them through creating it).
 *
 * Files live in the user's hidden per-app appDataFolder via the Drive REST
 * v3 API (drive.appdata is a non-sensitive scope).
 *
 * Session storage (device-local): 'gtd:gd:token' — current access token
 * (~1 h) — and 'gtd:gd:state' — pending OAuth state for the CSRF check.
 */
(function (global) {
  'use strict';

  var AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  var TOKEN_MARGIN_MS = 60 * 1000; // Treat tokens expiring within a minute as expired.

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

  // ---- OAuth (implicit flow, full-page redirect) ----

  function readJSON(key) {
    try {
      var raw = global.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      if (value === null) global.sessionStorage.removeItem(key);
      else global.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (ignored) {}
  }

  function validToken() {
    var token = readJSON(TOKEN_KEY);
    if (token && token.accessToken && token.expiresAt - TOKEN_MARGIN_MS > Date.now()) return token.accessToken;
    return null;
  }

  function clearSession() {
    writeJSON(TOKEN_KEY, null);
    writeJSON(STATE_KEY, null);
  }

  // Leaves the app for Google's consent page; the flow resumes in
  // handleRedirect() when Google sends the browser back.
  function connect(clientId) {
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
      buildAuthUrl({
        clientId: clientId,
        redirectUri: global.location.origin + global.location.pathname,
        state: state,
      })
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
    writeJSON(TOKEN_KEY, {
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
        writeJSON(TOKEN_KEY, null); // Token stale or revoked.
        throw new Error('auth-expired');
      }
      if (!response.ok) throw new Error('drive-http-' + response.status);
      return response;
    });
  }

  // ---- Transport interface (consumed by js/syncer.js) ----

  var transport = {
    ensureAuth: function (config) {
      var token = validToken();
      if (token) return { ctx: token };
      connect(config.gdrive.clientId);
      return { redirecting: true };
    },
    list: function (config, token) {
      return api(
        token,
        API + '/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=100'
      )
        .then(function (response) {
          return response.json();
        })
        .then(function (body) {
          return body.files || [];
        });
    },
    download: function (config, token, file) {
      return api(token, API + '/files/' + encodeURIComponent(file.id) + '?alt=media').then(function (response) {
        return response.text();
      });
    },
    upload: function (config, token, name, content, existingId) {
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
    },
  };

  global.GTD = global.GTD || {};
  global.GTD.drive = {
    handleRedirect: handleRedirect,
    clearSession: clearSession,
    transport: transport,
    _pure: {
      buildAuthUrl: buildAuthUrl,
      parseFragment: parseFragment,
      multipartBody: multipartBody,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
