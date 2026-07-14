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
    '/referencia': function () { return views.renderReference(); },
    '/revision': function () { return global.GTD.review.render(); },
    '/ajustes': function () { return views.renderSettings(); },
  };

  var NAV_MAIN = [
    { path: '/hoy', icon: '☀️', label: 'Hoy' },
    { path: '/entrada', icon: '📥', label: 'Bandeja de entrada', badge: 'inbox' },
    { path: '/procesar', icon: '⚡', label: 'Procesar' },
    { path: '/siguientes', icon: '📋', label: 'Próximas acciones' },
    { path: '/agenda', icon: '📅', label: 'Agenda' },
    { path: '/proyectos', icon: '🗂️', label: 'Proyectos' },
    { path: '/espera', icon: '📮', label: 'A la espera' },
    { path: '/algundia', icon: '🌙', label: 'Algún día' },
    { path: '/referencia', icon: '📚', label: 'Referencia' },
  ];

  var NAV_FOOTER = [
    { path: '/revision', icon: '🪞', label: 'Revisión semanal', badge: 'review' },
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
    { path: '/espera', icon: '📮', label: 'A la espera' },
    { path: '/algundia', icon: '🌙', label: 'Algún día' },
    { path: '/referencia', icon: '📚', label: 'Referencia' },
    { path: '/revision', icon: '🪞', label: 'Revisión semanal', badge: 'review' },
    { path: '/ajustes', icon: '⚙️', label: 'Ajustes' },
  ];

  function currentPath() {
    var hash = location.hash.replace(/^#/, '');
    return hash || '/hoy';
  }

  function badgeHTML(kind) {
    if (kind === 'inbox') {
      var count = model.inboxItems().length;
      if (!count) return '';
      return '<span class="ml-auto text-xs min-w-[1.4rem] h-[1.4rem] px-1 rounded-full bg-accent text-white inline-flex items-center justify-center">' + count + '</span>';
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
    NAV_MAIN.forEach(function (item) {
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
      if (item.badge === 'inbox') {
        var count = model.inboxItems().length;
        if (count) {
          badge = '<span class="absolute top-1 right-1/2 translate-x-4 text-[10px] min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-full bg-accent text-white inline-flex items-center justify-center">' + count + '</span>';
        }
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
      NAV_MOBILE_MORE.forEach(function (item) {
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
      if (path === '/revision' && global.GTD.review.isFinished()) global.GTD.review.reset();
      if (lastPath !== null) $('#view').scrollTop && window.scrollTo(0, 0);
      lastPath = path;
    }

    var renderer = ROUTES[path];
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

  function openCapture() {
    $('#capture-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    $('#capture-input').val('').trigger('focus');
  }

  function closeCapture() {
    $('#capture-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  function bindCapture() {
    $('#capture-fab').on('click', openCapture);

    $('#capture-overlay').on('click', function (e) {
      if (e.target === this) closeCapture();
    });

    $('#capture-form').on('submit', function (e) {
      e.preventDefault();
      var title = $('#capture-input').val().trim();
      if (!title) {
        closeCapture();
        return;
      }
      store.addItem({ title: title });
      $('#capture-input').val('');
      toast('Capturada 📥');
      refresh();
      $('#capture-input').trigger('focus'); // Stay open: chain several captures.
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
      if (e.key === 'n' || e.key === 'N') {
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

  // ---- Boot ----

  $(function () {
    store.load();
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
  });

  global.GTD.app = {
    refresh: refresh,
    toast: toast,
  };
})(window, jQuery);
