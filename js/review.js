/* Weekly review: a guided, sequential checklist (Reflect phase). */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  var STEPS = ['intro', 'inbox', 'head', 'calendar', 'next', 'projects', 'waiting', 'someday', 'done'];
  var stepIndex = 0;

  function esc(text) {
    return global.GTD.views.esc(text);
  }

  function progressDots() {
    // Skip intro/done in the dot count: 5 real steps.
    var total = STEPS.length - 2;
    var current = Math.max(0, Math.min(stepIndex - 1, total - 1));
    var html = '<div class="flex gap-1.5 mb-6" aria-hidden="true">';
    for (var i = 0; i < total; i++) {
      html += '<span class="h-1.5 w-6 rounded-full ' +
        (i <= current && stepIndex > 0 ? 'bg-accent' : 'bg-stone-200 dark:bg-stone-800') + '"></span>';
    }
    return html + '</div>';
  }

  function continueButton(label) {
    return '<button type="button" class="btn-primary w-full mt-6" data-action="rv-next">' + esc(label || 'Continuar') + '</button>';
  }

  function simpleList(items, renderMeta) {
    if (!items.length) return '';
    return '<ul class="card divide-y divide-stone-100 dark:divide-stone-800">' + items.map(function (item) {
      return (
        '<li class="px-4 py-3">' +
        '<span class="block">' + esc(item.title) + '</span>' +
        (renderMeta ? renderMeta(item) : '') +
        '</li>'
      );
    }).join('') + '</ul>';
  }

  function render() {
    var step = STEPS[stepIndex];
    var html = global.GTD.views.header('Revisión semanal');
    if (step !== 'intro' && step !== 'done') html += progressDots();

    switch (step) {
      case 'intro': {
        var days = model.daysSinceReview();
        html +=
          '<div class="card px-5 py-6">' +
          '<p class="text-lg font-medium">Siete pasos, una vez por semana.</p>' +
          '<p class="text-sm text-stone-500 dark:text-stone-400 mt-2">' +
          'Es lo que mantiene el sistema (y tu cabeza) en orden. Ve paso a paso, sin prisa.' +
          '</p>' +
          (days !== null
            ? '<p class="text-xs text-stone-400 dark:text-stone-500 mt-3">Última revisión: hace ' + days + ' día' + (days === 1 ? '' : 's') + '</p>'
            : '') +
          '</div>' +
          continueButton('Empezar la revisión');
        break;
      }

      case 'inbox': {
        var inbox = model.inboxItems();
        html += '<p class="text-lg font-medium mb-3">1 · Vacía tu bandeja de entrada</p>';
        if (inbox.length) {
          html +=
            '<div class="card px-5 py-5">' +
            '<p>Tienes <strong>' + inbox.length + '</strong> cosa' + (inbox.length === 1 ? '' : 's') + ' sin procesar.</p>' +
            '<a href="#/procesar" class="btn-primary w-full mt-4">Procesar ahora</a>' +
            '<p class="text-xs text-stone-400 dark:text-stone-500 mt-3">Cuando termines, vuelve aquí: la revisión seguirá donde la dejaste.</p>' +
            '</div>' +
            '<button type="button" class="btn-ghost w-full mt-3" data-action="rv-next">Saltar este paso</button>';
        } else {
          html +=
            '<div class="card px-5 py-5"><p>Bandeja vacía ✓ Nada pendiente de procesar.</p></div>' +
            continueButton();
        }
        break;
      }

      case 'head': {
        html += '<p class="text-lg font-medium mb-1">2 · Vacía tu cabeza</p>';
        html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">¿Compromisos, ideas o preocupaciones sin apuntar? Escríbelos y suéltalos. Irán a la bandeja: no decidas nada ahora.</p>';
        html +=
          '<form id="rv-head-form" class="card flex items-center gap-2 px-3 py-2">' +
          '<input type="text" id="rv-head-input" class="flex-1 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="¿Qué más tienes en la cabeza?" autocomplete="off" />' +
          '<button type="submit" class="btn-secondary">Capturar</button>' +
          '</form>';
        html += continueButton('Nada más, continuar');
        break;
      }

      case 'calendar': {
        var overdue = model.overdueItems();
        // Official checklist: review the upcoming calendar. Cap at 14 days to keep it calm.
        var t = model.todayISO().split('-');
        var horizon = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]) + 14);
        var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
        var horizonISO = horizon.getFullYear() + '-' + pad2(horizon.getMonth() + 1) + '-' + pad2(horizon.getDate());
        var upcoming = model.dueTodayItems().concat(model.upcomingItems().filter(function (item) {
          return item.date <= horizonISO;
        }));
        html += '<p class="text-lg font-medium mb-1">3 · Repasa tu calendario</p>';
        html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">Lo pasado, ¿sigue siendo relevante? Lo próximo, ¿necesita preparación?</p>';
        if (overdue.length) {
          html += '<p class="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2 px-1">Vencidas</p>';
          html += simpleList(overdue, function (item) {
            return '<span class="text-xs text-red-600 dark:text-red-400">' + esc(model.formatDate(item.date)) + '</span>';
          });
        }
        if (upcoming.length) {
          html += '<p class="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mt-4 mb-2 px-1">Próximamente</p>';
          html += simpleList(upcoming, function (item) {
            return '<span class="text-xs text-stone-400 dark:text-stone-500">' + esc(model.formatDate(item.date)) + '</span>';
          });
        }
        if (!overdue.length && !upcoming.length) {
          html += '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">Nada con fecha pendiente ✓</div>';
        } else {
          html += '<a href="#/agenda" class="btn-secondary w-full mt-3">Abrir la agenda para editar</a>';
        }
        html += continueButton();
        break;
      }

      case 'next': {
        var actions = model.nextActions();
        html += '<p class="text-lg font-medium mb-1">4 · Repasa tus próximas acciones</p>';
        html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">¿Sigue siendo relevante cada una? Marca las hechas, elimina las muertas.</p>';
        html += actions.length
          ? simpleList(actions, function (item) {
              return item.context
                ? '<span class="text-xs text-stone-400 dark:text-stone-500">' + esc(item.context) + '</span>'
                : '';
            })
          : '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">No hay próximas acciones.</div>';
        html += '<a href="#/siguientes" class="btn-secondary w-full mt-3">Abrir la lista para editar</a>';
        html += continueButton();
        break;
      }

      case 'projects': {
        var projects = model.activeProjects();
        var stalled = model.stalledProjects();
        html += '<p class="text-lg font-medium mb-1">5 · Repasa tus proyectos</p>';
        html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">Cada proyecto activo necesita una próxima acción.</p>';
        if (stalled.length) {
          html += '<ul class="card divide-y divide-stone-100 dark:divide-stone-800 mb-3 border-amber-200 dark:border-amber-900">' +
            stalled.map(function (p) {
              return '<li class="px-4 py-3"><a href="#/proyectos/' + p.id + '" class="block">' +
                '<span class="block">' + esc(p.name) + '</span>' +
                '<span class="text-xs text-amber-600 dark:text-amber-400">Sin próxima acción — tócalo para decidirla</span>' +
                '</a></li>';
            }).join('') + '</ul>';
        }
        html += projects.length
          ? '<p class="text-sm text-stone-500 dark:text-stone-400">' + projects.length + ' proyecto' + (projects.length === 1 ? '' : 's') + ' activo' + (projects.length === 1 ? '' : 's') +
            (stalled.length ? ', ' + stalled.length + ' sin próxima acción.' : ', todos con próxima acción ✓') + '</p>'
          : '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">No hay proyectos activos.</div>';
        html += continueButton();
        break;
      }

      case 'waiting': {
        var waiting = model.waitingItems();
        html += '<p class="text-lg font-medium mb-1">6 · Repasa lo que está en espera</p>';
        html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">¿Alguien te debe una respuesta? Quizá toque un recordatorio.</p>';
        html += waiting.length
          ? simpleList(waiting, function (item) {
              var since = item.updatedAt ? model.relativeDays(item.updatedAt.slice(0, 10)) : '';
              return '<span class="text-xs text-stone-400 dark:text-stone-500">' +
                esc(item.waitingFor || '') + (since ? ' · desde ' + esc(since) : '') + '</span>';
            })
          : '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">No esperas nada de nadie ✓</div>';
        html += continueButton();
        break;
      }

      case 'someday': {
        var someday = model.somedayItems();
        var incubating = model.somedayProjects();
        html += '<p class="text-lg font-medium mb-1">7 · Echa un vistazo a «Algún día»</p>';
        html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">¿Ha llegado el momento de activar alguna idea?</p>';
        if (someday.length || incubating.length) {
          html += '<ul class="card divide-y divide-stone-100 dark:divide-stone-800">' +
            someday.map(function (item) {
              return '<li class="px-4 py-2 flex items-center justify-between gap-3">' +
                '<span class="truncate">' + esc(item.title) + '</span>' +
                '<button type="button" class="btn-ghost text-accent shrink-0" data-action="rv-activate" data-id="' + item.id + '">Activar</button>' +
                '</li>';
            }).join('') +
            incubating.map(function (p) {
              return '<li class="px-4 py-2 flex items-center justify-between gap-3">' +
                '<span class="truncate">' + esc(p.name) + ' <span class="text-xs text-stone-400 dark:text-stone-500">proyecto</span></span>' +
                '<button type="button" class="btn-ghost text-accent shrink-0" data-action="rv-activate-project" data-id="' + p.id + '">Activar</button>' +
                '</li>';
            }).join('') +
            '</ul>';
        } else {
          html += '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">Nada incubando por ahora.</div>';
        }
        html += continueButton('Terminar la revisión');
        break;
      }

      case 'done':
        html +=
          '<div class="card px-6 py-12 text-center">' +
          '<div class="text-4xl mb-3" aria-hidden="true">🧘</div>' +
          '<p class="text-lg font-medium">Revisión completada</p>' +
          '<p class="text-sm text-stone-500 dark:text-stone-400 mt-2">Tu sistema está al día. Nos vemos la semana que viene.</p>' +
          '<a href="#/hoy" class="btn-primary mt-6">Ir a Hoy</a>' +
          '</div>';
        break;
    }

    return html;
  }

  function bind() {
    var $view = $('#view');

    $view.on('click', '[data-action="rv-next"]', function () {
      stepIndex += 1;
      if (STEPS[stepIndex] === 'done') {
        store.updateSettings({ lastReviewAt: new Date().toISOString() });
        global.GTD.app.toast('Revisión semanal completada 🎉');
      }
      global.GTD.app.refresh();
    });

    $view.on('click', '[data-action="rv-activate"]', function () {
      store.updateItem($(this).data('id'), { status: model.STATUS.NEXT });
      global.GTD.app.toast('Movida a próximas acciones');
      global.GTD.app.refresh();
    });

    $view.on('click', '[data-action="rv-activate-project"]', function () {
      store.updateProject($(this).data('id'), { status: 'active' });
      global.GTD.app.toast('Proyecto activado');
      global.GTD.app.refresh();
    });

    // "Empty your head": chained capture straight into the inbox.
    $view.on('submit', '#rv-head-form', function (e) {
      e.preventDefault();
      var $input = $('#rv-head-input');
      var title = $input.val().trim();
      if (!title) return;
      store.addItem({ title: title });
      $input.val('');
      global.GTD.app.toast('Capturada 📥');
      global.GTD.app.refresh();
      $('#rv-head-input').trigger('focus');
    });
  }

  global.GTD.review = {
    render: render,
    bind: bind,
    reset: function () {
      stepIndex = 0;
    },
    isFinished: function () {
      return STEPS[stepIndex] === 'done';
    },
  };
})(window, jQuery);
