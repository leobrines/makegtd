/* Clarify wizard: walks the GTD decision tree one question at a time.
   The step order follows the official GTD Workflow Map (docs/gtd/gtd-workflow-map.pdf):
   is it actionable? -> no: trash / incubate (someday or date trigger) / reference
                     -> yes: multi-step? -> define the project (desired outcome) and
                        its first action; then decide for the action: do it (<2 min),
                        delegate (waiting for), or defer (calendar or next actions). */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  // actionable | not-actionable | incubate | steps | two-minutes | doing-now |
  // project | project-action | who | delegate | when | schedule | next
  var step = 'actionable';
  var itemId = null;
  // Multi-step path: project and first action being defined, committed at the end.
  var pending = null; // { projectName, projectOutcome, actionTitle }

  function esc(text) {
    return global.GTD.views.esc(text);
  }

  function currentItem() {
    var inbox = model.inboxItems();
    if (itemId) {
      for (var i = 0; i < inbox.length; i++) {
        if (inbox[i].id === itemId) return inbox[i];
      }
    }
    itemId = inbox.length ? inbox[0].id : null;
    step = 'actionable';
    pending = null;
    return inbox.length ? inbox[0] : null;
  }

  function finishItem(message) {
    itemId = null;
    step = 'actionable';
    pending = null;
    global.GTD.app.toast(message);
    global.GTD.app.refresh();
  }

  function choice(action, icon, label, hint) {
    return (
      '<button type="button" class="btn-choice mb-2" data-action="' + action + '">' +
      '<span class="text-xl w-7 text-center shrink-0" aria-hidden="true">' + icon + '</span>' +
      '<span class="min-w-0"><span class="block">' + esc(label) + '</span>' +
      (hint ? '<span class="block text-xs font-normal text-stone-400 dark:text-stone-500">' + esc(hint) + '</span>' : '') +
      '</span></button>'
    );
  }

  function question(text) {
    return '<p class="text-lg font-medium mb-4">' + esc(text) + '</p>';
  }

  function backLink() {
    return '<button type="button" class="btn-ghost mt-2" data-action="pz-back">‹ Volver atrás</button>';
  }

  // Optional link to an existing project, shown on the defer/delegate endings of the
  // single-step path (Setup Guide p. 8: next actions may be steps of current projects).
  function projectSelect(item) {
    if (pending) return ''; // Multi-step path: the action belongs to the new project.
    var projects = model.activeProjects();
    if (!projects.length) return '';
    var html =
      '<label class="block mb-3">' +
      '<span class="block text-xs text-stone-400 dark:text-stone-500 mb-1">¿Es parte de un proyecto? (opcional)</span>' +
      '<select id="pz-project-select" class="field">' +
      '<option value="">Sin proyecto</option>';
    projects.forEach(function (p) {
      html += '<option value="' + p.id + '"' + (item && item.projectId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html + '</select></label>';
  }

  function selectedProjectId(item) {
    var $select = $('#pz-project-select');
    if ($select.length) return $select.val() || null;
    return item ? item.projectId : null;
  }

  // Terminal move for the action being clarified. On the multi-step path this
  // creates the project plus its first action; otherwise it updates the item.
  function commitAction(fields) {
    var item = store.getItem(itemId);
    if (pending) {
      var project = store.addProject({ name: pending.projectName, outcome: pending.projectOutcome });
      store.addItem(Object.assign({ title: pending.actionTitle, projectId: project.id }, fields));
      store.removeItem(itemId);
    } else {
      store.updateItem(itemId, Object.assign({ projectId: selectedProjectId(item) }, fields));
    }
  }

  function render() {
    var item = currentItem();
    var remaining = model.inboxItems().length;

    var html = global.GTD.views.header('Procesar', remaining
      ? remaining + ' en la bandeja · una cosa a la vez'
      : '');

    if (!item) {
      return html + global.GTD.views.emptyState('🎉', 'Bandeja vacía. Tu mente puede soltar.', 'Ver próximas acciones', '#/siguientes');
    }

    // The item being clarified, always visible and stable at the top.
    html +=
      '<div class="card px-5 py-5 mb-6">' +
      '<p class="text-xl font-medium break-words">' + esc(item.title) + '</p>' +
      (item.notes ? '<p class="text-sm text-stone-500 dark:text-stone-400 mt-1">' + esc(item.notes) + '</p>' : '') +
      (pending && pending.actionTitle
        ? '<p class="text-sm text-stone-500 dark:text-stone-400 mt-2">Primera acción: ' + esc(pending.actionTitle) + '</p>'
        : '') +
      '</div>';

    switch (step) {
      case 'actionable':
        html +=
          '<div class="mb-4">' +
          '<div class="flex items-start gap-1">' +
          '<p class="text-lg font-medium">' + esc('¿Es accionable?') + '</p>' +
          '<button type="button" class="w-11 h-11 -my-2 shrink-0 flex items-center justify-center" data-action="pz-help-actionable" aria-label="¿Qué es un accionable?" aria-haspopup="dialog">' +
          '<span class="w-5 h-5 rounded-full border border-stone-300 dark:border-stone-600 text-xs font-semibold text-stone-400 dark:text-stone-500 flex items-center justify-center" aria-hidden="true">!</span>' +
          '</button>' +
          '</div>' +
          '<p class="text-sm text-stone-500 dark:text-stone-400">' + esc('¿Te comprometes a hacer algo ahora?') + '</p>' +
          '</div>';
        html += choice('pz-yes-actionable', '⚡', 'Sí, hay que actuar');
        html += choice('pz-no-actionable', '🍃', 'No, por ahora no');
        break;

      case 'not-actionable':
        html += question('Entonces, ¿qué es?');
        html += choice('pz-trash', '🗑️', 'Nada, eliminar', 'No lo necesitas.');
        html += choice('pz-someday', '🌙', 'Algún día / Tal vez', 'Incubar para más adelante.');
        html += choice('pz-reference', '📚', 'Referencia', 'Información útil para guardar.');
        html += backLink();
        break;

      case 'incubate':
        var t = model.todayISO().split('-');
        var tomorrow = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]) + 1);
        var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
        var tomorrowISO = tomorrow.getFullYear() + '-' + pad2(tomorrow.getMonth() + 1) + '-' + pad2(tomorrow.getDate());
        html += question('¿Cuándo quieres volver a verlo?');
        html += choice('pz-someday-nodate', '🌙', 'Sin fecha concreta', 'Lo verás en la revisión semanal.');
        html +=
          '<form id="pz-tickle-form" class="card px-4 py-4 mb-2">' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mb-1">O que vuelva a la bandeja un día concreto:</span>' +
          '<input type="date" id="pz-tickle-input" class="field mb-3" min="' + tomorrowISO + '" />' +
          '<button type="submit" class="btn-secondary w-full">Recordármelo ese día</button>' +
          '</form>';
        html += backLink();
        break;

      case 'steps':
        html += question('¿Se resuelve con un solo paso o con varios?');
        html += choice('pz-single', '👣', 'Un solo paso');
        html += choice('pz-multi', '🗂️', 'Varios pasos', 'Es un proyecto: definiremos su resultado.');
        html += backLink();
        break;

      case 'two-minutes':
        html += question('¿Se hace en menos de 2 minutos?');
        html += choice('pz-do-now', '⏱️', 'Sí, lo hago ahora mismo');
        html += choice('pz-more-time', '🧭', 'No, lleva más tiempo');
        html += backLink();
        break;

      case 'doing-now':
        html += question('Adelante, hazlo ahora. Aquí te espero.');
        html += choice('pz-done', '✅', 'Hecho');
        html += backLink();
        break;

      case 'project':
        html += question('Un proyecto. ¿Qué resultado quieres conseguir?');
        html +=
          '<form id="pz-project-form">' +
          '<label class="block mb-3">' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mb-1">Nombre del proyecto</span>' +
          '<input type="text" id="pz-project-name" class="field" value="' + esc(pending ? pending.projectName : item.title) + '" autocomplete="off" />' +
          '</label>' +
          '<label class="block mb-3">' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mb-1">¿Cómo sabrás que está terminado? (opcional)</span>' +
          '<input type="text" id="pz-project-outcome" class="field" value="' + esc(pending ? pending.projectOutcome : item.notes || '') + '" autocomplete="off" />' +
          '</label>' +
          '<button type="submit" class="btn-primary w-full">Continuar</button>' +
          '</form>';
        html += backLink();
        break;

      case 'project-action':
        html += question('¿Cuál es la primera acción física y visible?');
        html +=
          '<form id="pz-project-action-form">' +
          '<input type="text" id="pz-project-action-input" class="field mb-3" placeholder="Ej.: llamar a Ana para pedir presupuesto" autocomplete="off" value="' + esc(pending && pending.actionTitle || '') + '" />' +
          '<button type="submit" class="btn-primary w-full">Continuar</button>' +
          '</form>';
        html += backLink();
        break;

      case 'who':
        html += question(pending ? '¿Quién debería hacer esa primera acción?' : '¿Quién debería hacerlo?');
        html += choice('pz-me', '🙋', 'Yo');
        html += choice('pz-delegate', '📨', 'Otra persona', 'Delégalo y espera respuesta.');
        html += backLink();
        break;

      case 'delegate':
        html += question('¿A quién se lo delegas?');
        html +=
          '<form id="pz-delegate-form">' +
          '<input type="text" id="pz-delegate-input" class="field mb-3" placeholder="Nombre de la persona" autocomplete="off" />' +
          projectSelect(item) +
          '<button type="submit" class="btn-primary w-full">Mover a «A la espera»</button>' +
          '</form>';
        html += backLink();
        break;

      case 'when':
        html += question('¿Tiene que hacerse un día concreto?');
        html += choice('pz-has-date', '📅', 'Sí, tiene fecha');
        html += choice('pz-no-date', '📋', 'No, cuanto antes mejor', 'Irá a próximas acciones.');
        html += backLink();
        break;

      case 'schedule':
        html += question('¿Qué día?');
        html +=
          '<form id="pz-schedule-form">' +
          '<input type="date" id="pz-schedule-input" class="field mb-3" min="' + model.todayISO() + '" value="' + model.todayISO() + '" />' +
          projectSelect(item) +
          '<button type="submit" class="btn-primary w-full">Programar</button>' +
          '<button type="button" class="btn-secondary w-full mt-2 gap-2" data-action="pz-gcal">' +
          global.GTD.views.gcalIcon() + '<span>Añadir también a Google Calendar</span>' +
          '</button>' +
          '</form>';
        html += backLink();
        break;

      case 'next':
        html += question('¿Dónde la harás?');
        html += projectSelect(item);
        html += '<div class="flex flex-wrap gap-2 mb-4">';
        store.getContexts().forEach(function (c) {
          html += '<button type="button" class="chip" data-action="pz-context" data-context="' + esc(c) + '">' + esc(c) + '</button>';
        });
        html += '</div>';
        html += '<button type="button" class="btn-secondary w-full" data-action="pz-no-context">Sin contexto, solo guárdala</button>';
        html += backLink();
        break;
    }

    return html;
  }

  function bind() {
    var $view = $('#view');

    function go(nextStep) {
      step = nextStep;
      global.GTD.app.refresh();
    }

    $view.on('click', '[data-action="pz-yes-actionable"]', function () { go('steps'); });
    $view.on('click', '[data-action="pz-no-actionable"]', function () { go('not-actionable'); });

    // Help popup: what "actionable" means.
    function closeHelp() {
      $('#actionable-help-overlay').addClass('hidden').attr('aria-hidden', 'true');
    }

    $view.on('click', '[data-action="pz-help-actionable"]', function () {
      $('#actionable-help-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    });

    $('#actionable-help-overlay').on('click', function (e) {
      if (e.target === this) closeHelp();
    });

    $('#actionable-help-close, #actionable-help-ok').on('click', closeHelp);

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeHelp();
    });

    $view.on('click', '[data-action="pz-back"]', function () {
      var back = {
        'not-actionable': 'actionable',
        incubate: 'not-actionable',
        steps: 'actionable',
        'two-minutes': 'steps',
        'doing-now': 'two-minutes',
        project: 'steps',
        'project-action': 'project',
        delegate: 'who',
        when: 'who',
        schedule: 'when',
        next: 'when',
      };
      if (step === 'who') {
        go(pending ? 'project-action' : 'two-minutes');
        return;
      }
      go(back[step] || 'actionable');
    });

    $view.on('click', '[data-action="pz-trash"]', function () {
      store.removeItem(itemId);
      finishItem('Eliminada. Una cosa menos.');
    });

    $view.on('click', '[data-action="pz-someday"]', function () { go('incubate'); });

    $view.on('click', '[data-action="pz-someday-nodate"]', function () {
      store.updateItem(itemId, { status: model.STATUS.SOMEDAY, tickleDate: null });
      finishItem('Guardada en «Algún día»');
    });

    // Incubate with a date-specific trigger (workflow map: tickler): the item
    // returns to the inbox automatically on the chosen day.
    $view.on('submit', '#pz-tickle-form', function (e) {
      e.preventDefault();
      var date = $('#pz-tickle-input').val();
      if (!date) return;
      store.updateItem(itemId, { status: model.STATUS.SOMEDAY, tickleDate: date });
      finishItem('Volverá a la bandeja el ' + model.formatDate(date));
    });

    $view.on('click', '[data-action="pz-reference"]', function () {
      store.updateItem(itemId, { status: model.STATUS.REFERENCE });
      finishItem('Guardada como referencia');
    });

    $view.on('click', '[data-action="pz-single"]', function () {
      pending = null;
      go('two-minutes');
    });

    $view.on('click', '[data-action="pz-multi"]', function () { go('project'); });

    $view.on('submit', '#pz-project-form', function (e) {
      e.preventDefault();
      var name = $('#pz-project-name').val().trim();
      if (!name) return;
      pending = {
        projectName: name,
        projectOutcome: $('#pz-project-outcome').val().trim(),
        actionTitle: pending ? pending.actionTitle : '',
      };
      go('project-action');
    });

    // Every project needs a first next action (Setup Guide); it then goes through
    // the same delegate/defer decisions as any other action (workflow map).
    $view.on('submit', '#pz-project-action-form', function (e) {
      e.preventDefault();
      var title = $('#pz-project-action-input').val().trim();
      if (!title) return;
      pending.actionTitle = title;
      go('who');
    });

    $view.on('click', '[data-action="pz-do-now"]', function () { go('doing-now'); });
    $view.on('click', '[data-action="pz-more-time"]', function () { go('who'); });

    $view.on('click', '[data-action="pz-done"]', function () {
      model.completeItem(itemId);
      finishItem('Hecha ✓ Así de simple.');
    });

    $view.on('click', '[data-action="pz-me"]', function () { go('when'); });
    $view.on('click', '[data-action="pz-delegate"]', function () { go('delegate'); });

    $view.on('submit', '#pz-delegate-form', function (e) {
      e.preventDefault();
      var who = $('#pz-delegate-input').val().trim();
      if (!who) return;
      var wasProject = !!pending;
      commitAction({ status: model.STATUS.WAITING, waitingFor: who });
      finishItem(wasProject ? 'Proyecto creado; primera acción a la espera de ' + who : 'A la espera de ' + who);
    });

    $view.on('click', '[data-action="pz-has-date"]', function () { go('schedule'); });
    $view.on('click', '[data-action="pz-no-date"]', function () { go('next'); });

    // Open Google Calendar pre-filled with the chosen date, without leaving the wizard.
    $view.on('click', '[data-action="pz-gcal"]', function () {
      var item = store.getItem(itemId);
      var date = $('#pz-schedule-input').val() || model.todayISO();
      if (!item) return;
      global.open(model.gcalUrl({
        title: pending ? pending.actionTitle : item.title,
        notes: pending ? '' : item.notes,
        date: date,
      }), '_blank', 'noopener');
    });

    $view.on('submit', '#pz-schedule-form', function (e) {
      e.preventDefault();
      var date = $('#pz-schedule-input').val();
      if (!date) return;
      var wasProject = !!pending;
      commitAction({ status: model.STATUS.SCHEDULED, date: date });
      finishItem((wasProject ? 'Proyecto creado; primera acción programada' : 'Programada') + ' para el ' + model.formatDate(date));
    });

    $view.on('click', '[data-action="pz-context"]', function () {
      var wasProject = !!pending;
      commitAction({ status: model.STATUS.NEXT, context: $(this).data('context') });
      finishItem(wasProject ? 'Proyecto creado con su primera acción' : 'Añadida a próximas acciones');
    });

    $view.on('click', '[data-action="pz-no-context"]', function () {
      var wasProject = !!pending;
      commitAction({ status: model.STATUS.NEXT });
      finishItem(wasProject ? 'Proyecto creado con su primera acción' : 'Añadida a próximas acciones');
    });
  }

  global.GTD.process = {
    render: render,
    bind: bind,
    reset: function () {
      itemId = null;
      step = 'actionable';
      pending = null;
    },
  };
})(window, jQuery);
