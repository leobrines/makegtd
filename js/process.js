/* Clarify wizard: walks the GTD decision tree one question at a time. */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  var step = 'actionable'; // actionable | not-actionable | two-minutes | doing-now | who | delegate | steps | project | when | next | schedule
  var itemId = null;

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
    return inbox.length ? inbox[0] : null;
  }

  function finishItem(message) {
    itemId = null;
    step = 'actionable';
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
      '</div>';

    switch (step) {
      case 'actionable':
        html += question('¿Requiere hacer algo?');
        html += choice('pz-yes-actionable', '⚡', 'Sí, hay que actuar');
        html += choice('pz-no-actionable', '🍃', 'No, no requiere acción');
        break;

      case 'not-actionable':
        html += question('Entonces, ¿qué es?');
        html += choice('pz-trash', '🗑️', 'Nada, eliminar', 'No lo necesitas.');
        html += choice('pz-someday', '🌙', 'Algún día / Tal vez', 'Quizá más adelante.');
        html += choice('pz-reference', '📚', 'Referencia', 'Información útil para guardar.');
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

      case 'who':
        html += question('¿Quién debería hacerlo?');
        html += choice('pz-me', '🙋', 'Yo');
        html += choice('pz-delegate', '📨', 'Otra persona', 'Delégalo y espera respuesta.');
        html += backLink();
        break;

      case 'delegate':
        html += question('¿A quién se lo delegas?');
        html +=
          '<form id="pz-delegate-form">' +
          '<input type="text" id="pz-delegate-input" class="field mb-3" placeholder="Nombre de la persona" autocomplete="off" />' +
          '<button type="submit" class="btn-primary w-full">Mover a «A la espera»</button>' +
          '</form>';
        html += backLink();
        break;

      case 'steps':
        html += question('¿Es un solo paso o varios?');
        html += choice('pz-single', '👣', 'Un solo paso');
        html += choice('pz-multi', '🗂️', 'Varios pasos', 'Lo convertimos en proyecto.');
        html += backLink();
        break;

      case 'project':
        html += question('Nuevo proyecto. ¿Cuál es la primera acción física y visible?');
        html +=
          '<form id="pz-project-form">' +
          '<input type="text" id="pz-project-input" class="field mb-3" placeholder="Ej.: llamar a Ana para pedir presupuesto" autocomplete="off" />' +
          '<button type="submit" class="btn-primary w-full">Crear proyecto y su primera acción</button>' +
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
          '<button type="submit" class="btn-primary w-full">Programar</button>' +
          '<button type="button" class="btn-secondary w-full mt-2 gap-2" data-action="pz-gcal">' +
          global.GTD.views.gcalIcon() + '<span>Añadir también a Google Calendar</span>' +
          '</button>' +
          '</form>';
        html += backLink();
        break;

      case 'next':
        html += question('¿Dónde la harás?');
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

    $view.on('click', '[data-action="pz-yes-actionable"]', function () { go('two-minutes'); });
    $view.on('click', '[data-action="pz-no-actionable"]', function () { go('not-actionable'); });

    $view.on('click', '[data-action="pz-back"]', function () {
      var back = {
        'not-actionable': 'actionable',
        'two-minutes': 'actionable',
        'doing-now': 'two-minutes',
        who: 'two-minutes',
        delegate: 'who',
        steps: 'who',
        project: 'steps',
        when: 'steps',
        schedule: 'when',
        next: 'when',
      };
      go(back[step] || 'actionable');
    });

    $view.on('click', '[data-action="pz-trash"]', function () {
      store.removeItem(itemId);
      finishItem('Eliminada. Una cosa menos.');
    });

    $view.on('click', '[data-action="pz-someday"]', function () {
      store.updateItem(itemId, { status: model.STATUS.SOMEDAY });
      finishItem('Guardada en «Algún día»');
    });

    $view.on('click', '[data-action="pz-reference"]', function () {
      store.updateItem(itemId, { status: model.STATUS.REFERENCE });
      finishItem('Guardada como referencia');
    });

    $view.on('click', '[data-action="pz-do-now"]', function () { go('doing-now'); });
    $view.on('click', '[data-action="pz-more-time"]', function () { go('who'); });

    $view.on('click', '[data-action="pz-done"]', function () {
      model.completeItem(itemId);
      finishItem('Hecha ✓ Así de simple.');
    });

    $view.on('click', '[data-action="pz-me"]', function () { go('steps'); });
    $view.on('click', '[data-action="pz-delegate"]', function () { go('delegate'); });

    $view.on('submit', '#pz-delegate-form', function (e) {
      e.preventDefault();
      var who = $('#pz-delegate-input').val().trim();
      if (!who) return;
      store.updateItem(itemId, { status: model.STATUS.WAITING, waitingFor: who });
      finishItem('A la espera de ' + who);
    });

    $view.on('click', '[data-action="pz-single"]', function () { go('when'); });
    $view.on('click', '[data-action="pz-multi"]', function () { go('project'); });

    $view.on('submit', '#pz-project-form', function (e) {
      e.preventDefault();
      var firstAction = $('#pz-project-input').val().trim();
      if (!firstAction) return;
      var item = store.getItem(itemId);
      var project = store.addProject({ name: item.title, outcome: item.notes || '' });
      store.addItem({ title: firstAction, status: model.STATUS.NEXT, projectId: project.id });
      store.removeItem(itemId);
      finishItem('Proyecto creado con su primera acción');
    });

    $view.on('click', '[data-action="pz-has-date"]', function () { go('schedule'); });
    $view.on('click', '[data-action="pz-no-date"]', function () { go('next'); });

    // Open Google Calendar pre-filled with the chosen date, without leaving the wizard.
    $view.on('click', '[data-action="pz-gcal"]', function () {
      var item = store.getItem(itemId);
      var date = $('#pz-schedule-input').val() || model.todayISO();
      if (!item) return;
      global.open(model.gcalUrl({ title: item.title, notes: item.notes, date: date }), '_blank', 'noopener');
    });

    $view.on('submit', '#pz-schedule-form', function (e) {
      e.preventDefault();
      var date = $('#pz-schedule-input').val();
      if (!date) return;
      store.updateItem(itemId, { status: model.STATUS.SCHEDULED, date: date });
      finishItem('Programada para el ' + model.formatDate(date));
    });

    $view.on('click', '[data-action="pz-context"]', function () {
      store.updateItem(itemId, { status: model.STATUS.NEXT, context: $(this).data('context') });
      finishItem('Añadida a próximas acciones');
    });

    $view.on('click', '[data-action="pz-no-context"]', function () {
      store.updateItem(itemId, { status: model.STATUS.NEXT });
      finishItem('Añadida a próximas acciones');
    });
  }

  global.GTD.process = {
    render: render,
    bind: bind,
    reset: function () {
      itemId = null;
      step = 'actionable';
    },
  };
})(window, jQuery);
