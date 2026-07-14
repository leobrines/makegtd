/* Weekly review: a guided, sequential wizard (Reflect phase). It follows the
   official GTD Weekly Review checklist (docs/gtd/gtd-weekly-review-checklist.pdf):
   11 steps in 3 phases — Get Clear, Get Current, Get Creative. */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  var STEPS = [
    { id: 'intro' },
    // Get Clear
    { id: 'papers', phase: 'Aclara' },
    { id: 'inbox', phase: 'Aclara' },
    { id: 'head', phase: 'Aclara' },
    // Get Current
    { id: 'next', phase: 'Ponte al día' },
    { id: 'calendar-past', phase: 'Ponte al día' },
    { id: 'calendar-upcoming', phase: 'Ponte al día' },
    { id: 'waiting', phase: 'Ponte al día' },
    { id: 'projects', phase: 'Ponte al día' },
    { id: 'checklists', phase: 'Ponte al día' },
    // Get Creative
    { id: 'someday', phase: 'Sé creativo' },
    { id: 'creative', phase: 'Sé creativo' },
    { id: 'done' },
  ];
  var stepIndex = 0;

  function esc(text) {
    return global.GTD.views.esc(text);
  }

  function progressDots() {
    // Skip intro/done in the dot count: 11 real steps.
    var total = STEPS.length - 2;
    var current = Math.max(0, Math.min(stepIndex - 1, total - 1));
    var html = '<div class="flex gap-1 mb-6" aria-hidden="true">';
    for (var i = 0; i < total; i++) {
      html += '<span class="h-1.5 flex-1 rounded-full ' +
        (i <= current && stepIndex > 0 ? 'bg-accent' : 'bg-stone-200 dark:bg-stone-800') + '"></span>';
    }
    return html + '</div>';
  }

  function phaseLabel(phase) {
    if (!phase) return '';
    return '<p class="text-xs font-semibold uppercase tracking-wider text-accent mb-1">' + esc(phase) + '</p>';
  }

  function stepTitle(text) {
    return '<p class="text-lg font-medium mb-1">' + stepIndex + ' · ' + esc(text) + '</p>';
  }

  function stepHint(text) {
    return '<p class="text-sm text-stone-500 dark:text-stone-400 mb-4">' + esc(text) + '</p>';
  }

  function continueButton(label) {
    return '<button type="button" class="btn-primary w-full mt-6" data-action="rv-next">' + esc(label || 'Continuar') + '</button>';
  }

  // Quick capture straight into the inbox, reused by several steps.
  function captureForm(placeholder) {
    return (
      '<form class="rv-capture-form card flex items-center gap-2 px-3 py-2">' +
      '<input type="text" class="rv-capture-input flex-1 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="' + esc(placeholder) + '" autocomplete="off" />' +
      '<button type="submit" class="btn-secondary">Capturar</button>' +
      '</form>'
    );
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
    if (step.id !== 'intro' && step.id !== 'done') {
      html += progressDots();
      html += phaseLabel(step.phase);
    }

    switch (step.id) {
      case 'intro': {
        var days = model.daysSinceReview();
        html +=
          '<div class="card px-5 py-6">' +
          '<p class="text-lg font-medium">Once pasos, tres fases: aclara, ponte al día y sé creativo.</p>' +
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

      case 'papers':
        html += stepTitle('Reúne papeles y materiales sueltos');
        html += stepHint('Tarjetas, tickets, notas en papel, apuntes de reuniones… Junta todo lo físico que se haya acumulado y captúralo aquí.');
        html += captureForm('Escribe aquí cada cosa que encuentres…');
        html += continueButton();
        break;

      case 'inbox': {
        var inbox = model.inboxItems();
        html += stepTitle('Procesa tu bandeja hasta cero');
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

      case 'head':
        html += stepTitle('Vacía tu cabeza');
        html += stepHint('¿Compromisos, ideas o preocupaciones sin apuntar? Escríbelos y suéltalos. Irán a la bandeja: no decidas nada ahora.');
        html += captureForm('¿Qué más tienes en la cabeza?');
        html += continueButton('Nada más, continuar');
        break;

      case 'next': {
        var actions = model.nextActions();
        html += stepTitle('Repasa tus próximas acciones');
        html += stepHint('Marca las hechas, elimina las muertas y anota los pasos siguientes que te sugieran.');
        html += actions.length
          ? simpleList(actions, function (item) {
              return item.context && model.contextsEnabled()
                ? '<span class="text-xs text-stone-400 dark:text-stone-500">' + esc(item.context) + '</span>'
                : '';
            })
          : '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">No hay próximas acciones.</div>';
        html += '<a href="#/siguientes" class="btn-secondary w-full mt-3">Abrir la lista para editar</a>';
        html += continueButton();
        break;
      }

      case 'calendar-past': {
        var overdue = model.overdueItems();
        html += stepTitle('Repasa el calendario pasado');
        html += stepHint('¿Quedó algo sin hacer o algo que capturar de los días anteriores? Pásalo al sistema.');
        html += overdue.length
          ? simpleList(overdue, function (item) {
              return '<span class="text-xs text-red-600 dark:text-red-400">' + esc(model.formatDate(item.date)) + '</span>';
            })
          : '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">Nada vencido ✓</div>';
        if (overdue.length) {
          html += '<a href="#/agenda" class="btn-secondary w-full mt-3">Abrir la agenda para editar</a>';
        }
        html += continueButton();
        break;
      }

      case 'calendar-upcoming': {
        // Cap the horizon at 14 days to keep it calm.
        var t = model.todayISO().split('-');
        var horizon = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]) + 14);
        var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
        var horizonISO = horizon.getFullYear() + '-' + pad2(horizon.getMonth() + 1) + '-' + pad2(horizon.getDate());
        var upcoming = model.dueTodayItems().concat(model.upcomingItems().filter(function (item) {
          return item.date <= horizonISO;
        }));
        html += stepTitle('Repasa el calendario próximo');
        html += stepHint('¿Algo de los próximos días necesita preparación? Captura las acciones que te dispare.');
        html += upcoming.length
          ? simpleList(upcoming, function (item) {
              return '<span class="text-xs text-stone-400 dark:text-stone-500">' + esc(model.formatDate(item.date)) + '</span>';
            })
          : '<div class="card px-5 py-5 text-stone-500 dark:text-stone-400">Nada con fecha en los próximos 14 días.</div>';
        if (upcoming.length) {
          html += '<a href="#/agenda" class="btn-secondary w-full mt-3">Abrir la agenda para editar</a>';
        }
        html += continueButton();
        break;
      }

      case 'waiting': {
        var waiting = model.waitingItems();
        html += stepTitle('Repasa lo que está en espera');
        html += stepHint('¿Alguien te debe una respuesta? Marca lo recibido y anota los recordatorios que toquen.');
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

      case 'projects': {
        var projects = model.activeProjects();
        var stalled = model.stalledProjects();
        html += stepTitle('Repasa tus proyectos');
        html += stepHint('Evalúalos uno a uno: cada proyecto activo necesita al menos una próxima acción.');
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
        html += '<a href="#/proyectos" class="btn-secondary w-full mt-3">Abrir proyectos para editar</a>';
        html += continueButton();
        break;
      }

      case 'checklists': {
        html += stepTitle('Repasa tus listas de referencia');
        html += stepHint('Úsalas como disparador: ¿te recuerdan alguna acción nueva? Captúrala aquí.');
        // The step stays even with the in-app Reference list off (the official
        // checklist keeps it); it then points at wherever the user keeps them.
        if (model.referenceEnabled()) {
          var reference = model.referenceItems();
          html += reference.length
            ? '<p class="text-sm text-stone-500 dark:text-stone-400 mb-3">Tienes ' + reference.length + ' elemento' + (reference.length === 1 ? '' : 's') + ' en <a href="#/referencia" class="text-accent">Referencia</a>.</p>'
            : '<p class="text-sm text-stone-500 dark:text-stone-400 mb-3">No tienes material de referencia todavía.</p>';
        } else {
          html += '<p class="text-sm text-stone-500 dark:text-stone-400 mb-3">Repasa las listas y checklists que guardes fuera de la app.</p>';
        }
        html += captureForm('¿Alguna acción nueva que capturar?');
        html += continueButton();
        break;
      }

      case 'someday': {
        var someday = model.somedayItems();
        var incubating = model.somedayProjects();
        html += stepTitle('Echa un vistazo a «Algún día»');
        html += stepHint('¿Ha llegado el momento de activar alguna idea? Borra las que ya no te interesen.');
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
        html += continueButton();
        break;
      }

      case 'creative':
        html += stepTitle('Sé creativo y valiente');
        html += stepHint('¿Alguna idea nueva, brillante o arriesgada que quieras añadir al sistema? Este es el momento.');
        html += captureForm('Escríbela sin miedo…');
        html += continueButton('Terminar la revisión');
        break;

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
      if (STEPS[stepIndex].id === 'done') {
        store.updateSettings({ lastReviewAt: new Date().toISOString() });
        global.GTD.app.toast('Revisión semanal completada 🎉');
      }
      global.GTD.app.refresh();
    });

    $view.on('click', '[data-action="rv-activate"]', function () {
      store.updateItem($(this).data('id'), { status: model.STATUS.NEXT, tickleDate: null });
      global.GTD.app.toast('Movida a próximas acciones');
      global.GTD.app.refresh();
    });

    $view.on('click', '[data-action="rv-activate-project"]', function () {
      model.activateProject($(this).data('id'));
      global.GTD.app.toast('Proyecto activado');
      global.GTD.app.refresh();
    });

    // Chained capture straight into the inbox (papers, head, checklists, creative).
    $view.on('submit', '.rv-capture-form', function (e) {
      e.preventDefault();
      var title = $(this).find('.rv-capture-input').val().trim();
      if (!title) return;
      store.addItem({ title: title });
      global.GTD.app.toast('Capturada 📥');
      global.GTD.app.refresh();
      $('.rv-capture-input').trigger('focus');
    });
  }

  global.GTD.review = {
    render: render,
    bind: bind,
    reset: function () {
      stepIndex = 0;
    },
    isFinished: function () {
      return STEPS[stepIndex].id === 'done';
    },
  };
})(window, jQuery);
