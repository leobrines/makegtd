/* Google Drive sync transport (used through js/syncer.js).
 *
 * Auth is the OAuth 2.0 Authorization Code flow with PKCE (RFC 7636), the flow
 * OAuth 2.1 mandates for browser apps — replacing the older implicit flow:
 * a full-page redirect to accounts.google.com returns a short-lived
 * authorization CODE in the query string (never an access token in the URL),
 * which is exchanged for a token via a background POST bound to a per-attempt
 * code_verifier. No external script (Google's GIS library is a CDN load, which
 * this project forbids), and it works in an installed PWA where popups are
 * unreliable. The state parameter guards against CSRF.
 *
 * Each user brings their own OAuth Client ID (the Settings view walks them
 * through creating it). Google issues "Web application" clients with a client
 * secret and requires it at the token endpoint even with PKCE, so the setup
 * also asks for that secret. It is not a shared secret: each user's client only
 * touches that user's own Drive, it is stored device-local (never synced) and,
 * when a device vault is on, encrypted at rest with everything else. PKCE still
 * protects the code in transit regardless.
 *
 * Files live in the user's hidden per-app appDataFolder via the Drive REST
 * v3 API (drive.appdata is a non-sensitive scope).
 *
 * Offline access: the consent request asks for a refresh token (access_type=
 * offline). Once granted, ensureAuth() mints fresh access tokens silently via
 * a background POST — so automatic sync keeps working across sessions without
 * another consent redirect. The refresh token is stored device-local inside the
 * sync config (js/syncer.js), right next to the client id/secret, and encrypted
 * at rest under the vault DEK when a device vault is enrolled; it is never part
 * of the synced document. It only grants offline access to the user's own
 * appDataFolder (the drive.appdata scope).
 *
 * Session storage (device-local): 'gtd:gd:token' — current access token
 * (~1 h) — 'gtd:gd:state' — pending OAuth state for the CSRF check — and
 * 'gtd:gd:verifier' — the PKCE code_verifier for the pending exchange.
 */
(function (global) {
  'use strict';

  var AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  var TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  var TOKEN_MARGIN_MS = 60 * 1000; // Treat tokens expiring within a minute as expired.

  var TOKEN_KEY = 'gtd:gd:token';
  var STATE_KEY = 'gtd:gd:state';
  var VERIFIER_KEY = 'gtd:gd:verifier';

  var subtle = global.crypto && global.crypto.subtle;

  // ---- Pure helpers (unit-tested in Node via test/drive.test.js) ----

  // URL-safe base64 without padding, as PKCE requires.
  function base64url(bytes) {
    bytes = new Uint8Array(bytes);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function buildAuthUrl(opts) {
    return (
      AUTH_ENDPOINT +
      '?client_id=' + encodeURIComponent(opts.clientId) +
      '&redirect_uri=' + encodeURIComponent(opts.redirectUri) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent(SCOPE) +
      '&state=' + encodeURIComponent(opts.state) +
      '&code_challenge=' + encodeURIComponent(opts.codeChallenge) +
      '&code_challenge_method=S256' +
      // access_type=offline + prompt=consent make Google return a refresh
      // token, so background sync can mint fresh access tokens on its own
      // (across sessions) without another full-page consent redirect.
      '&access_type=offline' +
      '&prompt=consent' +
      '&include_granted_scopes=true'
    );
  }

  // Parses the query string Google redirects back with (?code=…&state=… or
  // ?error=…). Returns null when it is not an OAuth response.
  function parseRedirectQuery(search) {
    var query = String(search || '').replace(/^\?/, '');
    if (query.indexOf('code=') === -1 && query.indexOf('error=') === -1) return null;
    var params = {};
    query.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq === -1) return;
      params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    });
    if (!params.code && !params.error) return null;
    return {
      code: params.code || null,
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

  // ---- PKCE ----

  function randomVerifier() {
    return base64url(global.crypto.getRandomValues(new Uint8Array(32))); // 43 chars.
  }

  function challengeFromVerifier(verifier) {
    return subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(base64url);
  }

  // ---- OAuth (authorization code + PKCE, full-page redirect) ----

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

  function storeAccessToken(data) {
    writeJSON(TOKEN_KEY, {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    });
  }

  // The refresh token lives in the sync config (device-local, vault-encrypted at
  // rest); syncer.js owns that storage. Guard the calls so unit tests that load
  // drive.js in isolation (no syncer) do not blow up.
  function rememberRefreshToken(token) {
    if (global.GTD.syncer && global.GTD.syncer.setGdriveRefreshToken) {
      global.GTD.syncer.setGdriveRefreshToken(token);
    }
  }

  function forgetRefreshToken() {
    rememberRefreshToken(null);
  }

  function clearSession() {
    writeJSON(TOKEN_KEY, null);
    writeJSON(STATE_KEY, null);
    writeJSON(VERIFIER_KEY, null);
  }

  function redirectUri() {
    return global.location.origin + global.location.pathname;
  }

  function hex(bytes) {
    return Array.prototype.map
      .call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  }

  // Leaves the app for Google's consent page; the flow resumes in
  // handleRedirect() when Google sends the browser back with a code. Async
  // because the PKCE challenge is a SHA-256 digest.
  function connect(clientId) {
    var state = hex(global.crypto.getRandomValues(new Uint8Array(16)));
    var verifier = randomVerifier();
    try {
      global.sessionStorage.setItem(STATE_KEY, state);
      global.sessionStorage.setItem(VERIFIER_KEY, verifier);
    } catch (err) {
      return Promise.resolve(false); // Without state/verifier the redirect cannot be trusted.
    }
    return challengeFromVerifier(verifier).then(function (challenge) {
      global.location.assign(
        buildAuthUrl({ clientId: clientId, redirectUri: redirectUri(), state: state, codeChallenge: challenge })
      );
      return true;
    });
  }

  // Exchanges the authorization code for an access token (background POST, no
  // token ever in a URL). Returns the token payload or throws.
  function exchangeCode(config, code) {
    var verifier = null;
    try {
      verifier = global.sessionStorage.getItem(VERIFIER_KEY);
      global.sessionStorage.removeItem(VERIFIER_KEY);
    } catch (ignored) {}
    if (!verifier) return Promise.reject(new Error('missing-verifier'));
    var body = {
      client_id: config.gdrive.clientId,
      code: code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    };
    // Google "Web application" clients require the secret here even with PKCE.
    if (config.gdrive.clientSecret) body.client_secret = config.gdrive.clientSecret;
    return global
      .fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new global.URLSearchParams(body).toString(),
      })
      .then(function (response) {
        return response.json().then(
          function (data) {
            if (!response.ok || !data.access_token) throw new Error('token-exchange-failed');
            return data;
          },
          function () {
            throw new Error('token-exchange-failed');
          }
        );
      });
  }

  // Called once at boot (after the sync config is available). Returns a promise
  // for null (not an OAuth redirect), {ok: true} (token stored; caller should
  // sync) or {error: message}.
  function handleRedirect(config) {
    var response = parseRedirectQuery(global.location.search);
    if (!response) return Promise.resolve(null);
    var expected = null;
    try {
      expected = global.sessionStorage.getItem(STATE_KEY);
      global.sessionStorage.removeItem(STATE_KEY);
    } catch (ignored) {}
    // Strip the code/state from the URL and land on Settings (where the flow
    // started) before doing anything else.
    global.history.replaceState(null, '', global.location.pathname + '#/ajustes');
    if (response.error) return Promise.resolve({ error: response.error });
    if (!expected || response.state !== expected) return Promise.resolve({ error: 'state-mismatch' });
    if (!config || !config.gdrive) return Promise.resolve({ error: 'not-configured' });
    return exchangeCode(config, response.code).then(
      function (data) {
        storeAccessToken(data);
        // Offline access: keep the refresh token so background sync can renew
        // the access token later without redirecting again.
        if (data.refresh_token) rememberRefreshToken(data.refresh_token);
        return { ok: true };
      },
      function (err) {
        return { error: (err && err.message) || 'token-exchange-failed' };
      }
    );
  }

  // Silent token renewal (offline access): trades the stored refresh token for a
  // fresh access token via a background POST — no user interaction. Stores and
  // returns the new access token, or rejects. A hard invalid_grant (the refresh
  // token was revoked or expired) also drops the dead token so we stop retrying
  // and fall back to an interactive consent on the next manual sync.
  function refreshAccessToken(config) {
    var refreshToken = config.gdrive && config.gdrive.refreshToken;
    if (!refreshToken) return Promise.reject(new Error('no-refresh-token'));
    var body = {
      client_id: config.gdrive.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    };
    if (config.gdrive.clientSecret) body.client_secret = config.gdrive.clientSecret;
    return global
      .fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new global.URLSearchParams(body).toString(),
      })
      .then(function (response) {
        return response.json().then(
          function (data) {
            if (response.ok && data.access_token) return data;
            if (data && data.error === 'invalid_grant') forgetRefreshToken();
            throw new Error('token-refresh-failed');
          },
          function () {
            throw new Error('token-refresh-failed');
          }
        );
      })
      .then(function (data) {
        storeAccessToken(data);
        // Google normally keeps the same refresh token, but honor a rotated one.
        if (data.refresh_token && data.refresh_token !== refreshToken) rememberRefreshToken(data.refresh_token);
        return data.access_token;
      });
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
    // Returns {ctx} (sync fast path) when a valid access token is cached, or a
    // Promise for {ctx} | {redirecting: true} | {unavailable: true} otherwise.
    // With a stored refresh token it renews the access token silently (no
    // redirect), so both manual and background sync just work across sessions.
    // Only when no refresh token is available (or it was revoked) does it fall
    // back: an interactive sync leaves for Google's consent page; a background
    // sync (opts.interactive === false) reports {unavailable: true} and is
    // skipped, and the user re-authorizes on the next manual "Sincronizar ahora".
    ensureAuth: function (config, opts) {
      var token = validToken();
      if (token) return { ctx: token };
      var interactive = !(opts && opts.interactive === false);
      function fallback() {
        if (interactive) {
          connect(config.gdrive.clientId); // Async redirect; the flow resumes at boot.
          return { redirecting: true };
        }
        return { unavailable: true };
      }
      if (config.gdrive && config.gdrive.refreshToken) {
        return refreshAccessToken(config).then(
          function (freshToken) {
            return { ctx: freshToken };
          },
          fallback // Refresh failed (network, or a revoked/expired token).
        );
      }
      return fallback();
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
      parseRedirectQuery: parseRedirectQuery,
      base64url: base64url,
      multipartBody: multipartBody,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
