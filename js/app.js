/* App shell: hash router, navigation, global quick capture, SW registration. */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;
  var views = global.GTD.views;

  var ROUTES = {
    '/hoy': function () { return views.renderToday(); },
    '/entrada': function () { return views.renderInbox(); },
    '/procesar': function () { return global.GTD.process.render(); },
    '/siguientes': function () { return views.renderNext(); },
    '/agenda': function () { return views.renderAgenda(); },
    '/proyectos': function () { return views.renderProjects(); },
    '/espera': function () { return views.renderWaiting(); },
    '/algundia': function () { return views.renderSomeday(); },
    '/horizontes': function () { return views.renderHorizons(); },
    '/referencia': function () { return views.renderReference(); },
    '/revision': function () { return global.GTD.review.render(); },
    '/ia': function () { return views.renderAI(); },
    '/papelera': function () { return views.renderTrash(); },
    '/ajustes': function () { return views.renderSettings(); },
  };

  var NAV_MAIN = [
    { path: '/hoy', icon: '☀️', label: 'Hoy' },
    { path: '/entrada', icon: '📥', label: 'Bandeja de entrada', badge: 'inbox' },
    { path: '/procesar', icon: '⚡', label: 'Procesar' },
    { path: '/siguientes', icon: '📋', label: 'Próximas acciones' },
    { path: '/agenda', icon: '📅', label: 'Agenda' },
    { path: '/proyectos', icon: '🗂️', label: 'Proyectos' },
    { path: '/horizontes', icon: '🧭', label: 'Horizontes' },
    { path: '/espera', icon: '📮', label: 'A la espera' },
    { path: '/algundia', icon: '🌙', label: 'Algún día' },
    { path: '/referencia', icon: '📚', label: 'Referencia' },
  ];

  var NAV_FOOTER = [
    { path: '/revision', icon: '🪞', label: 'Revisión semanal', badge: 'review' },
    { path: '/ia', icon: '✨', label: 'IA' },
    { path: '/papelera', icon: '🗑️', label: 'Papelera' },
    { path: '/ajustes', icon: '⚙️', label: 'Ajustes' },
  ];

  var NAV_MOBILE = [
    { path: '/hoy', icon: '☀️', label: 'Hoy' },
    { path: '/entrada', icon: '📥', label: 'Entrada', badge: 'inbox' },
    { path: '/siguientes', icon: '📋', label: 'Siguientes' },
    { path: '/proyectos', icon: '🗂️', label: 'Proyectos' },
  ];

  var NAV_MOBILE_MORE = [
    { path: '/procesar', icon: '⚡', label: 'Procesar' },
    { path: '/agenda', icon: '📅', label: 'Agenda' },
    { path: '/horizontes', icon: '🧭', label: 'Horizontes' },
    { path: '/espera', icon: '📮', label: 'A la espera' },
    { path: '/algundia', icon: '🌙', label: 'Algún día' },
    { path: '/referencia', icon: '📚', label: 'Referencia' },
    { path: '/revision', icon: '🪞', label: 'Revisión semanal', badge: 'review' },
    { path: '/ia', icon: '✨', label: 'IA' },
    { path: '/papelera', icon: '🗑️', label: 'Papelera' },
    { path: '/ajustes', icon: '⚙️', label: 'Ajustes' },
  ];

  function currentPath() {
    var hash = location.hash.replace(/^#/, '');
    return hash || '/hoy';
  }

  // Nav entries hidden by a feature toggle (Reference, Horizons and Waiting are optional).
  function visibleNav(items) {
    return items.filter(function (item) {
      if (item.path === '/referencia') return model.referenceEnabled();
      if (item.path === '/horizontes') return model.horizonsEnabled();
      if (item.path === '/espera') return model.waitingEnabled();
      return true;
    });
  }

  function badgeHTML(kind) {
    // A discreet dot, never a count: numbers read as pressure, the dot just
    // says "there is something here".
    if (kind === 'inbox' && model.inboxItems().length) {
      return '<span class="ml-auto w-2 h-2 rounded-full bg-accent inline-block" aria-label="Pendiente"></span>';
    }
    if (kind === 'review' && model.reviewIsDue()) {
      return '<span class="ml-auto w-2 h-2 rounded-full bg-accent inline-block" aria-label="Pendiente"></span>';
    }
    return '';
  }

  function renderSidebar() {
    var path = currentPath();
    var html =
      '<div class="px-3 mb-6 flex items-center gap-2">' +
      '<span class="w-7 h-7 rounded-lg bg-accent text-white text-sm font-bold flex items-center justify-center" aria-hidden="true">G</span>' +
      '<span class="font-semibold tracking-tight">makeGTD</span>' +
      '</div>';
    html += '<div class="flex-1 space-y-0.5">';
    visibleNav(NAV_MAIN).forEach(function (item) {
      html += navLink(item, path);
    });
    html += '</div><div class="space-y-0.5 pt-4 border-t border-stone-200 dark:border-stone-800">';
    NAV_FOOTER.forEach(function (item) {
      html += navLink(item, path);
    });
    html += '</div>';
    $('#sidebar').html(html);
  }

  function navLink(item, path) {
    var active = path === item.path || (item.path === '/proyectos' && path.indexOf('/proyectos/') === 0);
    return (
      '<a href="#' + item.path + '" class="nav-link' + (active ? ' nav-link-active' : '') + '">' +
      '<span class="w-5 text-center" aria-hidden="true">' + item.icon + '</span>' +
      '<span class="flex-1">' + item.label + '</span>' +
      (item.badge ? badgeHTML(item.badge) : '') +
      '</a>'
    );
  }

  var moreOpen = false;

  function renderBottomNav() {
    var path = currentPath();
    var html = '<div class="flex">';
    NAV_MOBILE.forEach(function (item) {
      var active = path === item.path || (item.path === '/proyectos' && path.indexOf('/proyectos/') === 0);
      var badge = '';
      if (item.badge === 'inbox' && model.inboxItems().length) {
        badge = '<span class="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-accent" aria-label="Pendiente"></span>';
      }
      html +=
        '<a href="#' + item.path + '" class="relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] ' +
        (active ? 'text-stone-900 dark:text-stone-100 font-medium' : 'text-stone-400 dark:text-stone-500') + '">' +
        badge +
        '<span class="text-lg leading-none" aria-hidden="true">' + item.icon + '</span>' +
        '<span>' + item.label + '</span>' +
        '</a>';
    });
    var moreActive = NAV_MOBILE_MORE.some(function (i) { return i.path === path; });
    html +=
      '<button type="button" id="more-button" class="relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] ' +
      (moreActive || moreOpen ? 'text-stone-900 dark:text-stone-100 font-medium' : 'text-stone-400 dark:text-stone-500') + '">' +
      '<span class="text-lg leading-none" aria-hidden="true">⋯</span>' +
      '<span>Más</span>' +
      (model.reviewIsDue() ? '<span class="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-accent"></span>' : '') +
      '</button>';
    html += '</div>';

    if (moreOpen) {
      html += '<div id="more-menu" class="border-t border-stone-200 dark:border-stone-800 px-3 py-2">';
      visibleNav(NAV_MOBILE_MORE).forEach(function (item) {
        html += navLink(item, path);
      });
      html += '</div>';
    }
    $('#bottom-nav').html(html);
  }

  var lastPath = null;

  function render() {
    var path = currentPath();

    // Tickler: incubated items whose reminder date has arrived return to the inbox.
    model.promoteTickledItems();

    // Route-change housekeeping.
    if (path !== lastPath) {
      views.collapseEditor();
      if (lastPath === '/procesar') global.GTD.process.onRouteLeave();
      if (path === '/revision' && global.GTD.review.isFinished()) global.GTD.review.reset();
      if (lastPath !== null) $('#view').scrollTop && window.scrollTo(0, 0);
      lastPath = path;
    }

    var renderer = ROUTES[path];
    if (path === '/referencia' && !model.referenceEnabled()) renderer = null;
    if (path === '/horizontes' && !model.horizonsEnabled()) renderer = null;
    if (path === '/espera' && !model.waitingEnabled()) renderer = null;
    if (!renderer && path.indexOf('/proyectos/') === 0) {
      var projectId = path.slice('/proyectos/'.length);
      renderer = function () { return views.renderProjectDetail(projectId); };
    }
    if (!renderer) {
      location.hash = '#/hoy';
      return;
    }
    $('#view').html(renderer());
    renderSidebar();
    renderBottomNav();
  }

  function refresh() {
    render();
  }

  // ---- Toast ----

  var toastTimer = null;

  function toast(message) {
    var $toast = $('#toast');
    $toast.text(message).removeClass('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $toast.addClass('hidden');
    }, 1800);
  }

  // ---- Global quick capture ----

  // The notes field starts collapsed so capture stays zero-friction, but full
  // notes are first-class captures (Setup Guide p. 5: the inbox holds "notes
  // and ideas to clarify later", not just one-liners).
  function resetCaptureNotes() {
    $('#capture-notes').val('').addClass('hidden');
    $('#capture-notes-toggle').removeClass('hidden');
  }

  function openCapture() {
    $('#capture-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    resetCaptureNotes();
    $('#capture-input').val('').trigger('focus');
  }

  function closeCapture() {
    $('#capture-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  // Shared by both capture forms: a note with no title is still a valid
  // capture (never lose stuff), so the title falls back to the note's first line.
  function captureItem(title, notes) {
    if (!title && !notes) return false;
    store.addItem({ title: title || notes.split('\n')[0].trim().slice(0, 120), notes: notes });
    return true;
  }

  function bindCapture() {
    $('#capture-fab').on('click', openCapture);

    $('#capture-overlay').on('click', function (e) {
      if (e.target === this) closeCapture();
    });

    $('#capture-notes-toggle').on('click', function () {
      $(this).addClass('hidden');
      $('#capture-notes').removeClass('hidden').trigger('focus');
    });

    $('#capture-form').on('submit', function (e) {
      e.preventDefault();
      var title = $('#capture-input').val().trim();
      var notes = $('#capture-notes').val().trim();
      if (!captureItem(title, notes)) {
        closeCapture();
        return;
      }
      $('#capture-input').val('');
      resetCaptureNotes();
      toast('Capturada 📥');
      refresh();
      $('#capture-input').trigger('focus'); // Stay open: chain several captures.
    });

    // Help popup: what belongs in the inbox. Delegated on document because the
    // trigger lives both in this overlay and in the Inbox view's capture form.
    function closeCaptureHelp() {
      $('#capture-help-overlay').addClass('hidden').attr('aria-hidden', 'true');
    }

    $(document).on('click', '[data-action="help-capture"]', function () {
      $('#capture-help-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    });

    $('#capture-help-overlay').on('click', function (e) {
      if (e.target === this) closeCaptureHelp();
    });

    $('#capture-help-close, #capture-help-ok').on('click', closeCaptureHelp);

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeCaptureHelp();
    });

    $(document).on('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if (e.key === 'Escape') {
        closeCapture();
        closeInstallPopup(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'n' || e.key === 'N') && model.captureShortcutEnabled()) {
        e.preventDefault();
        openCapture();
      }
    });
  }

  // ---- PWA install popup ----

  // Remembered outside the main data key so export/import never touches it.
  var INSTALL_DISMISSED_KEY = 'gtd:install-dismissed';
  var deferredInstallPrompt = null;

  function isStandalone() {
    return (
      (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
      global.navigator.standalone === true
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(global.navigator.userAgent);
  }

  function installDismissed() {
    try {
      return global.localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function rememberInstallDismissed() {
    try {
      global.localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch (ignored) {}
  }

  function openInstallPopup() {
    $('#install-overlay').removeClass('hidden').attr('aria-hidden', 'false');
  }

  function closeInstallPopup(remember) {
    var $overlay = $('#install-overlay');
    if ($overlay.hasClass('hidden')) return;
    $overlay.addClass('hidden').attr('aria-hidden', 'true');
    if (remember) rememberInstallDismissed();
  }

  function bindInstallPopup() {
    if (isStandalone()) return; // Already installed and running as an app.

    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); // Suppress the browser mini-infobar; we show our own popup.
      deferredInstallPrompt = e;
      if (!installDismissed()) openInstallPopup();
    });

    // iOS Safari never fires beforeinstallprompt: show manual instructions instead.
    if (isIos()) {
      $('#install-accept').addClass('hidden');
      $('#install-ios-hint').removeClass('hidden');
      if (!installDismissed()) openInstallPopup();
    }

    global.addEventListener('appinstalled', function () {
      closeInstallPopup(true);
      toast('App instalada ✅');
    });

    $('#install-accept').on('click', function () {
      if (!deferredInstallPrompt) {
        closeInstallPopup(false);
        return;
      }
      var promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      closeInstallPopup(false);
      promptEvent.prompt();
      promptEvent.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'dismissed') rememberInstallDismissed();
      });
    });

    $('#install-close, #install-dismiss').on('click', function () {
      closeInstallPopup(true);
    });

    $('#install-overlay').on('click', function (e) {
      if (e.target === this) closeInstallPopup(true);
    });
  }

  // ---- Device unlock gate (encryption at rest) ----

  // When a device vault is enrolled the store boots locked: block the whole app
  // behind the unlock overlay until the data key is released (biometric or the
  // recovery code). Resolves once the store is readable; a no-op without a vault.
  function runUnlockGate() {
    var vault = global.GTD.vault;
    if (!vault || !vault.isEnrolled()) return Promise.resolve();
    return new Promise(function (resolve) {
      showUnlockOverlay(vault, resolve);
    });
  }

  function showUnlockOverlay(vault, done) {
    var $overlay = $('#unlock-overlay');
    var $err = $('#unlock-error');
    var $bio = $('#unlock-biometric');
    $overlay.removeClass('hidden').attr('aria-hidden', 'false');

    function fail(message) {
      $err.text(message).removeClass('hidden');
    }

    // Bring the decrypted state into memory (or encrypt an as-yet-plaintext
    // document, self-healing an interrupted enrollment), load the sync config,
    // then let the app boot.
    function finish(key) {
      var step = store.isLocked() ? store.unlockWith(key) : store.enableEncryption(key);
      return step
        .then(function () {
          return global.GTD.syncer.loadConfig();
        })
        .then(function () {
          $overlay.addClass('hidden').attr('aria-hidden', 'true');
          done();
        })
        .catch(function () {
          fail('No se pudieron descifrar los datos. Inténtalo de nuevo.');
        });
    }

    if (vault.hasBiometric()) {
      $bio.removeClass('hidden').off('click').on('click', function () {
        $err.addClass('hidden');
        $bio.prop('disabled', true);
        vault
          .unlockWithBiometric()
          .then(finish)
          .catch(function () {
            $bio.prop('disabled', false);
            fail('No se pudo verificar. Usa tu código de recuperación.');
          });
      });
    }

    $('#unlock-recovery-form').off('submit').on('submit', function (e) {
      e.preventDefault();
      $err.addClass('hidden');
      vault
        .unlockWithRecovery($('#unlock-recovery-input').val() || '')
        .then(finish)
        .catch(function () {
          fail('Código incorrecto.');
        });
    });
  }

  // ---- Auto-sync (local-first: push local edits, pull remote changes) ----
  //
  // The sync engine was manual-only (a "Sincronizar ahora" button). This wires
  // it to run on its own so a change on one device reaches the others without
  // anyone opening Settings:
  //   - push:  a debounced sync a few seconds after every local mutation.
  //   - pull:  a sync when the tab/app regains focus, plus a gentle interval
  //            while it stays visible, plus one at boot.
  // Every automatic sync is non-interactive (interactive: false): it never
  // triggers Google's OAuth redirect. The self-hosted server backend always
  // syncs; Google Drive syncs only while its access token is still valid
  // (sessionStorage, ~1 h) — once it expires the backend is silently skipped
  // and the user re-authorizes on the next manual "Sincronizar ahora".
  var AUTOSYNC_DEBOUNCE_MS = 8000; // Coalesce a burst of edits into one push.
  var AUTOSYNC_POLL_MS = 90000; // Pull cadence while the tab is visible.
  var autosyncDebounceTimer = null;
  var autosyncInFlight = false;

  function autosyncConfigured() {
    return !!global.GTD.syncer.getConfig();
  }

  // Never sync out from under an active edit: replacing the state or
  // re-rendering the view would discard half-typed input or collapse an open
  // editor/dialog. Defer instead.
  function userBusy() {
    if (global.GTD.views.isBusy && global.GTD.views.isBusy()) return true;
    var el = global.document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return true;
    return false;
  }

  function scheduleAutoSync() {
    if (!autosyncConfigured()) return;
    if (autosyncDebounceTimer) clearTimeout(autosyncDebounceTimer);
    autosyncDebounceTimer = setTimeout(function () {
      autosyncDebounceTimer = null;
      runAutoSync();
    }, AUTOSYNC_DEBOUNCE_MS);
  }

  function runAutoSync() {
    if (!autosyncConfigured()) return;
    // Busy or a sync already running: try again shortly rather than drop it.
    if (autosyncInFlight || userBusy()) {
      scheduleAutoSync();
      return;
    }
    autosyncInFlight = true;
    global.GTD.syncer
      .sync({ interactive: false })
      .then(function (result) {
        autosyncInFlight = false;
        // Only re-render when remote data actually merged in, and never over an
        // edit the user may have started while the sync was in flight.
        if (result && !result.redirecting && result.changed && !userBusy()) refresh();
      })
      .catch(function () {
        autosyncInFlight = false;
      });
  }

  function initAutoSync(skipInitialSync) {
    // Push shortly after each local mutation (sync-driven merges are excluded
    // by the store; see store.subscribe / replaceState).
    global.GTD.store.subscribe(scheduleAutoSync);
    // Pull when the tab becomes visible again (returning to the PWA/tab).
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible') runAutoSync();
    });
    $(global).on('focus', runAutoSync);
    // Pull on a gentle interval while the tab stays open and visible.
    setInterval(function () {
      if (global.document.visibilityState === 'visible') runAutoSync();
    }, AUTOSYNC_POLL_MS);
    // Pull once now to catch anything changed elsewhere while this device was
    // closed — unless a boot OAuth return already kicked a sync.
    if (!skipInitialSync) runAutoSync();
  }

  // ---- Boot ----

  $(function () {
    // Persistence is async (IndexedDB): nothing may touch the store until
    // init() resolves. It never rejects — it falls back to localStorage.
    // runUnlockGate() then blocks until the device vault (if any) is unlocked.
    store.init()
      .then(runUnlockGate)
      // Finish any Google OAuth redirect first: it exchanges the code (in the
      // query string) for a token and needs the sync config, which is ready
      // once the vault (if any) has unlocked. Async token exchange.
      .then(function () {
        return global.GTD.drive.handleRedirect(global.GTD.syncer.getConfig());
      })
      .then(function (auth) {
      views.bind();
      global.GTD.process.bind();
      global.GTD.review.bind();
      bindCapture();
      bindInstallPopup();

      $('#bottom-nav').on('click', '#more-button', function () {
        moreOpen = !moreOpen;
        renderBottomNav();
      });
      $('#bottom-nav').on('click', 'a', function () {
        moreOpen = false;
      });

      $(window).on('hashchange', render);
      if (!location.hash) location.hash = '#/hoy';
      render();

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function () {
          // Offline support is progressive enhancement; the app still works without it.
        });
      }

      // Ask the browser to never evict this origin's storage under disk
      // pressure (granted silently to installed PWAs; harmless if denied).
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(function () {});
      }

      // Coming back from Google's consent screen: finish the sync the user
      // started before the redirect.
      if (auth) {
        if (auth.ok) {
          toast('Cuenta de Google conectada');
          global.GTD.syncer
            .sync()
            .then(function (result) {
              if (!result || result.redirecting) return;
              if (result.ok) {
                toast('Sincronizado ✅');
              } else {
                var failed = result.results.filter(function (r) {
                  return !r.skipped && !r.ok;
                })[0];
                toast(views.syncBackendLabel(failed.provider) + ': ' + views.syncErrorMessage(failed.error));
              }
              refresh();
            })
            .catch(function (err) {
              toast(views.syncErrorMessage(err));
            });
        } else {
          toast('No se pudo conectar con Google');
        }
      }

      // Start automatic background sync. Skip its initial pull when a boot
      // OAuth return already triggered a (manual, interactive) sync above.
      initAutoSync(!!(auth && auth.ok));
    });
  });

  global.GTD.app = {
    refresh: refresh,
    toast: toast,
    captureItem: captureItem,
  };
})(window, jQuery);
