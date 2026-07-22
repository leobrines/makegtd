/* Service worker: precache everything, serve cache-first. Bump CACHE_VERSION on any asset change. */
var CACHE_VERSION = 'makegtd-v35';

var PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/vendor/jquery.min.js',
  'js/store.js',
  'js/sync.js',
  'js/crypto.js',
  'js/syncer.js',
  'js/drive.js',
  'js/server.js',
  'js/model.js',
  'js/datepicker.js',
  'js/views.js',
  'js/process.js',
  'js/review.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(function (cache) {
        return cache.addAll(PRECACHE);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_VERSION;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  // Cross-origin requests (Drive sync API calls) go straight to the network.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      return (
        cached ||
        fetch(event.request).then(function (response) {
          // Cache same-origin responses fetched at runtime so updates keep working offline.
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            var copy = response.clone();
            caches.open(CACHE_VERSION).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
      );
    })
  );
});
