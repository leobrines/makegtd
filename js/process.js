/* Clarify wizard: walks the GTD decision tree one question at a time.
   The step order follows the official GTD Workflow Map (docs/gtd/gtd-workflow-map.pdf):
   is it actionable? -> no: trash / incubate (someday or date trigger) / reference
                        (optionally filed as project support material)
                     -> yes: multi-step? -> define the project (desired outcome) and
                        its first action; then decide for the action: do it (<2 min),
                        delegate (waiting for), or defer (calendar or next actions). */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  // actionable | not-actionable | incubate | reference | steps | two-minutes |
  // doing-now | project | project-action | who | delegate | when | schedule | next
  var step = 'actionable';
  var itemId = null;
  // Multi-step path: project and first action being defined, committed at the end.
  var pending = null; // { projectName, projectOutcome, actionTitle }

  // Browser-history integration: every forward step pushes a history entry so the
  // hardware/browser back button (Android) steps back through the wizard exactly
  // like the in-app "Volver atrás" button — both go through history.back().
  var HISTORY_SESSION = 'pz-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  var historyDepth = 0; // wizard entries pushed above the base #/procesar entry
  var stackAlive = false; // false once the user routes away: those entries are stale
  var unwinding = false; // swallow the popstate fired by our own history.go() cleanup

  function currentPath() {
    var hash = global.location.hash.replace(/^#/, '');
    return hash || '/hoy';
  }

  // Forward step: push a history entry tagged with enough context to restore it.
  function go(nextStep) {
    step = nextStep;
    historyDepth += 1;
    stackAlive = true;
    global.history.pushState(
      { pzSession: HISTORY_SESSION, pzItem: itemId, pzStep: nextStep, pzDepth: historyDepth },
      ''
    );
    global.GTD.app.refresh();
  }

  // Fallback back-step used when our history entries are no longer on top
  // (the user routed away mid-wizard and came back via the navigation).
  function stepBack() {
    var back = {
      'not-actionable': 'actionable',
      incubate: 'not-actionable',
      reference: 'not-actionable',
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
    step = step === 'who' ? (pending ? 'project-action' : 'two-minutes') : back[step] || 'actionable';
    global.GTD.app.refresh();
  }

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
    // Drop the wizard's history entries so the back button doesn't replay the
    // steps of an item that no longer exists.
    if (stackAlive && historyDepth > 0) {
      unwinding = true;
      global.history.go(-historyDepth);
    }
    historyDepth = 0;
    stackAlive = false;
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
  // single-step path (Setup Guide p. 8: next actions may be steps of current projects)
  // and on the reference ending (workflow map: Project Support Material).
  function projectSelect(item, label) {
    if (pending) return ''; // Multi-step path: the action belongs to the new project.
    var projects = model.activeProjects();
    if (!projects.length) return '';
    var html =
      '<label class="block mb-3">' +
      '<span class="block text-xs text-stone-400 dark:text-stone-500 mb-1">' + esc(label || '¿Es parte de un proyecto? (opcional)') + '</span>' +
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
      // The inbox item was transformed into the project, not deleted by the
      // user, so it skips the trash (a copy there would be a confusing duplicate).
      store.destroyItem(itemId);
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

    // The item being clarified, always visible and stable at the top. Title and
    // notes stay editable in place: clarifying IS rewriting the raw capture into
    // a concrete next step (Setup Guide p. 2, "Clarify: define actionable things
    // into concrete next steps and successful outcomes").
    html +=
      '<div class="card px-5 py-5 mb-6">' +
      '<div class="flex items-start gap-1">' +
      '<input type="text" id="pz-item-title" class="flex-1 min-w-0 text-xl font-medium bg-transparent outline-none" ' +
      'value="' + esc(item.title) + '" aria-label="Texto capturado" autocomplete="off" />' +
      global.GTD.views.helpIcon('pz-help-rewrite', 'Reescribe para aclarar') +
      '</div>' +
      '<textarea id="pz-item-notes" rows="' + (item.notes ? 3 : 1) + '" ' +
      'class="w-full mt-1 text-sm text-stone-500 dark:text-stone-400 bg-transparent outline-none placeholder-stone-400 dark:placeholder-stone-600" ' +
      'placeholder="Añadir nota (opcional)" aria-label="Notas">' + esc(item.notes) + '</textarea>' +
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
          global.GTD.views.helpIcon('pz-help-actionable', '¿Qué es un accionable?') +
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
        // Reference disabled in Settings: the workflow map's third
        // non-actionable outcome is assumed to live outside the app.
        if (model.referenceEnabled()) {
          html += choice('pz-reference', '📚', 'Referencia', 'Información útil para guardar.');
        }
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

      case 'reference':
        html += question('¿Es material de apoyo de un proyecto?');
        html +=
          '<form id="pz-reference-form">' +
          projectSelect(item, 'Proyecto (opcional)') +
          '<button type="submit" class="btn-primary w-full">Guardar como referencia</button>' +
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
          '<label class="block text-sm text-stone-500 dark:text-stone-400 mb-1" for="pz-schedule-time">Hora (opcional)</label>' +
          '<input type="time" id="pz-schedule-time" class="field mb-3" />' +
          projectSelect(item) +
          '<button type="submit" class="btn-primary w-full">Programar</button>' +
          (model.gcalEnabled()
            ? '<button type="button" class="btn-secondary w-full mt-2 gap-2" data-action="pz-gcal">' +
              global.GTD.views.gcalIcon() + '<span>Añadir también a Google Calendar</span>' +
              '</button>'
            : '') +
          '</form>';
        html += backLink();
        break;

      case 'next':
        // With contexts disabled the only question left is the optional
        // project link (the wizard skips this step entirely when even that
        // has nothing to offer — see the pz-no-date handler).
        if (!model.contextsEnabled()) {
          html += question('¿Es parte de un proyecto?');
          html += projectSelect(item, 'Proyecto (opcional)');
          html += '<button type="button" class="btn-primary w-full" data-action="pz-no-context">Guardar en próximas acciones</button>';
          html += backLink();
          break;
        }
        html +=
          '<div class="flex items-start gap-1 mb-4">' +
          '<p class="text-lg font-medium">' + esc('¿Dónde la harás?') + '</p>' +
          global.GTD.views.helpIcon('help-context', '¿Qué es un contexto?') +
          '</div>';
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

    // Help popup: rewriting the captured text while clarifying.
    function closeRewriteHelp() {
      $('#rewrite-help-overlay').addClass('hidden').attr('aria-hidden', 'true');
    }

    $view.on('click', '[data-action="pz-help-rewrite"]', function () {
      $('#rewrite-help-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    });

    $('#rewrite-help-overlay').on('click', function (e) {
      if (e.target === this) closeRewriteHelp();
    });

    $('#rewrite-help-close, #rewrite-help-ok').on('click', closeRewriteHelp);

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') {
        closeHelp();
        closeRewriteHelp();
      }
    });

    // In-place rewrite of the item being clarified. Persist on change without
    // re-rendering: a refresh here would swallow the click when the blur that
    // fires the change event was caused by tapping a choice button.
    $view.on('change', '#pz-item-title', function () {
      var item = store.getItem(itemId);
      if (!item) return;
      var title = $(this).val().trim();
      if (!title) {
        $(this).val(item.title); // An empty title would lose the capture.
        return;
      }
      if (title !== item.title) {
        store.updateItem(itemId, { title: title });
        global.GTD.app.toast('Guardado');
      }
    });

    $view.on('keydown', '#pz-item-title', function (e) {
      if (e.key === 'Enter') $(this).trigger('blur');
    });

    $view.on('change', '#pz-item-notes', function () {
      var item = store.getItem(itemId);
      if (!item) return;
      var notes = $(this).val();
      if (notes !== item.notes) {
        store.updateItem(itemId, { notes: notes });
        global.GTD.app.toast('Guardado');
      }
    });

    $view.on('click', '[data-action="pz-back"]', function () {
      // Same code path as the hardware back button: pop the history entry and
      // let the popstate handler restore the previous step.
      if (stackAlive && historyDepth > 0) global.history.back();
      else stepBack();
    });

    // Hardware/browser back (and forward) while clarifying: restore the step
    // recorded in the history entry we land on.
    $(global).on('popstate', function (e) {
      if (unwinding) {
        unwinding = false;
        return;
      }
      var state = e.originalEvent.state;
      if (state && state.pzSession === HISTORY_SESSION && itemId && state.pzItem === itemId) {
        step = state.pzStep;
        historyDepth = state.pzDepth;
        stackAlive = true;
        global.GTD.app.refresh();
        return;
      }
      // Popped back onto the base #/procesar entry: show the start of the
      // wizard. Guard on stackAlive because Chrome also fires popstate when a
      // nav link *pushes* #/procesar, and that must keep the current step.
      if (currentPath() === '/procesar' && stackAlive) {
        historyDepth = 0;
        if (step !== 'actionable') {
          step = 'actionable';
          pending = null;
          global.GTD.app.refresh();
        }
      }
    });

    $view.on('click', '[data-action="pz-trash"]', function () {
      store.removeItem(itemId);
      finishItem('A la papelera. Una cosa menos.');
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

    // Reference: if there are active projects, offer to file it as project support
    // material (workflow map); with no projects, save directly without extra friction.
    $view.on('click', '[data-action="pz-reference"]', function () {
      if (!model.activeProjects().length) {
        store.updateItem(itemId, { status: model.STATUS.REFERENCE });
        finishItem('Guardada como referencia');
        return;
      }
      go('reference');
    });

    $view.on('submit', '#pz-reference-form', function (e) {
      e.preventDefault();
      var item = store.getItem(itemId);
      var projectId = selectedProjectId(item);
      store.updateItem(itemId, { status: model.STATUS.REFERENCE, projectId: projectId });
      finishItem(projectId ? 'Guardada como material de apoyo del proyecto' : 'Guardada como referencia');
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
    $view.on('click', '[data-action="pz-no-date"]', function () {
      // Contexts off and no project to offer (multi-step actions already
      // belong to their new project; with no active projects the select is
      // empty): nothing left to ask, save straight to Next Actions.
      if (!model.contextsEnabled() && (pending || !model.activeProjects().length)) {
        var wasProject = !!pending;
        commitAction({ status: model.STATUS.NEXT });
        finishItem(wasProject ? 'Proyecto creado con su primera acción' : 'Añadida a próximas acciones');
        return;
      }
      go('next');
    });

    // Open Google Calendar pre-filled with the chosen date, without leaving the wizard.
    $view.on('click', '[data-action="pz-gcal"]', function () {
      var item = store.getItem(itemId);
      var date = $('#pz-schedule-input').val() || model.todayISO();
      if (!item) return;
      global.open(model.gcalUrl({
        title: pending ? pending.actionTitle : item.title,
        notes: pending ? '' : item.notes,
        date: date,
        time: $('#pz-schedule-time').val() || null,
      }), '_blank', 'noopener');
    });

    $view.on('submit', '#pz-schedule-form', function (e) {
      e.preventDefault();
      var date = $('#pz-schedule-input').val();
      if (!date) return;
      var wasProject = !!pending;
      commitAction({
        status: model.STATUS.SCHEDULED,
        date: date,
        time: $('#pz-schedule-time').val() || null,
      });
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
      historyDepth = 0;
      stackAlive = false;
    },
    // Called by the router when the user leaves #/procesar: the wizard entries
    // are no longer on top of the history stack, so stop popping them.
    onRouteLeave: function () {
      historyDepth = 0;
      stackAlive = false;
    },
  };
})(window, jQuery);
