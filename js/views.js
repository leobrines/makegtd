/* View rendering. All user-facing strings are Spanish; code is English. */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  // Which item row is expanded into its inline editor (progressive disclosure).
  var expandedItemId = null;

  // Which horizon entry the modal editor is open for (null when closed).
  var editingHorizonId = null;

  // Escapes for both element and attribute contexts (quotes included: several
  // templates interpolate into value="…").
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function refresh() {
    global.GTD.app.refresh();
  }

  // A strong random phrase (~79 bits; confusable characters excluded), used for
  // the sync passphrase and the device-vault recovery code.
  function randomPassphrase() {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var bytes = global.crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map
      .call(bytes, function (b, i) {
        return alphabet[b % alphabet.length] + (i % 4 === 3 && i < 15 ? '-' : '');
      })
      .join('');
  }

  function toast(message) {
    global.GTD.app.toast(message);
  }

  // Shows the device-vault recovery code in a copyable dialog. A native alert()
  // renders text that can't be selected or copied on mobile, so the code is put
  // in a read-only field with a "Copiar" button. `opts.title`/`opts.desc` (HTML)
  // override the default enrolment wording (e.g. when changing the code).
  function showRecoveryCode(code, opts) {
    opts = opts || {};
    var $overlay = $('#recovery-code-overlay');
    if (opts.title) $('#recovery-code-title').text(opts.title);
    if (opts.desc) $('#recovery-code-desc').html(opts.desc);
    $('#recovery-code-value').val(code);
    $overlay.removeClass('hidden').attr('aria-hidden', 'false');
  }

  function closeRecoveryCode() {
    $('#recovery-code-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  // ---- Shared building blocks ----

  function header(title, subtitle) {
    return (
      '<header class="mb-6">' +
      '<h1 class="text-2xl font-semibold tracking-tight">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="text-sm text-stone-500 dark:text-stone-400 mt-1">' + esc(subtitle) + '</p>' : '') +
      '</header>'
    );
  }

  function emptyState(emoji, message, ctaLabel, ctaHref) {
    return (
      '<div class="card px-6 py-12 text-center">' +
      '<div class="text-4xl mb-3" aria-hidden="true">' + emoji + '</div>' +
      '<p class="text-stone-500 dark:text-stone-400">' + esc(message) + '</p>' +
      (ctaLabel
        ? '<a href="' + ctaHref + '" class="btn-primary mt-6">' + esc(ctaLabel) + '</a>'
        : '') +
      '</div>'
    );
  }

  function sectionTitle(text, extra) {
    return (
      '<h2 class="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mt-8 mb-2 px-1">' +
      esc(text) + (extra || '') +
      '</h2>'
    );
  }

  // Small "?" button that opens a help dialog (shared by the Clarify wizard and Settings).
  function helpIcon(action, label) {
    return (
      '<button type="button" class="w-11 h-11 -my-2 shrink-0 inline-flex items-center justify-center" ' +
      'data-action="' + action + '" aria-label="' + esc(label) + '" aria-haspopup="dialog">' +
      '<span class="w-5 h-5 rounded-full border border-stone-300 dark:border-stone-600 text-xs font-semibold text-stone-400 dark:text-stone-500 flex items-center justify-center" aria-hidden="true">?</span>' +
      '</button>'
    );
  }

  function itemMeta(item) {
    var bits = [];
    if (item.context && model.contextsEnabled()) bits.push('<span>' + esc(item.context) + '</span>');
    if (item.projectId) {
      var project = store.getProject(item.projectId);
      if (project) bits.push('<span>▸ ' + esc(project.name) + '</span>');
    }
    if (item.status === model.STATUS.SCHEDULED && item.date) {
      var overdue = item.date < model.todayISO();
      bits.push(
        '<span class="' + (overdue ? 'text-red-600 dark:text-red-400' : '') + '">' +
        esc(model.formatDate(item.date)) + (item.time && model.timeFieldEnabled() ? ' · ' + esc(item.time) : '') + '</span>'
      );
    }
    if (item.status === model.STATUS.WAITING && item.waitingFor) {
      bits.push('<span>' + esc(item.waitingFor) + '</span>');
    }
    if (item.status === model.STATUS.SOMEDAY && item.tickleDate) {
      bits.push('<span>Vuelve el ' + esc(model.formatDate(item.tickleDate)) + '</span>');
    }
    if (item.estimate && model.timeEstimates().length) bits.push('<span>⏱ ' + esc(item.estimate) + '</span>');
    if (item.energy && model.energyLevels().length) bits.push('<span>🔋 ' + esc(item.energy) + '</span>');
    if (item.priority && model.priorities().length) bits.push('<span>⚑ ' + esc(item.priority) + '</span>');
    if (!bits.length) return '';
    return '<div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-400 dark:text-stone-500 mt-0.5">' + bits.join('') + '</div>';
  }

  // One list row. Checkbox completes; tapping the body expands the inline editor.
  function itemRow(item, options) {
    options = options || {};
    var checkable = item.status === model.STATUS.NEXT ||
      item.status === model.STATUS.SCHEDULED ||
      item.status === model.STATUS.WAITING ||
      options.checkable;
    var row =
      '<li class="card mb-2 overflow-hidden" data-item-id="' + item.id + '">' +
      '<div class="flex items-center gap-3 px-4 min-h-[52px]">' +
      (checkable
        ? '<button type="button" data-action="complete" data-id="' + item.id + '" aria-label="Completar" ' +
          'class="shrink-0 w-6 h-6 rounded-full border-2 border-stone-300 dark:border-stone-600 hover:border-accent transition-colors duration-150"></button>'
        : '') +
      '<button type="button" data-action="expand" data-id="' + item.id + '" class="flex-1 text-left py-3 min-w-0">' +
      '<span class="block truncate">' + esc(item.title) + '</span>' +
      itemMeta(item) +
      '</button>' +
      (options.trailing || '') +
      '</div>' +
      (expandedItemId === item.id ? itemEditor(item) : '') +
      '</li>';
    return row;
  }

  // Simplified Google Calendar mark, inline (the PWA loads no external assets).
  function gcalIcon() {
    return (
      '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">' +
      '<rect x="8" y="8" width="32" height="32" fill="#fff" stroke="#e0e0e0" stroke-width="1"/>' +
      '<rect x="8" y="8" width="32" height="7" fill="#4285F4"/>' +
      '<rect x="8" y="15" width="7" height="25" fill="#4285F4"/>' +
      '<rect x="33" y="15" width="7" height="19" fill="#FBBC04"/>' +
      '<rect x="15" y="33" width="18" height="7" fill="#34A853"/>' +
      '<path d="M40 34l-7 6h7z" fill="#EA4335"/>' +
      '<text x="24" y="30" font-size="13" font-weight="bold" fill="#4285F4" text-anchor="middle" font-family="sans-serif">31</text>' +
      '</svg>'
    );
  }

  // Anchor that pre-fills the event in Google Calendar (opens a new tab; needs network).
  function gcalLink(item) {
    return (
      '<a href="' + esc(model.gcalUrl(item)) + '" target="_blank" rel="noopener noreferrer" ' +
      'class="btn-ghost shrink-0 gap-2" aria-label="Añadir a Google Calendar">' +
      gcalIcon() +
      '</a>'
    );
  }

  // Status choices for the editor's "Lista" dialog. Reference/Waiting
  // disabled in Settings: hide the choice unless the item already is one.
  function statusChoices(current) {
    var order = ['next', 'scheduled', 'waiting', 'someday', 'reference', 'inbox'];
    return order
      .filter(function (s) {
        if (s === 'reference' && s !== current && !model.referenceEnabled()) return false;
        if (s === 'waiting' && s !== current && !model.waitingEnabled()) return false;
        return true;
      })
      .map(function (s) {
        return { value: s, label: model.STATUS_LABELS[s] };
      });
  }

  // "Agregar …" prompts of the editor rows, per field (also used to restore
  // the prompt when a value is cleared).
  var ATTR_ADD_LABELS = {
    projectId: 'Agregar a un proyecto',
    context: 'Agregar contexto',
    estimate: 'Agregar tiempo estimado',
    energy: 'Agregar nivel de energía',
    priority: 'Agregar prioridad',
  };

  var ATTR_ICONS = {
    status: '📋',
    projectId: '🗂️',
    context: '📍',
    estimate: '⏱',
    energy: '🔋',
    priority: '⚑',
  };

  // One quiet attribute row (Google Tasks-style vertical list): unset shows a
  // muted "Agregar …" prompt, set shows the value plus a clear button; tapping
  // opens a dialog with the choices. The value lives in a hidden field so the
  // save path stays unchanged.
  function attrRow(field, valueLabel, hiddenValue, clearable) {
    var isSet = !!valueLabel;
    return (
      '<div class="flex items-center gap-1">' +
      '<input type="hidden" data-field="' + field + '" value="' + esc(hiddenValue || '') + '" />' +
      '<button type="button" class="flex-1 min-w-0 min-h-[44px] px-1 flex items-center gap-3 text-left" ' +
      'data-action="edit-attr" data-attr="' + field + '" aria-haspopup="dialog">' +
      '<span class="w-5 text-center shrink-0" aria-hidden="true">' + ATTR_ICONS[field] + '</span>' +
      '<span class="truncate' + (isSet ? '' : ' text-stone-400 dark:text-stone-500') + '" data-role="' + field + '-label">' +
      esc(isSet ? valueLabel : ATTR_ADD_LABELS[field]) + '</span>' +
      '</button>' +
      (clearable
        ? '<button type="button" class="btn-ghost shrink-0" data-action="clear-attr" data-attr="' + field + '" aria-label="Quitar"' +
          (isSet ? '' : ' style="display:none"') + '>×</button>'
        : '') +
      '</div>'
    );
  }

  // Date row: same shape, but tapping opens the shared date picker dialog.
  function dateRow(item) {
    var addLabel = model.timeFieldEnabled() ? 'Agregar fecha/hora' : 'Agregar fecha';
    var label = item.date
      ? model.formatDate(item.date) + (item.time && model.timeFieldEnabled() ? ' · ' + item.time : '')
      : '';
    return (
      '<div class="flex items-center gap-1">' +
      '<input type="hidden" data-field="date" value="' + esc(item.date || '') + '" />' +
      (model.timeFieldEnabled() ? '<input type="hidden" data-field="time" value="' + esc(item.time || '') + '" />' : '') +
      '<button type="button" class="flex-1 min-w-0 min-h-[44px] px-1 flex items-center gap-3 text-left" ' +
      'data-action="pick-date" aria-haspopup="dialog">' +
      '<span class="w-5 text-center shrink-0" aria-hidden="true">📅</span>' +
      '<span class="truncate' + (label ? '' : ' text-stone-400 dark:text-stone-500') + '" data-role="date-label">' +
      esc(label || addLabel) + '</span>' +
      '</button>' +
      '<button type="button" class="btn-ghost shrink-0" data-action="clear-date" aria-label="Quitar fecha"' +
      (item.date ? '' : ' style="display:none"') + '>×</button>' +
      '</div>'
    );
  }

  // Notes: free text, so it discloses inline instead of opening a dialog.
  // The textarea keeps data-field="notes" while hidden so save reads it.
  function notesRow(item) {
    return (
      '<button type="button" class="w-full min-h-[44px] px-1 flex items-center gap-3 text-left' +
      (item.notes ? ' hidden' : '') + '" data-action="show-notes">' +
      '<span class="w-5 text-center shrink-0" aria-hidden="true">☰</span>' +
      '<span class="text-stone-400 dark:text-stone-500">Agregar detalles</span>' +
      '</button>' +
      '<textarea class="field' + (item.notes ? '' : ' hidden') + '" rows="2" data-field="notes" ' +
      'placeholder="Detalles" aria-label="Detalles">' + esc(item.notes) + '</textarea>'
    );
  }

  // Inline editor shown under an expanded row. Google Tasks-style: a vertical
  // list of one-line rows, one attribute each; every row opens its own dialog
  // (or reveals its own field), so nothing shows until it is needed.
  function itemEditor(item) {
    var project = item.projectId ? store.getProject(item.projectId) : null;
    var html =
      '<div class="border-t border-stone-100 dark:border-stone-800 px-4 py-4" data-editor-for="' + item.id + '">' +
      '<input type="text" class="field" data-field="title" value="' + esc(item.title) + '" aria-label="Título" />' +
      '<div class="mt-2">';
    html += attrRow('status', model.STATUS_LABELS[item.status], item.status, false);
    html += notesRow(item);
    html += dateRow(item);
    // Rows for optional attributes only exist while their feature is enabled
    // (and, for projects/contexts, while there is something to choose).
    if (model.activeProjects().length || item.projectId) {
      html += attrRow('projectId', project ? project.name : '', item.projectId, true);
    }
    if (model.contextsEnabled() && (store.getContexts().length || item.context)) {
      html += attrRow('context', item.context || '', item.context, true);
    }
    if (model.timeEstimates().length) html += attrRow('estimate', item.estimate || '', item.estimate, true);
    if (model.energyLevels().length) html += attrRow('energy', item.energy || '', item.energy, true);
    if (model.priorities().length) html += attrRow('priority', item.priority || '', item.priority, true);
    html += '</div>';
    html +=
      '<input type="text" class="field mt-2" data-field="waitingFor" value="' + esc(item.waitingFor || '') + '" placeholder="¿De quién esperas respuesta?" aria-label="A la espera de" ' +
      (item.status === model.STATUS.WAITING ? '' : 'style="display:none"') + ' />' +
      '<div class="flex items-center justify-between gap-2 mt-3">' +
      '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="delete" data-id="' + item.id + '">Eliminar</button>' +
      (item.status === model.STATUS.SCHEDULED && item.date && model.gcalEnabled() ? gcalLink(item) : '') +
      '<button type="button" class="btn-primary" data-action="save-item" data-id="' + item.id + '">Guardar</button>' +
      '</div>' +
      '</div>';
    return html;
  }

  function list(items, options) {
    if (!items.length) return '';
    return '<ul>' + items.map(function (item) { return itemRow(item, options); }).join('') + '</ul>';
  }

  // ---- "Ordenar por" (Google Tasks-style sort menu) ----

  // Which list the sort dialog is open for (null when closed).
  var sortMenuFor = null;

  // Options available right now for one list. Criterion entries only exist
  // while their feature is enabled in Settings and has values (the model
  // accessors return [] otherwise); "Fecha" only where items can carry dates.
  function sortOptions(hasDates) {
    var options = [{ key: 'my-order', label: 'Mi orden' }];
    if (hasDates) options.push({ key: 'date', label: 'Fecha' });
    if (model.priorities().length) options.push({ key: 'priority', label: 'Prioridad' });
    if (model.timeEstimates().length) options.push({ key: 'estimate', label: 'Tiempo estimado' });
    if (model.energyLevels().length) options.push({ key: 'energy', label: 'Nivel de energía' });
    options.push({ key: 'title', label: 'Título' });
    return options;
  }

  // The stored preference, unless it points to an option no longer offered
  // (its criterion was disabled or emptied): then fall back to "Mi orden".
  function activeSort(listKey, hasDates) {
    var pref = model.sortPref(listKey);
    var valid = sortOptions(hasDates).some(function (o) { return o.key === pref; });
    return valid ? pref : 'my-order';
  }

  function sortedItems(items, listKey, hasDates) {
    return model.sortItems(items, activeSort(listKey, hasDates));
  }

  // Discreet right-aligned trigger above a list; pointless for lists of one.
  function sortButton(listKey, hasDates, count) {
    if (count < 2) return '';
    var current = activeSort(listKey, hasDates);
    var label = 'Ordenar';
    sortOptions(hasDates).forEach(function (o) {
      if (o.key === current && current !== 'my-order') label = o.label;
    });
    return (
      '<div class="flex justify-end">' +
      '<button type="button" class="btn-ghost text-sm' + (current !== 'my-order' ? ' text-accent dark:text-accent' : '') + '" ' +
      'data-action="open-sort" data-list-key="' + listKey + '" data-has-dates="' + (hasDates ? '1' : '') + '" ' +
      'aria-haspopup="dialog" aria-label="Ordenar por">' +
      '<span aria-hidden="true" class="mr-1.5">↕</span>' + esc(label) +
      '</button>' +
      '</div>'
    );
  }

  function openSortMenu(listKey, hasDates) {
    sortMenuFor = { listKey: listKey, hasDates: hasDates };
    var current = activeSort(listKey, hasDates);
    var html = '<h2 class="font-semibold text-lg tracking-tight mb-2 px-1">Ordenar por</h2>';
    sortOptions(hasDates).forEach(function (o) {
      var active = o.key === current;
      html +=
        '<button type="button" class="w-full min-h-[48px] px-1 flex items-center gap-3 text-left rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors duration-150" ' +
        'data-action="choose-sort" data-sort="' + o.key + '"' + (active ? ' aria-pressed="true"' : '') + '>' +
        '<span class="w-5 text-accent" aria-hidden="true">' + (active ? '✓' : '') + '</span>' +
        '<span' + (active ? ' class="font-medium"' : '') + '>' + esc(o.label) + '</span>' +
        '</button>';
    });
    $('#sort-panel').html(html);
    $('#sort-overlay').removeClass('hidden').attr('aria-hidden', 'false');
  }

  function closeSortMenu() {
    sortMenuFor = null;
    $('#sort-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  // ---- Generic single-choice dialog (Google Tasks-style) ----
  // Used by the editor rows: each attribute opens its own small dialog with
  // just its choices, instead of a wall of always-visible selects.

  // Callback of the open dialog (null when closed).
  var chooserOnPick = null;

  function openChooser(title, options, current, onPick) {
    chooserOnPick = onPick;
    var html = '<h2 class="font-semibold text-lg tracking-tight mb-2 px-1">' + esc(title) + '</h2>';
    options.forEach(function (o) {
      var active = o.value === current;
      html +=
        '<button type="button" class="w-full min-h-[48px] px-1 flex items-center gap-3 text-left rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors duration-150" ' +
        'data-action="choose-option" data-value="' + esc(o.value) + '"' + (active ? ' aria-pressed="true"' : '') + '>' +
        '<span class="w-5 text-accent shrink-0" aria-hidden="true">' + (active ? '✓' : '') + '</span>' +
        '<span class="truncate' + (active ? ' font-medium' : '') + '">' + esc(o.label) + '</span>' +
        '</button>';
    });
    $('#chooser-panel').html(html);
    $('#chooser-overlay').removeClass('hidden').attr('aria-hidden', 'false');
  }

  function closeChooser() {
    chooserOnPick = null;
    $('#chooser-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  // ---- Views ----

  function renderToday() {
    var overdue = model.overdueItems();
    var dueToday = model.dueTodayItems();
    var focus = model.focusItems();
    var html = header('Hoy', model.formatDate(model.todayISO()));

    if (model.reviewIsDue() && (store.getItems().length || store.getProjects().length)) {
      html +=
        '<a href="#/revision" class="card flex items-center gap-3 px-4 py-3 mb-4 hover:border-accent transition-colors duration-150">' +
        '<span aria-hidden="true">🪞</span>' +
        '<span class="text-sm text-stone-600 dark:text-stone-300">Toca hacer la revisión semanal. Solo unos minutos.</span>' +
        '</a>';
    }

    if (overdue.length) {
      html += sectionTitle('Vencidas');
      html += list(overdue);
    }
    if (dueToday.length) {
      html += sectionTitle('Para hoy');
      html += list(dueToday);
    }

    html += sectionTitle(
      'Foco de hoy',
      '<span class="normal-case font-normal tracking-normal"> · máx. ' + model.FOCUS_LIMIT + '</span>'
    );
    if (focus.length) {
      html += '<ul>' + focus.map(function (item) {
        return itemRow(item, {
          checkable: true,
          trailing:
            '<button type="button" class="btn-ghost shrink-0" data-action="add-focus" data-id="' + item.id + '" aria-label="Quitar del foco">−</button>',
        });
      }).join('') + '</ul>';
    } else {
      html +=
        '<div class="card px-5 py-6 text-sm text-stone-500 dark:text-stone-400">' +
        'Elige hasta ' + model.FOCUS_LIMIT + ' tareas para hoy. Menos es más.' +
        '</div>';
    }
    if (focus.length < model.FOCUS_LIMIT && model.nextActions().filter(function (i) { return !i.isFocus; }).length) {
      html += '<button type="button" data-action="show-focus-picker" class="btn-ghost mt-2 text-accent dark:text-accent">+ Elegir del listado de próximas acciones</button>';
      html += '<div id="focus-picker" class="hidden mt-2">' +
        '<ul>' +
        model.nextActions().filter(function (i) { return !i.isFocus; }).map(function (item) {
          return '<li><button type="button" data-action="add-focus" data-id="' + item.id + '" class="btn-choice mb-2">' +
            '<span class="text-accent" aria-hidden="true">＋</span><span class="truncate">' + esc(item.title) + '</span></button></li>';
        }).join('') +
        '</ul></div>';
    }

    var inboxCount = model.inboxItems().length;
    if (!overdue.length && !dueToday.length && !focus.length && !inboxCount) {
      html += '<div class="mt-8">' + emptyState('🌿', 'Nada pendiente por ahora. Respira.', 'Capturar una idea', '#/entrada') + '</div>';
    }
    return html;
  }

  function renderInbox() {
    var items = model.inboxItems();
    var html = header('Bandeja de entrada', 'Suelta aquí todo lo que ocupe tu mente.');
    html +=
      '<form id="inbox-capture" class="card px-3 py-2 mb-6">' +
      '<div class="flex items-center gap-2">' +
      '<input type="text" id="inbox-input" class="flex-1 min-w-0 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="¿Qué tienes en la cabeza?" autocomplete="off" />' +
      helpIcon('help-capture', '¿Qué se captura?') +
      '<button type="submit" class="btn-primary">Capturar</button>' +
      '</div>' +
      '<button type="button" id="inbox-notes-toggle" class="min-h-[44px] px-1 text-sm text-stone-400 dark:text-stone-500 hover:text-accent transition-colors duration-150">+ Añadir nota</button>' +
      '<textarea id="inbox-notes" rows="3" class="hidden w-full px-1 pb-2 text-sm bg-transparent outline-none placeholder-stone-400 dark:placeholder-stone-500" ' +
      'placeholder="Apuntes de una reunión, una idea desarrollada, el texto completo… Se guarda junto con la captura." aria-label="Nota (opcional)"></textarea>' +
      '</form>';
    if (items.length) {
      html +=
        '<div class="flex items-center justify-between mb-2 px-1">' +
        '<span class="text-sm text-stone-500 dark:text-stone-400">' + items.length + ' por procesar</span>' +
        '<a href="#/procesar" class="btn-primary">Procesar</a>' +
        '</div>';
      html += list(items);
    } else {
      html += emptyState('🎉', 'Tu bandeja está vacía. Todo está donde debe.');
    }
    return html;
  }

  function renderNext(filterContext) {
    var items = model.nextActions();
    var contexts = store.getContexts();
    var contextsOn = model.contextsEnabled();
    if (!contextsOn) filterContext = '';
    var html = header(
      'Próximas acciones',
      contextsOn ? 'Una lista, un contexto, una acción.' : 'Una lista, una acción a la vez.'
    );

    if (items.length && contextsOn) {
      html += '<div class="flex flex-wrap gap-2 mb-5">';
      html += '<button type="button" class="chip' + (!filterContext ? ' chip-active' : '') + '" data-action="filter-context" data-context="">Todas</button>';
      contexts.forEach(function (c) {
        var count = items.filter(function (i) { return i.context === c; }).length;
        if (!count) return;
        html += '<button type="button" class="chip' + (filterContext === c ? ' chip-active' : '') + '" data-action="filter-context" data-context="' + esc(c) + '">' + esc(c) + '</button>';
      });
      html += '</div>';
    }

    var visible = filterContext
      ? items.filter(function (i) { return i.context === filterContext; })
      : items;

    if (visible.length) {
      html += sortButton('next', false, visible.length);
      html += list(sortedItems(visible, 'next', false));
    } else if (items.length) {
      html += emptyState('🔍', 'No hay acciones en este contexto.');
    } else {
      html += emptyState('☀️', 'No hay próximas acciones. Procesa tu bandeja o descansa.', 'Ir a la bandeja', '#/entrada');
    }
    return html;
  }

  function renderProjects() {
    var active = model.activeProjects();
    var stalled = model.stalledProjects();
    var html = header('Proyectos', 'Todo lo que requiere más de un paso.');

    html +=
      '<form id="project-form" class="card flex items-center gap-2 px-3 py-2 mb-6">' +
      '<input type="text" id="project-input" class="flex-1 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="Nuevo proyecto…" autocomplete="off" />' +
      '<button type="submit" class="btn-primary">Crear</button>' +
      '</form>';

    if (!active.length) {
      html += emptyState('📁', 'Sin proyectos activos.');
      return html;
    }

    html += '<ul>';
    active.forEach(function (p) {
      var isStalled = stalled.some(function (s) { return s.id === p.id; });
      var count = model.projectItems(p.id).filter(function (i) {
        return i.status !== 'done' && i.status !== model.STATUS.REFERENCE;
      }).length;
      html +=
        '<li class="card mb-2">' +
        '<a href="#/proyectos/' + p.id + '" class="flex items-center gap-3 px-4 min-h-[52px] py-3">' +
        '<span class="flex-1 min-w-0"><span class="block truncate">' + esc(p.name) + '</span>' +
        (isStalled
          ? '<span class="text-xs text-amber-600 dark:text-amber-400">Sin próxima acción — decide el siguiente paso</span>'
          : '<span class="text-xs text-stone-400 dark:text-stone-500">' + count + ' pendiente' + (count === 1 ? '' : 's') + '</span>') +
        '</span>' +
        '<span class="text-stone-300 dark:text-stone-600" aria-hidden="true">›</span>' +
        '</a></li>';
    });
    html += '</ul>';
    return html;
  }

  function renderProjectDetail(projectId) {
    var project = store.getProject(projectId);
    if (!project) return emptyState('🤔', 'Este proyecto ya no existe.', 'Volver a proyectos', '#/proyectos');
    var items = model.projectItems(projectId);
    var support = items.filter(function (i) { return i.status === model.STATUS.REFERENCE; });
    var open = items.filter(function (i) { return i.status !== 'done' && i.status !== model.STATUS.REFERENCE; });
    var done = items.filter(function (i) { return i.status === 'done'; });

    var html =
      '<a href="#/proyectos" class="text-sm text-stone-400 dark:text-stone-500 hover:text-accent transition-colors duration-150">‹ Proyectos</a>' +
      '<header class="mt-2 mb-6">' +
      '<input type="text" id="project-name" class="w-full text-2xl font-semibold tracking-tight bg-transparent outline-none" ' +
      'value="' + esc(project.name) + '" data-project-id="' + project.id + '" aria-label="Nombre del proyecto" />' +
      '<input type="text" id="project-outcome" class="w-full mt-1 text-sm bg-transparent outline-none text-stone-500 dark:text-stone-400 placeholder-stone-400 dark:placeholder-stone-600" ' +
      'placeholder="¿Cómo sabrás que está terminado?" value="' + esc(project.outcome || '') + '" data-project-id="' + project.id + '" />' +
      '</header>';

    if (!model.projectHasNextAction(project.id)) {
      html +=
        '<div class="card px-4 py-3 mb-4 text-sm text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900">' +
        'Este proyecto no tiene próxima acción. ¿Cuál es el siguiente paso físico y visible?' +
        '</div>';
    }

    // The calendar button lets a new action be created already scheduled
    // (one step, like the Google Tasks new-task sheet); the chosen day shows
    // as a removable chip until the action is added.
    html +=
      '<form id="project-item-form" class="card px-3 py-2 mb-6" data-project-id="' + project.id + '">' +
      '<div class="flex items-center gap-2">' +
      '<input type="text" id="project-item-input" class="flex-1 min-w-0 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="Añadir próxima acción…" autocomplete="off" />' +
      '<button type="button" id="project-item-date" class="w-11 h-11 shrink-0 inline-flex items-center justify-center text-lg" aria-label="Programar para un día" aria-haspopup="dialog">📅</button>' +
      '<button type="submit" class="btn-primary">Añadir</button>' +
      '</div>' +
      '<input type="hidden" id="project-item-date-value" />' +
      '<input type="hidden" id="project-item-time-value" />' +
      '<div id="project-item-date-chip" class="hidden items-center gap-1 pb-2">' +
      '<span class="chip" id="project-item-date-label"></span>' +
      '<button type="button" id="project-item-date-clear" class="btn-ghost" aria-label="Quitar fecha">×</button>' +
      '</div>' +
      '</form>';

    // Project steps can mix dated (scheduled) and undated actions, so this
    // list also offers sorting by date; the preference is shared by all projects.
    if (open.length) {
      html += sortButton('project', true, open.length);
      html += list(sortedItems(open, 'project', true));
    } else {
      html += emptyState('✨', 'Nada pendiente en este proyecto.');
    }

    // Project support material (workflow map): reference items filed under this project.
    if (support.length) {
      html += sectionTitle('Material de apoyo');
      html += list(support);
    }

    if (done.length) {
      html += sectionTitle('Hechas');
      html += '<ul>' + done.map(function (i) {
        return '<li class="px-4 py-2 text-sm text-stone-400 dark:text-stone-500 line-through">' + esc(i.title) + '</li>';
      }).join('') + '</ul>';
    }

    html +=
      '<div class="mt-10 flex flex-wrap gap-2">' +
      '<button type="button" class="btn-secondary" data-action="complete-project" data-id="' + project.id + '">Completar proyecto</button>' +
      '<button type="button" class="btn-secondary" data-action="incubate-project" data-id="' + project.id + '">Mover a «Algún día»</button>' +
      '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="delete-project" data-id="' + project.id + '">Eliminar</button>' +
      '</div>';
    return html;
  }

  function renderAgenda() {
    var overdue = model.overdueItems();
    var dueToday = model.dueTodayItems();
    var upcoming = model.upcomingItems();
    var html = header('Agenda', 'Solo lo que tiene fecha. Lo demás vive en tus listas.');

    if (!overdue.length && !dueToday.length && !upcoming.length) {
      return html + emptyState('🗓️', 'Nada en el calendario. El futuro puede esperar.');
    }

    function agendaList(items) {
      var gcalOn = model.gcalEnabled();
      return '<ul>' + items.map(function (item) {
        return itemRow(item, { trailing: gcalOn ? gcalLink(item) : '' });
      }).join('') + '</ul>';
    }

    if (overdue.length) {
      html += sectionTitle('Vencidas');
      html += agendaList(overdue);
    }
    if (dueToday.length) {
      html += sectionTitle('Hoy');
      html += agendaList(dueToday);
    }
    if (upcoming.length) {
      html += sectionTitle('Próximamente');
      html += agendaList(upcoming);
    }
    return html;
  }

  function renderWaiting() {
    var items = model.waitingItems();
    var html = header('A la espera', 'Cosas delegadas o pendientes de otras personas.');
    if (!items.length) return html + emptyState('📮', 'No esperas nada de nadie ahora mismo.');
    html += sortButton('waiting', false, items.length);
    html += list(sortedItems(items, 'waiting', false));
    return html;
  }

  function renderSomeday() {
    var items = model.somedayItems();
    var projects = model.somedayProjects();
    var html = header('Algún día / Tal vez', 'Ideas incubando, sin compromiso.');
    if (!items.length && !projects.length) {
      return html + emptyState('🌙', 'Nada incubando. Las ideas nuevas pueden esperar aquí.');
    }
    if (items.length) {
      html += sortButton('someday', false, items.length);
      html += '<ul>' + sortedItems(items, 'someday', false).map(function (item) {
        return itemRow(item, {
          trailing:
            '<button type="button" class="btn-ghost text-accent shrink-0" data-action="activate" data-id="' + item.id + '">Activar</button>',
        });
      }).join('') + '</ul>';
    }
    if (projects.length) {
      html += sectionTitle('Proyectos incubando');
      html += '<ul>' + projects.map(function (p) {
        return (
          '<li class="card mb-2 flex items-center gap-3 px-4 min-h-[52px]">' +
          '<span class="flex-1 truncate">' + esc(p.name) + '</span>' +
          '<button type="button" class="btn-ghost text-accent shrink-0" data-action="activate-project" data-id="' + p.id + '">Activar</button>' +
          '</li>'
        );
      }).join('') + '</ul>';
    }
    return html;
  }

  // Higher horizons of focus (2-5). Ground and Horizon 1 live in their own
  // views (actions/agenda and projects); here each higher level is a simple
  // editable list, per the official "Levels of Your Work" altitude map.
  // Tapping an entry opens the shared modal editor (#horizon-editor-overlay)
  // for its title and note.
  function horizonRow(entry) {
    return (
      '<li class="card mb-2 overflow-hidden" data-horizon-id="' + entry.id + '">' +
      '<button type="button" data-action="edit-horizon" data-id="' + entry.id + '" aria-haspopup="dialog" class="w-full text-left px-4 py-3 min-h-[52px]">' +
      '<span class="block truncate">' + esc(entry.text) + '</span>' +
      (entry.note
        ? '<span class="block truncate text-xs text-stone-400 dark:text-stone-500 mt-0.5">' + esc(entry.note) + '</span>'
        : '') +
      '</button>' +
      '</li>'
    );
  }

  function closeHorizonEditor() {
    editingHorizonId = null;
    $('#horizon-editor-overlay').addClass('hidden').attr('aria-hidden', 'true');
  }

  function renderHorizons() {
    var html = header(
      'Horizontes',
      'La perspectiva por encima de tus proyectos. Las prioridades bajan de arriba hacia abajo: el propósito alimenta la visión, la visión las metas, y las metas tus áreas y proyectos.'
    );
    model.HORIZONS.forEach(function (h) {
      var entries = model.horizonItems(h.level);
      html += sectionTitle(
        'Horizonte ' + h.level + ' · ' + h.title,
        helpIcon(h.helpAction, h.helpLabel)
      );
      html += '<p class="text-xs text-stone-400 dark:text-stone-500 mb-2 px-1">' + esc(h.description) + '</p>';
      if (entries.length) {
        html += '<ul>' + entries.map(horizonRow).join('') + '</ul>';
      }
      html +=
        '<form class="horizon-form card flex items-center gap-2 px-3 py-2" data-level="' + h.level + '">' +
        '<input type="text" class="horizon-input flex-1 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" ' +
        'placeholder="' + esc(h.placeholder) + '" autocomplete="off" aria-label="Añadir a ' + esc(h.title) + '" />' +
        '<button type="submit" class="btn-secondary">Añadir</button>' +
        '</form>';
    });
    return html;
  }

  // ---- AI section ----
  // Ready-to-copy prompts to review parts of the system with any external AI.
  // The app never talks to an AI service: the user copies the text and pastes
  // it wherever they choose, so the PWA stays fully offline.

  // Prompt asking an AI to review the user's higher horizons (levels 2-5).
  // The per-level rules embedded in the text come from the official documents
  // "Levels of Your Work" and "The 6 Horizons of Focus" (docs/gtd/README.md),
  // so the AI grounds its review in the canonical sources rather than lore.
  function buildHorizonsReviewPrompt() {
    var lines = [
      'Actúa como un coach experto en GTD® (Getting Things Done, de David Allen).',
      '',
      'Revisa mis horizontes de enfoque (niveles 2–5). Básate exclusivamente en las fuentes oficiales de la David Allen Company — «Levels of Your Work®» y el artículo «The 6 Horizons of Focus®» (gettingthingsdone.com) — y señala cualquier cosa que las contradiga.',
      '',
      'Reglas oficiales que debes aplicar:',
      '- Las prioridades fluyen de arriba hacia abajo: el propósito y los principios (H5) guían la visión (H4), la visión crea metas y objetivos (H3), las metas encuadran las áreas de enfoque (H2), y de todo ello nacen los proyectos (H1) y las acciones.',
      '- Horizonte 5 · Propósito y principios: por qué haces lo que haces y los estándares de conducta innegociables.',
      '- Horizonte 4 · Visión: cómo se verá, sonará y sentirá el éxito a largo plazo (3–5 años).',
      '- Horizonte 3 · Metas y objetivos: qué quieres y necesitas lograr en los próximos 12–24 meses.',
      '- Horizonte 2 · Áreas de enfoque y responsabilidad: esferas de trabajo y vida que se mantienen, no se terminan; lo habitual es tener entre cuatro y siete; un resultado con final es un proyecto (H1), no un área.',
      '',
      'Para cada entrada dime:',
      '1. Si está en el horizonte correcto y, si no, a cuál moverla.',
      '2. Si está bien formulada para su nivel; propón una redacción mejor cuando aplique.',
      '3. Qué falta o sobra en cada nivel: huecos, solapamientos, áreas sin metas, metas que no apuntan a la visión…',
      '',
      'Termina con un resumen de los 3 cambios más importantes. Si te falta contexto, pregúntame antes de asumir.',
      '',
      'Mis horizontes:',
    ];
    model.HORIZONS.forEach(function (h) {
      lines.push('');
      lines.push('## Horizonte ' + h.level + ' · ' + h.title);
      var entries = model.horizonItems(h.level);
      if (!entries.length) {
        lines.push('(sin entradas todavía)');
        return;
      }
      entries.forEach(function (entry) {
        lines.push('- ' + entry.text);
        if (entry.note) lines.push('  Nota: ' + entry.note.replace(/\n/g, '\n  '));
      });
    });
    return lines.join('\n');
  }

  // One copyable prompt: title + explanation, the copy button, and the full
  // text behind a collapsed <details> (progressive disclosure).
  function aiPromptCard(opts) {
    return (
      '<div class="card px-4 py-4 mb-2">' +
      '<h3 class="font-medium">' + esc(opts.title) + '</h3>' +
      '<p class="text-sm text-stone-500 dark:text-stone-400 mt-1">' + esc(opts.description) + '</p>' +
      '<div class="mt-3">' +
      '<button type="button" class="btn-primary" data-action="copy-ai-prompt" data-prompt="' + esc(opts.key) + '">Copiar prompt</button>' +
      '</div>' +
      '<details class="text-sm mt-2">' +
      '<summary class="cursor-pointer min-h-[44px] flex items-center text-accent">Ver el prompt completo</summary>' +
      '<pre class="whitespace-pre-wrap font-sans text-xs text-stone-500 dark:text-stone-400 border-t border-stone-100 dark:border-stone-800 pt-3">' + esc(opts.text) + '</pre>' +
      '</details>' +
      '</div>'
    );
  }

  function renderAI() {
    var html = header(
      'IA',
      'Prompts listos para copiar y pegar en la IA que prefieras. La app no envía nada a ningún servicio: tú copias y tú decides.'
    );
    if (!model.horizonsEnabled()) {
      return html + emptyState(
        '✨',
        'El primer prompt trabaja sobre tus Horizontes, que ahora están desactivados.',
        'Activarlos en Ajustes',
        '#/ajustes'
      );
    }
    var hasEntries = model.HORIZONS.some(function (h) {
      return model.horizonItems(h.level).length > 0;
    });
    if (!hasEntries) {
      return html + emptyState(
        '🧭',
        'Define primero tus horizontes: el prompt los incluye con su título y sus notas.',
        'Ir a Horizontes',
        '#/horizontes'
      );
    }
    html += sectionTitle('Revisar tu sistema');
    html += aiPromptCard({
      key: 'horizons-review',
      title: 'Revisar mis horizontes',
      description:
        'Copia todos tus horizontes (título y notas) junto con las reglas oficiales de GTD, ' +
        'y pídele a una IA que revise si cada entrada está en el nivel correcto y qué deberías mejorar.',
      text: buildHorizonsReviewPrompt(),
    });
    return html;
  }

  function renderReference() {
    var items = model.referenceItems();
    var html = header('Referencia', 'Material útil que no requiere acción.');
    if (!items.length) return html + emptyState('📚', 'Sin material de referencia todavía.');
    html += sortButton('reference', false, items.length);
    html += list(sortedItems(items, 'reference', false));
    return html;
  }

  function renderTrash() {
    var items = model.trashedItems();
    var projects = model.trashedProjects();
    var horizons = model.trashedHorizons();
    var html = header('Papelera', 'Lo que eliminas espera aquí. Solo al vaciarla desaparece de verdad.');

    if (!items.length && !projects.length && !horizons.length) {
      return html + emptyState('🗑️', 'La papelera está vacía.');
    }

    function deletedMeta(noun, deletedAt) {
      var when = model.relativeDays((deletedAt || '').slice(0, 10));
      return (
        '<span class="text-xs text-stone-400 dark:text-stone-500">' +
        esc(noun) + (when ? ' · ' + esc(when) : '') +
        '</span>'
      );
    }

    if (items.length) {
      html += sectionTitle('Tareas');
      html += '<ul>' + items.map(function (item) {
        return (
          '<li class="card mb-2 flex items-center gap-3 px-4 min-h-[52px] py-3">' +
          '<span class="flex-1 min-w-0"><span class="block truncate">' + esc(item.title) + '</span>' +
          deletedMeta(model.STATUS_LABELS[item.status] || 'Tarea', item.deletedAt) +
          '</span>' +
          '<button type="button" class="btn-ghost text-accent shrink-0" data-action="restore-item" data-id="' + item.id + '">Restaurar</button>' +
          '</li>'
        );
      }).join('') + '</ul>';
    }

    if (projects.length) {
      html += sectionTitle('Proyectos');
      html += '<ul>' + projects.map(function (p) {
        return (
          '<li class="card mb-2 flex items-center gap-3 px-4 min-h-[52px] py-3">' +
          '<span class="flex-1 min-w-0"><span class="block truncate">' + esc(p.name) + '</span>' +
          deletedMeta('Proyecto · sus tareas se reconectan al restaurarlo', p.deletedAt) +
          '</span>' +
          '<button type="button" class="btn-ghost text-accent shrink-0" data-action="restore-project" data-id="' + p.id + '">Restaurar</button>' +
          '</li>'
        );
      }).join('') + '</ul>';
    }

    if (horizons.length) {
      html += sectionTitle('Horizontes');
      html += '<ul>' + horizons.map(function (h) {
        var meta = model.horizonMeta(h.level);
        return (
          '<li class="card mb-2 flex items-center gap-3 px-4 min-h-[52px] py-3">' +
          '<span class="flex-1 min-w-0"><span class="block truncate">' + esc(h.text) + '</span>' +
          deletedMeta(meta ? 'Horizonte ' + h.level + ' · ' + meta.title : 'Horizonte', h.deletedAt) +
          '</span>' +
          '<button type="button" class="btn-ghost text-accent shrink-0" data-action="restore-horizon" data-id="' + h.id + '">Restaurar</button>' +
          '</li>'
        );
      }).join('') + '</ul>';
    }

    html += '<div class="mt-10">';
    html += '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="empty-trash">Vaciar papelera…</button>';
    html += '</div>';
    return html;
  }

  // One settings on/off row: title + short explanation + checkbox.
  function toggleRow(id, title, hint, checked, extraClass) {
    return (
      '<label class="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer' + (extraClass || '') + '">' +
      '<span class="min-w-0">' +
      '<span class="block">' + esc(title) + '</span>' +
      '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5">' + esc(hint) + '</span>' +
      '</span>' +
      '<input type="checkbox" id="' + id + '" class="w-6 h-6 shrink-0 accent-accent"' + (checked ? ' checked' : '') + ' />' +
      '</label>'
    );
  }

  // One big tappable option (same visual language as the Clarify wizard
  // choices). attrs is a pre-built string of data-* attributes.
  function choiceButton(attrs, icon, label, hint) {
    return (
      '<button type="button" class="btn-choice" ' + attrs + '>' +
      '<span class="text-xl w-7 text-center shrink-0" aria-hidden="true">' + icon + '</span>' +
      '<span class="min-w-0"><span class="block">' + esc(label) + '</span>' +
      (hint ? '<span class="block text-xs font-normal text-stone-400 dark:text-stone-500">' + esc(hint) + '</span>' : '') +
      '</span></button>'
    );
  }

  // Editable value list for one Engage criterion (mirrors the contexts
  // editor, on/off toggle included: turning a criterion off hides the field
  // across the app but keeps its values, so nothing needs to be deleted).
  function criterionEditor(key, title, placeholder) {
    var enabled = model.criterionEnabled(key);
    var values = store.getCriterionValues(key);
    var html = '<div class="card px-4 py-4 mb-2">';
    html += toggleRow(
      'criterion-toggle-' + key,
      title,
      'Si lo desactivas, el campo desaparece de las tareas. Sus valores se conservan.',
      enabled,
      enabled ? ' pb-3 mb-3 border-b border-stone-100 dark:border-stone-800' : ''
    );
    if (!enabled) return html + '</div>';
    if (values.length) {
      html += '<ul class="mb-3">' + values.map(function (v) {
        return (
          '<li class="flex items-center justify-between min-h-[44px] border-b border-stone-100 dark:border-stone-800 last:border-0">' +
          '<span>' + esc(v) + '</span>' +
          '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="remove-criterion-value" data-criterion="' + key + '" data-value="' + esc(v) + '" aria-label="Eliminar ' + esc(v) + '">×</button>' +
          '</li>'
        );
      }).join('') + '</ul>';
    } else {
      html += '<p class="text-xs text-stone-400 dark:text-stone-500 mb-3">Sin valores: este campo no se muestra en las tareas.</p>';
    }
    html +=
      '<form class="criterion-form flex gap-2" data-criterion="' + key + '">' +
      '<input type="text" class="field flex-1 criterion-input" placeholder="' + esc(placeholder) + '" autocomplete="off" />' +
      '<button type="submit" class="btn-secondary">Añadir</button>' +
      '</form>';
    return html + '</div>';
  }

  function renderSettings() {
    var contexts = store.getContexts();
    var contextsOn = model.contextsEnabled();
    var html = header('Ajustes');

    html += sectionTitle('Contextos', helpIcon('help-context', '¿Qué es un contexto?'));
    html += '<div class="card px-4 py-4">';
    html += toggleRow(
      'contexts-enabled-toggle',
      'Usar contextos',
      'Si los desactivas, desaparecen de toda la app y verás una única lista de próximas acciones.',
      contextsOn,
      contextsOn ? ' pb-3 mb-3 border-b border-stone-100 dark:border-stone-800' : ''
    );
    if (contextsOn) {
      html += '<ul class="mb-3">' + contexts.map(function (c) {
        return (
          '<li class="flex items-center justify-between min-h-[44px] border-b border-stone-100 dark:border-stone-800 last:border-0">' +
          '<span>' + esc(c) + '</span>' +
          '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="remove-context" data-context="' + esc(c) + '" aria-label="Eliminar ' + esc(c) + '">×</button>' +
          '</li>'
        );
      }).join('') + '</ul>';
      html +=
        '<form id="context-form" class="flex gap-2">' +
        '<input type="text" id="context-input" class="field flex-1" placeholder="@nuevo-contexto" autocomplete="off" />' +
        '<button type="submit" class="btn-secondary">Añadir</button>' +
        '</form>';
    }
    html += '</div>';

    html += sectionTitle('Criterios para elegir qué hacer');
    html +=
      '<p class="text-xs text-stone-400 dark:text-stone-500 mb-2 px-1">' +
      'Tiempo, energía y prioridad ayudan a elegir la siguiente acción (junto al contexto). ' +
      'Personaliza los valores o desactiva los campos que no uses; lo guardado se conserva.' +
      '</p>';
    html += criterionEditor('timeEstimates', 'Tiempo estimado', 'Ej.: 45 min');
    html += criterionEditor('energyLevels', 'Nivel de energía', 'Ej.: Muy baja');
    html += criterionEditor('priorities', 'Prioridad', 'Ej.: Urgente');

    html += sectionTitle('Revisión semanal');
    html += '<div class="card px-4 py-4">';
    html +=
      '<label class="block">' +
      '<span class="block">Día preferido de revisión</span>' +
      '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5 mb-2">El recordatorio aparecerá ese día de la semana y hasta que completes la revisión.</span>' +
      '<select id="review-day-select" class="field">';
    var reviewDay = model.reviewDay();
    var dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    html += '<option value=""' + (reviewDay === null ? ' selected' : '') + '>Sin día fijo (cada 7 días)</option>';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      html += '<option value="' + d + '"' + (reviewDay === d ? ' selected' : '') + '>' +
        dayNames[d].charAt(0).toUpperCase() + dayNames[d].slice(1) + '</option>';
    });
    html += '</select></label></div>';

    html += sectionTitle('Funciones');
    html += '<div class="card px-4 py-4 divide-y divide-stone-100 dark:divide-stone-800">';
    html += toggleRow(
      'reference-enabled-toggle',
      'Lista de referencia',
      'Si la desactivas, desaparecen la lista y la opción «Referencia» al procesar. Lo guardado se conserva.',
      model.referenceEnabled()
    );
    html += toggleRow(
      'waiting-enabled-toggle',
      'Lista «A la espera»',
      'Si la desactivas, desaparecen la lista y la opción de delegar al procesar. Lo guardado se conserva y sigue apareciendo en la revisión semanal.',
      model.waitingEnabled()
    );
    html += toggleRow(
      'horizons-enabled-toggle',
      'Horizontes',
      'La perspectiva por encima de tus proyectos (áreas, metas, visión, propósito). Si aún no la usas, ocúltala; lo guardado se conserva.',
      model.horizonsEnabled()
    );
    html += toggleRow(
      'gcal-enabled-toggle',
      'Botones de Google Calendar',
      'Muestra u oculta los botones para añadir tareas con fecha a Google Calendar.',
      model.gcalEnabled()
    );
    html += toggleRow(
      'time-field-enabled-toggle',
      'Campo de hora',
      'Si lo desactivas, las tareas con fecha solo piden el día. Las horas guardadas se conservan.',
      model.timeFieldEnabled()
    );
    html += toggleRow(
      'capture-shortcut-toggle',
      'Tecla rápida de captura (n)',
      'Pulsa «n» en cualquier vista para capturar. El botón «+» funciona siempre.',
      model.captureShortcutEnabled()
    );
    html += '</div>';

    html += sectionTitle('Seguridad del dispositivo');
    html += '<div class="card px-4 py-4 space-y-3">';
    var vault = global.GTD.vault;
    if (!vault || !vault.available()) {
      html +=
        '<p class="text-sm text-stone-500 dark:text-stone-400">' +
        'Este navegador no admite el cifrado en reposo. Usa un navegador moderno para proteger tus datos.' +
        '</p>';
    } else if (!vault.isEnrolled()) {
      html +=
        '<p class="text-sm text-stone-500 dark:text-stone-400">' +
        'Cifra <strong>todos</strong> tus datos en este dispositivo (tareas, proyectos y las claves de ' +
        'sincronización) con una clave que solo se libera tras tu huella o Face ID. Sin activarlo, tus ' +
        'datos se guardan sin cifrar y podrían leerse si pierdes el dispositivo o desde otra app.' +
        '</p>';
      html +=
        '<p class="text-xs text-stone-400 dark:text-stone-500">' +
        'Al activarlo se genera un <strong>código de recuperación</strong>: guárdalo en tu gestor de ' +
        'contraseñas. Es la única forma de recuperar tus datos si pierdes o restableces la biometría ' +
        '(también puedes exportar una copia sin cifrar en «Tus datos»).' +
        '</p>';
      html += '<button type="button" class="btn-primary" data-action="vault-enroll">Activar protección del dispositivo</button>';
    } else {
      html +=
        '<p class="text-sm text-stone-500 dark:text-stone-400">' +
        'Protección activada: tus datos se cifran en este dispositivo. ' +
        (vault.hasBiometric()
          ? 'Se desbloquea con tu biometría (o con el código de recuperación).'
          : 'Se desbloquea con tu código de recuperación.') +
        '</p>';
      html += '<div class="flex flex-wrap gap-2">';
      if (!vault.hasBiometric()) {
        html += '<button type="button" class="btn-secondary" data-action="vault-add-biometric">Añadir desbloqueo por biometría</button>';
      }
      html += '<button type="button" class="btn-secondary" data-action="vault-change-recovery">Cambiar código de recuperación</button>';
      html += '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="vault-disable">Desactivar protección…</button>';
      html += '</div>';
    }
    html += '</div>';

    html += sectionTitle('Copia de seguridad y sincronización');
    html += '<div class="card px-4 py-4 space-y-3">';
    var syncStatus = global.GTD.syncer.status();
    if (syncStatus.configured) {
      // One block per connected backend; both can be active at once and the
      // deterministic merge keeps them convergent (a device connected to
      // both bridges devices that only use one). Status first, actions next,
      // the long explanations behind a collapsed details (minimal noise).
      syncStatus.backends.forEach(function (b) {
        var lastText = b.lastSyncAt
          ? 'Última sincronización: ' + model.formatDate(b.lastSyncAt) + '.'
          : 'Aún sin sincronizar.';
        html += '<div class="space-y-2 pb-3 border-b border-stone-100 dark:border-stone-800">';
        if (b.provider === 'gdrive') {
          html += '<p class="font-medium">Google Drive <span class="font-normal text-xs text-stone-400 dark:text-stone-500">· conectado ✓</span></p>';
          html += '<p class="text-xs text-stone-400 dark:text-stone-500">' + esc(lastText) + '</p>';
          // The Client ID is not a secret (it travels in the OAuth URL);
          // surfacing it here feeds the wizard's «Sí, ya lo tengo» shortcut on
          // the next device — only the passphrase must be retyped there.
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            '¿Otro dispositivo? Abre allí «Conectar Google Drive», elige «Sí, ya lo tengo» y pega este ID ' +
            '(te pedirá también tu frase de cifrado). ' +
            '<button type="button" class="btn-ghost" data-action="copy-value" data-value="' + esc(b.clientId || '') + '">Copiar ID</button>' +
            '</p>';
          html +=
            '<details class="text-sm">' +
            '<summary class="cursor-pointer min-h-[44px] flex items-center text-accent">Más detalles</summary>' +
            '<div class="space-y-2 pb-2">' +
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Tus datos se suben cifrados a la carpeta de datos de aplicaciones de tu Google Drive ' +
            '(<code>appDataFolder</code>), que no aparece entre tus archivos. Cada dispositivo guarda ' +
            'ahí su propio archivo; el de este es <code class="break-all">' + esc(syncStatus.fileName) + '</code>. ' +
            'Puedes ver el espacio que ocupa o borrarla en «Gestionar aplicaciones», dentro de ' +
            '<a href="https://drive.google.com/drive/settings" target="_blank" rel="noopener" class="text-accent underline">los ajustes de Google Drive en la web</a>. ' +
            'La app móvil de Drive no tiene esa opción: abre el enlace en un navegador (si no aparece, ' +
            'activa «Versión para ordenador»).' +
            '</p>' +
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Si tu proyecto de Google sigue en modo «Testing», te pedirá autorizar de nuevo cada 7 días; ' +
            'publícalo en producción para evitarlo.' +
            '</p>' +
            '</div></details>';
        } else {
          html += '<p class="font-medium">Servidor propio <span class="font-normal text-xs text-stone-400 dark:text-stone-500">· conectado ✓</span></p>';
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            '<code class="break-all">' + esc(b.serverUrl || '') + '</code> · ' + esc(lastText) +
            '</p>';
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            '¿Otro dispositivo? Descarga el archivo de llave e impórtalo allí en «Conectar servidor propio»: ' +
            'lo configura todo sin teclear nada.' +
            '</p>';
          html +=
            '<details class="text-sm">' +
            '<summary class="cursor-pointer min-h-[44px] flex items-center text-accent">Más detalles</summary>' +
            '<div class="space-y-2 pb-2">' +
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Cada dispositivo guarda su propio archivo cifrado en el servidor; el de este es ' +
            '<code class="break-all">' + esc(syncStatus.fileName) + '</code>. ' +
            'El archivo de llave (protegido con la contraseña que elijas al descargarlo) contiene la ' +
            'dirección del servidor, la clave de acceso y tu frase de cifrado.' +
            '</p>' +
            '</div></details>';
        }
        html += '<div class="flex flex-wrap gap-2">';
        if (b.provider === 'server') {
          html += '<button type="button" class="btn-secondary" data-action="sync-export-key">Descargar archivo de llave…</button>';
        }
        html +=
          '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="sync-remove-backend" data-provider="' +
          b.provider + '">Quitar este destino…</button>';
        html += '</div></div>';
      });
      html += '<div class="flex flex-wrap gap-2">';
      html += '<button type="button" class="btn-secondary" data-action="sync-now">Sincronizar ahora</button>';
      // A second, redundant destination: same encrypted files everywhere.
      if (!syncStatus.hasGdrive) {
        html += '<button type="button" class="btn-ghost" data-action="sync-setup" data-provider="gdrive">Añadir Google Drive</button>';
      }
      if (!syncStatus.hasServer) {
        html += '<button type="button" class="btn-ghost" data-action="sync-setup" data-provider="server">Añadir servidor propio</button>';
      }
      html += '</div>';
    } else {
      html +=
        '<p class="text-sm text-stone-500 dark:text-stone-400">' +
        'Opcional: guarda una copia de seguridad cifrada fuera de este dispositivo y ten lo mismo en tu ' +
        'móvil, portátil u otros dispositivos. Tus datos se cifran aquí antes de subirse: el destino nunca ' +
        'puede leerlos.' +
        '</p>';
      html += choiceButton('data-action="sync-setup" data-provider="gdrive"', '☁️', 'Conectar Google Drive', 'Con tu cuenta de Google. Te guía paso a paso.');
      html += choiceButton('data-action="sync-setup" data-provider="server"', '🖥️', 'Conectar servidor propio', 'Con un servidor tuyo (opción avanzada).');
    }
    html += '</div>';

    html += sectionTitle('Tus datos');
    html += '<div class="card px-4 py-4 space-y-3">';
    html += '<p class="text-sm text-stone-500 dark:text-stone-400">Todo se guarda solo en este dispositivo. Exporta una copia de vez en cuando.</p>';
    html += '<div class="flex flex-wrap gap-2">';
    html += '<button type="button" class="btn-secondary" data-action="export-data">Exportar copia (JSON)</button>';
    html += '<label class="btn-secondary cursor-pointer">Importar copia<input type="file" id="import-file" accept="application/json,.json" class="hidden" /></label>';
    html += '</div></div>';

    html += sectionTitle('Zona de peligro');
    html += '<div class="card px-4 py-4 border-red-100 dark:border-red-950">';
    html += '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="clear-all">Borrar todos los datos…</button>';
    html += '</div>';

    var reviewDays = model.daysSinceReview();
    html += '<p class="text-xs text-stone-400 dark:text-stone-600 mt-8 px-1">makeGTD · ' +
      (reviewDays === null ? 'Aún sin revisión semanal' : 'Última revisión hace ' + reviewDays + ' día' + (reviewDays === 1 ? '' : 's')) +
      '</p>';
    return html;
  }

  // ---- Sync setup wizard (modal, one step at a time) ----

  // The wizard connects one backup destination through small screens with a
  // single decision or action each (ADHD principle: one decision at a time).
  // Null while closed. Values typed on earlier steps live here so moving back
  // and forward never loses them. path records the branch chosen on the first
  // screen: 'have-id' | 'guide' (Google Drive), 'manual' | 'keyfile' (server).
  var syncWizard = null; // { provider, step, path, clientId, serverUrl, serverKey, passphrase, passFromFile }

  // Browser-history integration (see js/process.js for the reference
  // pattern): opening the wizard and every forward step push a history entry,
  // so the hardware/browser back button undoes exactly one step — and closes
  // the modal from the first one — instead of leaving the Settings view.
  var SYNC_WIZARD_SESSION = 'sw-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  var syncWizardDepth = 0; // wizard entries pushed above the base #/ajustes entry
  var syncWizardUnwinding = false; // swallow the popstate fired by our own history.go() cleanup

  // Ordered step list for the current provider and chosen path. The
  // passphrase step only exists while no backend is configured yet: adding a
  // second destination reuses the stored passphrase (the encrypted files must
  // be identical on every backend). A key file may carry the passphrase too.
  function syncWizardSteps() {
    var fresh = !global.GTD.syncer.status().configured;
    var steps = ['start'];
    if (syncWizard.provider === 'gdrive') {
      if (syncWizard.path === 'guide') steps = steps.concat(['g-project', 'g-api', 'g-register', 'g-client', 'g-publish']);
      steps.push('client-id');
      if (fresh) steps.push('passphrase');
    } else {
      if (syncWizard.path === 'manual') steps.push('server-data');
      if (fresh && !(syncWizard.path === 'keyfile' && syncWizard.passFromFile)) steps.push('passphrase');
    }
    steps.push('connect');
    return steps;
  }

  function openSyncWizard(provider) {
    syncWizard = { provider: provider, step: 'start', path: null, clientId: '', clientSecret: '', serverUrl: '', serverKey: '', passphrase: '', passFromFile: false };
    syncWizardDepth = 1;
    global.history.pushState({ swSession: SYNC_WIZARD_SESSION, swStep: 'start', swPath: null, swDepth: 1 }, '');
    $('#sync-wizard-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    renderSyncWizard();
  }

  // Forward step: push a history entry tagged with enough context to restore it.
  function syncWizardGo(step) {
    syncWizard.step = step;
    syncWizardDepth += 1;
    global.history.pushState(
      { swSession: SYNC_WIZARD_SESSION, swStep: step, swPath: syncWizard.path, swDepth: syncWizardDepth },
      ''
    );
    renderSyncWizard();
  }

  // viaHistory: the wizard's entries were already popped by the hardware back
  // button, so there is nothing left to unwind.
  function closeSyncWizard(viaHistory) {
    if (!syncWizard) return;
    syncWizard = null;
    $('#sync-wizard-overlay').addClass('hidden').attr('aria-hidden', 'true');
    if (!viaHistory && syncWizardDepth > 0) {
      syncWizardUnwinding = true;
      global.history.go(-syncWizardDepth);
    }
    syncWizardDepth = 0;
  }

  // Last wizard step: persist the config and run the first sync (on Google
  // Drive it triggers the OAuth consent redirect).
  function finishSyncWizard() {
    var gdrive = syncWizard.provider === 'gdrive';
    var ok = gdrive
      ? global.GTD.syncer.setGdriveConfig(syncWizard.clientId, syncWizard.clientSecret, syncWizard.passphrase)
      : global.GTD.syncer.setServerConfig(syncWizard.serverUrl, syncWizard.serverKey, syncWizard.passphrase);
    if (!ok) {
      toast(gdrive
        ? 'Revisa el ID de cliente y la frase de cifrado'
        : 'Revisa la dirección del servidor, la clave y la frase de cifrado');
      return;
    }
    closeSyncWizard(false);
    refresh();
    syncNow();
  }

  function renderSyncWizard() {
    if (!syncWizard) return;
    var status = global.GTD.syncer.status();
    var steps = syncWizardSteps();
    var index = steps.indexOf(syncWizard.step);
    var gdrive = syncWizard.provider === 'gdrive';

    // text may carry inline markup (links, <code>); escape interpolations at
    // the call sites.
    function p(text) {
      return '<p class="text-sm text-stone-500 dark:text-stone-400">' + text + '</p>';
    }

    function hint(text) {
      return '<p class="text-xs text-stone-400 dark:text-stone-500">' + text + '</p>';
    }

    // The one external action of a guide step: a big link into the exact
    // Google console page.
    function consoleLink(href, label) {
      return '<a href="' + href + '" target="_blank" rel="noopener" class="btn-secondary w-full">' + esc(label) + ' ↗</a>';
    }

    function copyRow(label, value) {
      return (
        '<div class="text-xs text-stone-500 dark:text-stone-400">' +
        '<span class="block mb-1">' + esc(label) + ':</span>' +
        '<span class="flex items-center gap-1">' +
        '<code class="break-all flex-1 min-w-0">' + esc(value) + '</code>' +
        '<button type="button" class="btn-ghost shrink-0" data-action="copy-value" data-value="' + esc(value) + '">Copiar</button>' +
        '</span></div>'
      );
    }

    var html =
      '<button id="sync-wizard-close" type="button" aria-label="Cerrar" ' +
      'class="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-2xl leading-none text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors duration-150">&times;</button>';
    html +=
      '<h2 id="sync-wizard-title" class="font-semibold text-lg tracking-tight pr-8">' +
      (gdrive ? 'Conectar Google Drive' : 'Conectar servidor propio') +
      '</h2>';
    // No progress on the first screen: the total depends on the branch chosen there.
    if (syncWizard.path !== null) {
      html += '<p class="text-xs text-stone-400 dark:text-stone-500 mt-0.5">Paso ' + (index + 1) + ' de ' + steps.length + '</p>';
    }
    html += '<form id="sync-wizard-form" class="mt-4 space-y-3">';
    // Hidden username so password managers (Bitwarden, Chrome…) save the
    // passphrase as a complete credential for this origin.
    html += '<input type="hidden" name="username" value="makeGTD" autocomplete="username" />';

    var continueLabel = 'Continuar';
    switch (syncWizard.step) {
      case 'start':
        if (gdrive) {
          html += p(
            'Tu copia cifrada se guarda en tu propio Google Drive y mantiene tus dispositivos ' +
            'sincronizados. Google no puede leerla: se cifra aquí antes de subirse.'
          );
          html += '<p class="font-medium pt-1">¿Tienes ya un ID de cliente de Google?</p>';
          html += choiceButton('data-action="sw-choice" data-choice="have-id"', '🔑', 'Sí, ya lo tengo', 'De otro dispositivo ya conectado. Solo hay que pegarlo.');
          html += choiceButton('data-action="sw-choice" data-choice="guide"', '🧭', 'No, crearlo ahora', 'Guía paso a paso por la consola de Google. Se hace una sola vez.');
        } else {
          html += p(
            'Un servidor pequeño y tuyo guarda las copias cifradas. En la carpeta ' +
            '<a href="https://github.com/leobrines/makegtd/tree/main/server" target="_blank" rel="noopener" class="text-accent underline"><code>server/</code> del proyecto</a> ' +
            'tienes una implementación de referencia y el protocolo.'
          );
          html += '<p class="font-medium pt-1">¿Cómo quieres configurar este dispositivo?</p>';
          // A label, not a button: tapping it opens the file picker directly.
          html +=
            '<label class="btn-choice cursor-pointer">' +
            '<span class="text-xl w-7 text-center shrink-0" aria-hidden="true">🗝️</span>' +
            '<span class="min-w-0"><span class="block">Importar archivo de llave</span>' +
            '<span class="block text-xs font-normal text-stone-400 dark:text-stone-500">Exportado desde otro dispositivo ya conectado. Lo configura todo por ti.</span></span>' +
            '<input type="file" id="sync-keyfile-input" accept="application/json,.json" class="hidden" />' +
            '</label>';
          html += choiceButton('data-action="sw-choice" data-choice="manual"', '⌨️', 'Escribir los datos a mano', 'La dirección del servidor y su clave de acceso.');
        }
        continueLabel = null;
        break;

      case 'g-project':
        html += p('Tu acceso vive en un «proyecto» de Google. Crea uno nuevo; el nombre da igual (p. ej. «makegtd»).');
        html += consoleLink('https://console.cloud.google.com/projectcreate', 'Abrir «Crear proyecto»');
        html += hint('Inicia sesión con tu cuenta de Google. Desde el móvil usa el navegador; si algo no aparece, activa «Versión para ordenador».');
        continueLabel = 'Ya lo creé';
        break;

      case 'g-api':
        html += p('En la página que se abre, pulsa el botón «Habilitar» (Enable).');
        html += consoleLink('https://console.cloud.google.com/apis/library/drive.googleapis.com', 'Abrir «Google Drive API»');
        continueLabel = 'Ya está habilitada';
        break;

      case 'g-register':
        html += p('Registra la app: un nombre (p. ej. «makegtd»), tu correo, y elige público «Externo» (External).');
        html += consoleLink('https://console.cloud.google.com/auth/overview/create', 'Abrir el registro de la app');
        continueLabel = 'Ya la registré';
        break;

      case 'g-client':
        html += p('Crea el cliente de tipo «Aplicación web» y pega estos dos valores en sus campos:');
        html += copyRow('En «Orígenes de JavaScript autorizados»', status.origin);
        html += copyRow('En «URI de redireccionamiento autorizados»', status.redirectUri);
        html += consoleLink('https://console.cloud.google.com/auth/clients/create', 'Abrir «Crear cliente»');
        continueLabel = 'Ya lo creé';
        break;

      case 'g-publish':
        html += p(
          'Pulsa «Publicar aplicación» (Publish app). El permiso que usa makeGTD —solo los datos de ' +
          'la propia app en tu Drive— no es sensible y no requiere verificación de Google.'
        );
        html += hint('Si prefieres dejarla en modo «Testing», añade tu correo como usuario de prueba; tendrás que volver a autorizar cada 7 días.');
        html += consoleLink('https://console.cloud.google.com/auth/audience', 'Abrir «Publicar aplicación»');
        continueLabel = 'Hecho';
        break;

      case 'client-id':
        html += p(
          syncWizard.path === 'have-id'
            ? 'Pega el «ID de cliente» (lo copias en tu otro dispositivo desde Ajustes → Google Drive) y su «Secreto de cliente» (de la consola de Google).'
            : 'Copia el «ID de cliente» y el «Secreto de cliente» que te muestra Google y pégalos aquí. Los cambios pueden tardar unos minutos en activarse.'
        );
        html +=
          '<label class="block">' +
          '<span class="block">ID de cliente de Google</span>' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5 mb-1">Termina en <code>.apps.googleusercontent.com</code>.</span>' +
          '<input type="text" id="sync-client-id" class="field" value="' + esc(syncWizard.clientId) + '" placeholder="…apps.googleusercontent.com" autocomplete="off" />' +
          '</label>';
        html +=
          '<label class="block">' +
          '<span class="block">Secreto de cliente</span>' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5 mb-1">Del mismo cliente OAuth. Google lo exige para el intercambio seguro del código (PKCE); se guarda solo en este dispositivo.</span>' +
          '<input type="password" id="sync-client-secret" class="field" value="' + esc(syncWizard.clientSecret) + '" autocomplete="off" />' +
          '</label>';
        break;

      case 'server-data':
        html +=
          '<label class="block">' +
          '<span class="block">Dirección del servidor</span>' +
          '<input type="text" id="sync-server-url" class="field mt-1" value="' + esc(syncWizard.serverUrl) + '" placeholder="https://sync.midominio.com" autocomplete="off" inputmode="url" />' +
          '</label>';
        html +=
          '<label class="block">' +
          '<span class="block">Clave de acceso</span>' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5 mb-1">La clave con la que arrancaste el servidor (<code>ACCESS_KEY</code>).</span>' +
          '<input type="password" id="sync-server-key" class="field" value="' + esc(syncWizard.serverKey) + '" autocomplete="off" />' +
          '</label>';
        break;

      case 'passphrase':
        html += p(
          'Inventa una frase de cifrado: con ella se cifran tus datos en este dispositivo antes de ' +
          'subirse. Escribirás <strong>la misma</strong> en cada dispositivo que conectes.'
        );
        html +=
          '<label class="block">' +
          '<span class="block">Frase de cifrado</span>' +
          '<span class="flex gap-2 mt-1">' +
          '<input type="password" id="sync-passphrase" name="passphrase" class="field flex-1" value="' + esc(syncWizard.passphrase) + '" autocomplete="new-password" />' +
          '<button type="button" class="btn-secondary shrink-0" data-action="sync-generate-passphrase">Generar</button>' +
          '<button type="button" class="btn-ghost shrink-0" data-action="toggle-passphrase" aria-pressed="false">Mostrar</button>' +
          '</span>' +
          '</label>';
        html += hint('No se puede recuperar: guárdala en tu gestor de contraseñas. Si la olvidas, la copia remota será ilegible (tus dispositivos conservan sus datos).');
        break;

      case 'connect':
        if (gdrive) {
          html += p(
            'Todo listo. Al continuar irás a Google para autorizar el acceso: elige tu cuenta y ' +
            'acepta. Volverás aquí automáticamente y se hará la primera sincronización.'
          );
          continueLabel = 'Conectar con Google';
        } else {
          html += p(
            'Todo listo. Se guardará la configuración y se hará la primera sincronización con ' +
            '<code class="break-all">' + esc(syncWizard.serverUrl) + '</code>.'
          );
          if (syncWizard.passFromFile) {
            html += hint('La frase de cifrado venía en el archivo de llave: no hay que teclear nada más.');
          }
          continueLabel = 'Guardar y sincronizar';
        }
        break;
    }

    if (continueLabel) {
      html += '<div class="flex items-center gap-2 pt-1">';
      if (index > 0) html += '<button type="button" class="btn-ghost" data-action="sw-back">‹ Volver</button>';
      html += '<button type="submit" class="btn-primary ml-auto">' + esc(continueLabel) + '</button>';
      html += '</div>';
    } else if (index > 0) {
      html += '<button type="button" class="btn-ghost" data-action="sw-back">‹ Volver atrás</button>';
    }
    html += '</form>';
    $('#sync-wizard').html(html);
  }

  // ---- Event wiring (delegated once) ----

  var currentContextFilter = '';

  function bind() {
    var $view = $('#view');

    // Expand/collapse the inline editor.
    $view.on('click', '[data-action="expand"]', function () {
      var id = $(this).data('id');
      expandedItemId = expandedItemId === id ? null : id;
      refresh();
    });

    $view.on('click', '[data-action="complete"]', function () {
      model.completeItem($(this).data('id'));
      toast('Hecha ✓');
      refresh();
    });

    $view.on('click', '[data-action="save-item"]', function () {
      var id = $(this).data('id');
      var $editor = $view.find('[data-editor-for="' + id + '"]');
      var fields = {
        title: $editor.find('[data-field="title"]').val().trim() || store.getItem(id).title,
        notes: $editor.find('[data-field="notes"]').val(),
        status: $editor.find('[data-field="status"]').val(),
        projectId: $editor.find('[data-field="projectId"]').val() || null,
        date: $editor.find('[data-field="date"]').val() || null,
        waitingFor: $editor.find('[data-field="waitingFor"]').val() || null,
      };
      // The context select is absent while contexts are disabled; skip the
      // field so stored contexts survive a temporary toggle-off. Same for the
      // time input and the Engage criteria selects, absent while their
      // feature is off (or the criterion's value list is empty).
      var $context = $editor.find('[data-field="context"]');
      if ($context.length) fields.context = $context.val() || null;
      var $time = $editor.find('[data-field="time"]');
      if ($time.length) fields.time = $time.val() || null;
      ['estimate', 'energy', 'priority'].forEach(function (field) {
        var $select = $editor.find('[data-field="' + field + '"]');
        if ($select.length) fields[field] = $select.val() || null;
      });
      if (fields.status === model.STATUS.SCHEDULED && !fields.date) fields.status = model.STATUS.NEXT;
      if (fields.status !== model.STATUS.SCHEDULED) {
        fields.date = null;
        fields.time = null;
      }
      if (fields.status !== model.STATUS.WAITING) fields.waitingFor = null;
      if (fields.status !== model.STATUS.SOMEDAY) fields.tickleDate = null;
      store.updateItem(id, fields);
      expandedItemId = null;
      toast('Guardado');
      refresh();
    });

    // Show/hide the waiting-for field as status changes inside the editor.
    // Choosing "Programada" with no date jumps straight into the picker: a
    // scheduled item without a day would silently fall back to Next on save.
    $view.on('change', '[data-field="status"]', function () {
      var $editor = $(this).closest('[data-editor-for]');
      $editor.find('[data-field="waitingFor"]').toggle($(this).val() === model.STATUS.WAITING);
      if ($(this).val() === model.STATUS.SCHEDULED && !$editor.find('[data-field="date"]').val()) {
        $editor.find('[data-action="pick-date"]').trigger('click');
      }
    });

    // Editor attribute rows: each one opens its own dialog with its choices.
    $view.on('click', '[data-action="edit-attr"]', function () {
      var attr = $(this).data('attr');
      var $editor = $(this).closest('[data-editor-for]');
      var current = $editor.find('[data-field="' + attr + '"]').val();

      function apply(value, label) {
        $editor.find('[data-field="' + attr + '"]').val(value);
        $editor.find('[data-role="' + attr + '-label"]')
          .text(label)
          .removeClass('text-stone-400 dark:text-stone-500');
        $editor.find('[data-action="clear-attr"][data-attr="' + attr + '"]').show();
      }

      if (attr === 'status') {
        openChooser('Lista', statusChoices(current), current, function (value) {
          apply(value, model.STATUS_LABELS[value]);
          $editor.find('[data-field="status"]').trigger('change');
        });
        return;
      }
      if (attr === 'projectId') {
        openChooser(
          'Proyecto',
          model.activeProjects().map(function (p) { return { value: p.id, label: p.name }; }),
          current,
          function (value) {
            var project = store.getProject(value);
            apply(value, project ? project.name : value);
          }
        );
        return;
      }
      if (attr === 'context') {
        openChooser(
          'Contexto',
          store.getContexts().map(function (c) { return { value: c, label: c }; }),
          current,
          function (value) { apply(value, value); }
        );
        return;
      }
      // Engage criteria (estimate/energy/priority): choices come from the
      // user-edited value lists; a stored value no longer in its list stays
      // choosable until changed.
      var values = { estimate: model.timeEstimates(), energy: model.energyLevels(), priority: model.priorities() }[attr];
      var titles = { estimate: 'Tiempo estimado', energy: 'Nivel de energía', priority: 'Prioridad' };
      var options = values.map(function (v) { return { value: v, label: v }; });
      if (current && values.indexOf(current) === -1) options.push({ value: current, label: current });
      openChooser(titles[attr], options, current, function (value) { apply(value, value); });
    });

    $view.on('click', '[data-action="clear-attr"]', function () {
      var attr = $(this).data('attr');
      var $editor = $(this).closest('[data-editor-for]');
      $editor.find('[data-field="' + attr + '"]').val('');
      $editor.find('[data-role="' + attr + '-label"]')
        .text(ATTR_ADD_LABELS[attr])
        .addClass('text-stone-400 dark:text-stone-500');
      $(this).hide();
    });

    $view.on('click', '[data-action="show-notes"]', function () {
      var $editor = $(this).closest('[data-editor-for]');
      $(this).addClass('hidden');
      $editor.find('[data-field="notes"]').removeClass('hidden').trigger('focus');
    });

    $('#chooser-panel').on('click', '[data-action="choose-option"]', function () {
      var onPick = chooserOnPick;
      var value = $(this).attr('data-value');
      closeChooser();
      if (onPick) onPick(value);
    });

    $('#chooser-overlay').on('click', function (e) {
      if (e.target === this) closeChooser();
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeChooser();
    });

    // Date picker dialog for the inline editor. Choosing a day turns the item
    // into a scheduled one (setup guide calendar rule: a date means it must
    // happen that day); clearing it sends it back to Next Actions.
    $view.on('click', '[data-action="pick-date"]', function () {
      var $editor = $(this).closest('[data-editor-for]');
      global.GTD.datepicker.open({
        date: $editor.find('[data-field="date"]').val() || null,
        time: $editor.find('[data-field="time"]').val() || null,
        onDone: function (date, time) {
          $editor.find('[data-field="date"]').val(date);
          $editor.find('[data-field="time"]').val(time || '');
          $editor.find('[data-field="status"]').val(model.STATUS.SCHEDULED).trigger('change');
          $editor.find('[data-role="status-label"]').text(model.STATUS_LABELS[model.STATUS.SCHEDULED]);
          $editor.find('[data-role="date-label"]')
            .text(model.formatDate(date) + (time && model.timeFieldEnabled() ? ' · ' + time : ''))
            .removeClass('text-stone-400 dark:text-stone-500');
          $editor.find('[data-action="clear-date"]').show();
        },
      });
    });

    $view.on('click', '[data-action="clear-date"]', function () {
      var $editor = $(this).closest('[data-editor-for]');
      $editor.find('[data-field="date"]').val('');
      $editor.find('[data-field="time"]').val('');
      var $status = $editor.find('[data-field="status"]');
      if ($status.val() === model.STATUS.SCHEDULED) {
        $status.val(model.STATUS.NEXT).trigger('change');
        $editor.find('[data-role="status-label"]').text(model.STATUS_LABELS[model.STATUS.NEXT]);
      }
      $editor.find('[data-role="date-label"]')
        .text(model.timeFieldEnabled() ? 'Agregar fecha/hora' : 'Agregar fecha')
        .addClass('text-stone-400 dark:text-stone-500');
      $(this).hide();
    });

    $view.on('click', '[data-action="delete"]', function () {
      store.removeItem($(this).data('id'));
      expandedItemId = null;
      toast('Movida a la papelera');
      refresh();
    });

    // Today: focus picker.
    $view.on('click', '[data-action="show-focus-picker"]', function () {
      $('#focus-picker').toggleClass('hidden');
    });
    $view.on('click', '[data-action="add-focus"]', function () {
      if (!model.toggleFocus($(this).data('id'))) {
        toast('Máximo ' + model.FOCUS_LIMIT + ' tareas de foco');
      }
      refresh();
    });

    // Inbox capture form. The re-render after capture collapses the notes
    // field again, keeping the default single-line, zero-friction shape.
    $view.on('click', '#inbox-notes-toggle', function () {
      $(this).addClass('hidden');
      $('#inbox-notes').removeClass('hidden').trigger('focus');
    });

    $view.on('submit', '#inbox-capture', function (e) {
      e.preventDefault();
      var title = $('#inbox-input').val().trim();
      var notes = $('#inbox-notes').val().trim();
      if (!global.GTD.app.captureItem(title, notes)) return;
      refresh();
      $('#inbox-input').trigger('focus');
    });

    // Next actions: context filter chips.
    $view.on('click', '[data-action="filter-context"]', function () {
      currentContextFilter = $(this).data('context') || '';
      refresh();
    });

    // "Ordenar por" menu.
    $view.on('click', '[data-action="open-sort"]', function () {
      openSortMenu($(this).data('list-key'), !!$(this).data('has-dates'));
    });

    $('#sort-panel').on('click', '[data-action="choose-sort"]', function () {
      if (!sortMenuFor) return;
      model.setSortPref(sortMenuFor.listKey, $(this).data('sort'));
      closeSortMenu();
      refresh();
    });

    $('#sort-overlay').on('click', function (e) {
      if (e.target === this) closeSortMenu();
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeSortMenu();
    });

    // Help popup: what a "context" is (triggers live in Settings and the Clarify wizard).
    function closeContextHelp() {
      $('#context-help-overlay').addClass('hidden').attr('aria-hidden', 'true');
    }

    $view.on('click', '[data-action="help-context"]', function () {
      $('#context-help-overlay').removeClass('hidden').attr('aria-hidden', 'false');
    });

    $('#context-help-overlay').on('click', function (e) {
      if (e.target === this) closeContextHelp();
    });

    $('#context-help-close, #context-help-ok').on('click', closeContextHelp);

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeContextHelp();
    });

    // Recovery-code dialog: copy button + close handlers.
    $('#recovery-code-overlay').on('click', function (e) {
      if (e.target === this) closeRecoveryCode();
    });

    $('#recovery-code-close, #recovery-code-ok').on('click', closeRecoveryCode);

    $('#recovery-code-copy').on('click', function () {
      var $btn = $(this);
      var $field = $('#recovery-code-value');
      var code = $field.val();

      function done() {
        var original = $btn.data('label') || $btn.text();
        $btn.data('label', original).text('Copiado ✓');
        global.setTimeout(function () {
          $btn.text($btn.data('label'));
        }, 1500);
      }

      // Select the text so it stays visible/selected even if copying fails,
      // then try the async Clipboard API with an execCommand fallback.
      $field.trigger('focus');
      $field[0].setSelectionRange(0, code.length);
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(code).then(done, function () {
          try {
            global.document.execCommand('copy');
            done();
          } catch (err) {
            toast('Copia el código manualmente');
          }
        });
      } else {
        try {
          global.document.execCommand('copy');
          done();
        } catch (err) {
          toast('Copia el código manualmente');
        }
      }
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeRecoveryCode();
    });

    // Horizons (2-5): add, expand, save, delete.
    $view.on('submit', '.horizon-form', function (e) {
      e.preventDefault();
      var level = $(this).data('level');
      var $input = $(this).find('.horizon-input');
      if (!store.addHorizon(level, $input.val())) return;
      refresh();
      $('.horizon-form[data-level="' + level + '"] .horizon-input').trigger('focus');
    });

    // Tapping an entry (any level) opens the shared modal editor prefilled
    // with the entry's title and note.
    $view.on('click', '[data-action="edit-horizon"]', function () {
      var horizon = store.getHorizon($(this).data('id'));
      if (!horizon) return;
      editingHorizonId = horizon.id;
      var meta = model.horizonMeta(horizon.level);
      $('#horizon-editor-heading').text(meta ? 'Horizonte ' + horizon.level + ' · ' + meta.title : 'Horizonte');
      $('#horizon-editor-text').val(horizon.text);
      $('#horizon-editor-note').val(horizon.note || '');
      $('#horizon-editor-overlay').removeClass('hidden').attr('aria-hidden', 'false');
      $('#horizon-editor-text').trigger('focus');
    });

    $('#horizon-editor-form').on('submit', function (e) {
      e.preventDefault();
      if (!editingHorizonId) return;
      var text = $('#horizon-editor-text').val().trim();
      var note = $('#horizon-editor-note').val().trim();
      if (text) store.updateHorizon(editingHorizonId, { text: text, note: note });
      closeHorizonEditor();
      toast('Guardado');
      refresh();
    });

    $('#horizon-editor-delete').on('click', function () {
      if (editingHorizonId) store.removeHorizon(editingHorizonId);
      closeHorizonEditor();
      toast('Movido a la papelera');
      refresh();
    });

    $('#horizon-editor-overlay').on('click', function (e) {
      if (e.target === this) closeHorizonEditor();
    });

    $('#horizon-editor-close').on('click', closeHorizonEditor);

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeHorizonEditor();
    });

    $view.on('click', '[data-action="restore-horizon"]', function () {
      store.restoreHorizon($(this).data('id'));
      toast('Restaurado');
      refresh();
    });

    // Help popups of the Horizons view, one per horizon level (2-5). Each
    // helpAction in model.HORIZONS maps to its overlay: help-areas ->
    // #areas-help-overlay, and so on with -close/-ok button ids.
    ['areas', 'goals', 'vision', 'purpose'].forEach(function (key) {
      var $overlay = $('#' + key + '-help-overlay');

      function close() {
        $overlay.addClass('hidden').attr('aria-hidden', 'true');
      }

      $view.on('click', '[data-action="help-' + key + '"]', function () {
        $overlay.removeClass('hidden').attr('aria-hidden', 'false');
      });

      $overlay.on('click', function (e) {
        if (e.target === this) close();
      });

      $('#' + key + '-help-close, #' + key + '-help-ok').on('click', close);

      $(document).on('keydown', function (e) {
        if (e.key === 'Escape') close();
      });
    });

    // Projects.
    $view.on('submit', '#project-form', function (e) {
      e.preventDefault();
      var name = $('#project-input').val().trim();
      if (!name) return;
      var project = store.addProject({ name: name });
      location.hash = '#/proyectos/' + project.id;
    });

    $view.on('submit', '#project-item-form', function (e) {
      e.preventDefault();
      var projectId = $(this).data('project-id');
      var title = $('#project-item-input').val().trim();
      if (!title) return;
      var fields = { title: title, status: model.STATUS.NEXT, projectId: projectId };
      // A chosen day makes the new action calendar-bound from the start
      // (setup guide calendar rule: only day-specific actions carry a date).
      var date = $('#project-item-date-value').val();
      if (date) {
        fields.status = model.STATUS.SCHEDULED;
        fields.date = date;
        fields.time = $('#project-item-time-value').val() || null;
      }
      store.addItem(fields);
      refresh();
      $('#project-item-input').trigger('focus');
    });

    $view.on('click', '#project-item-date', function () {
      global.GTD.datepicker.open({
        date: $('#project-item-date-value').val() || null,
        time: $('#project-item-time-value').val() || null,
        onDone: function (date, time) {
          $('#project-item-date-value').val(date);
          $('#project-item-time-value').val(time || '');
          $('#project-item-date-label').text(
            '📅 ' + model.formatDate(date) + (time && model.timeFieldEnabled() ? ' · ' + time : '')
          );
          $('#project-item-date-chip').removeClass('hidden').addClass('flex');
        },
      });
    });

    $view.on('click', '#project-item-date-clear', function () {
      $('#project-item-date-value').val('');
      $('#project-item-time-value').val('');
      $('#project-item-date-chip').addClass('hidden').removeClass('flex');
    });

    $view.on('change', '#project-name', function () {
      var id = $(this).data('project-id');
      var name = $(this).val().trim();
      if (!name) {
        $(this).val(store.getProject(id).name);
        return;
      }
      store.updateProject(id, { name: name });
      toast('Guardado');
    });

    $view.on('change', '#project-outcome', function () {
      store.updateProject($(this).data('project-id'), { outcome: $(this).val().trim() });
      toast('Guardado');
    });

    $view.on('click', '[data-action="complete-project"]', function () {
      var id = $(this).data('id');
      var open = model.projectItems(id).filter(function (i) {
        return i.status !== model.STATUS.DONE && i.status !== model.STATUS.REFERENCE;
      });
      if (open.length) {
        var msg = open.length === 1
          ? 'Este proyecto tiene 1 acción pendiente. ¿Completarlo igualmente? La acción seguirá en tus listas.'
          : 'Este proyecto tiene ' + open.length + ' acciones pendientes. ¿Completarlo igualmente? Las acciones seguirán en tus listas.';
        if (!global.confirm(msg)) return;
      }
      store.updateProject(id, { status: 'done' });
      toast('Proyecto completado 🎉');
      location.hash = '#/proyectos';
    });

    $view.on('click', '[data-action="incubate-project"]', function () {
      model.incubateProject($(this).data('id'));
      toast('Proyecto incubando en «Algún día»');
      location.hash = '#/proyectos';
    });

    // Recoverable (goes to the trash), so no confirm dialog is needed.
    $view.on('click', '[data-action="delete-project"]', function () {
      store.removeProject($(this).data('id'));
      toast('Proyecto movido a la papelera');
      location.hash = '#/proyectos';
    });

    // Someday: activate.
    $view.on('click', '[data-action="activate"]', function () {
      store.updateItem($(this).data('id'), { status: model.STATUS.NEXT, tickleDate: null });
      toast('Movida a próximas acciones');
      refresh();
    });
    $view.on('click', '[data-action="activate-project"]', function () {
      model.activateProject($(this).data('id'));
      toast('Proyecto activado');
      refresh();
    });

    // Trash.
    $view.on('click', '[data-action="restore-item"]', function () {
      store.restoreItem($(this).data('id'));
      toast('Restaurada');
      refresh();
    });
    $view.on('click', '[data-action="restore-project"]', function () {
      store.restoreProject($(this).data('id'));
      toast('Proyecto restaurado');
      refresh();
    });
    $view.on('click', '[data-action="empty-trash"]', function () {
      if (!global.confirm('¿Vaciar la papelera? Su contenido se eliminará definitivamente.')) return;
      store.emptyTrash();
      toast('Papelera vaciada');
      refresh();
    });

    // Settings.
    $view.on('change', '#contexts-enabled-toggle', function () {
      var enabled = this.checked;
      store.updateSettings({ contextsEnabled: enabled });
      if (!enabled) currentContextFilter = '';
      toast(enabled ? 'Contextos activados' : 'Contextos desactivados');
      refresh();
    });

    $view.on('submit', '#context-form', function (e) {
      e.preventDefault();
      var name = $('#context-input').val();
      if (store.addContext(name)) refresh();
    });
    $view.on('click', '[data-action="remove-context"]', function () {
      store.removeContext($(this).data('context'));
      refresh();
    });

    $view.on('change', '#reference-enabled-toggle', function () {
      store.updateSettings({ referenceEnabled: this.checked });
      toast(this.checked ? 'Lista de referencia activada' : 'Lista de referencia desactivada');
      refresh();
    });

    $view.on('change', '#waiting-enabled-toggle', function () {
      store.updateSettings({ waitingEnabled: this.checked });
      toast(this.checked ? 'Lista «A la espera» activada' : 'Lista «A la espera» desactivada');
      refresh();
    });

    $view.on('change', '#time-field-enabled-toggle', function () {
      store.updateSettings({ timeFieldEnabled: this.checked });
      toast(this.checked ? 'Campo de hora activado' : 'Campo de hora desactivado');
      refresh();
    });

    $view.on('change', '#horizons-enabled-toggle', function () {
      store.updateSettings({ horizonsEnabled: this.checked });
      toast(this.checked ? 'Horizontes activados' : 'Horizontes desactivados');
      refresh();
    });

    $view.on('change', '#gcal-enabled-toggle', function () {
      store.updateSettings({ gcalEnabled: this.checked });
      toast(this.checked ? 'Botones de Google Calendar activados' : 'Botones de Google Calendar desactivados');
      refresh();
    });

    $view.on('change', '#capture-shortcut-toggle', function () {
      store.updateSettings({ captureShortcutEnabled: this.checked });
      toast(this.checked ? 'Tecla rápida activada' : 'Tecla rápida desactivada');
      refresh();
    });

    $view.on('change', '#review-day-select', function () {
      var value = $(this).val();
      store.updateSettings({ reviewDay: value === '' ? null : Number(value) });
      toast('Guardado');
      refresh();
    });

    $view.on('change', '[id^="criterion-toggle-"]', function () {
      var key = this.id.replace('criterion-toggle-', '');
      var fields = {};
      fields[key + 'Enabled'] = this.checked;
      store.updateSettings(fields);
      toast(this.checked ? 'Campo activado' : 'Campo desactivado');
      refresh();
    });

    $view.on('submit', '.criterion-form', function (e) {
      e.preventDefault();
      var key = $(this).data('criterion');
      var name = $(this).find('.criterion-input').val();
      if (store.addCriterionValue(key, name)) refresh();
    });
    $view.on('click', '[data-action="remove-criterion-value"]', function () {
      store.removeCriterionValue($(this).data('criterion'), $(this).data('value'));
      refresh();
    });

    $view.on('click', '[data-action="export-data"]', function () {
      var blob = new Blob([store.exportJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'makegtd-copia-' + model.todayISO() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    $view.on('change', '#import-file', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          store.importJSON(reader.result);
          toast('Copia importada');
          refresh();
        } catch (err) {
          toast('El archivo no es una copia válida');
        }
      };
      reader.readAsText(file);
    });

    $view.on('click', '[data-action="clear-all"]', function () {
      if (!global.confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) return;
      if (!global.confirm('¿De verdad? Se perderá todo lo que no hayas exportado.')) return;
      store.clearAll();
      toast('Datos borrados');
      refresh();
    });

    // ---- Device vault (encryption at rest, via GTD.vault) ----

    // Turns on encryption at rest. Biometric registration is attempted inside
    // the click gesture (WebAuthn needs it); if it is unsupported or declined
    // the vault falls back to recovery-code-only, which still encrypts data.
    $view.on('click', '[data-action="vault-enroll"]', function () {
      var vault = global.GTD.vault;
      if (!vault || !vault.available()) return;
      var code = randomPassphrase();
      vault
        .enroll({ recoveryCode: code, useBiometric: true })
        .then(function (res) {
          return store
            .enableEncryption(res.key)
            .then(function () {
              return global.GTD.syncer.loadConfig();
            })
            .then(function () {
              return res;
            });
        })
        .then(function (res) {
          showRecoveryCode(code, {
            title: res.biometric ? 'Protección activada con biometría 🔒' : 'Protección activada 🔒',
          });
          toast(res.biometric ? 'Protección activada con biometría 🔒' : 'Protección activada 🔒');
          refresh();
        })
        .catch(function () {
          toast('No se pudo activar la protección');
        });
    });

    $view.on('click', '[data-action="vault-add-biometric"]', function () {
      var code = global.prompt('Escribe tu código de recuperación para añadir la biometría:');
      if (!code) return;
      global.GTD.vault
        .addBiometric(code)
        .then(function () {
          toast('Biometría añadida 🔒');
          refresh();
        })
        .catch(function (err) {
          toast(err && err.message === 'unlock-failed' ? 'Código incorrecto' : 'No se pudo añadir la biometría');
        });
    });

    $view.on('click', '[data-action="vault-change-recovery"]', function () {
      var current = global.prompt('Código de recuperación actual:');
      if (!current) return;
      var next = randomPassphrase();
      global.GTD.vault
        .changeRecovery(current, next)
        .then(function () {
          showRecoveryCode(next, {
            title: 'Nuevo código de recuperación',
            desc:
              'Este es tu <strong>nuevo código de recuperación</strong>. Guárdalo ahora; ' +
              'el anterior ya no sirve.',
          });
          toast('Código actualizado');
        })
        .catch(function (err) {
          toast(err && err.message === 'unlock-failed' ? 'Código actual incorrecto' : 'No se pudo cambiar el código');
        });
    });

    $view.on('click', '[data-action="vault-disable"]', function () {
      if (!global.confirm('¿Desactivar la protección? Tus datos quedarán sin cifrar en este dispositivo.')) return;
      // Move the sync config back to plaintext while the vault is still enrolled,
      // then remove the vault and re-persist the document in the clear.
      global.GTD.syncer.prepareDisableEncryption();
      global.GTD.vault.disable();
      store.disableEncryption();
      toast('Protección desactivada');
      refresh();
    });

    // ---- Sync (provider-agnostic, via GTD.syncer) ----

    $view.on('click', '[data-action="sync-setup"]', function () {
      openSyncWizard($(this).data('provider'));
    });

    $view.on('click', '[data-action="sync-remove-backend"]', function () {
      var provider = $(this).data('provider');
      var message =
        '¿Quitar ' + syncBackendLabel(provider) + ' de este dispositivo? ' +
        'Tus datos locales se conservan; la copia remota no se borra.';
      if (!global.confirm(message)) return;
      global.GTD.syncer.removeBackend(provider);
      toast('Destino quitado');
      refresh();
    });

    $view.on('click', '[data-action="sync-now"]', syncNow);

    $view.on('click', '[data-action="sync-export-key"]', function () {
      var password = global.prompt('Elige una contraseña para proteger el archivo de llave (te la pedirá al importarlo):');
      if (!password) return;
      global.GTD.syncer
        .exportKeyFile(password)
        .then(function (envelope) {
          var blob = new Blob([envelope], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'makegtd-llave.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        })
        .catch(function () {
          toast('No se pudo crear el archivo de llave');
        });
    });

    $view.on('click', '[data-action="copy-ai-prompt"]', function () {
      var key = $(this).data('prompt');
      if (key === 'horizons-review') copyToClipboard(buildHorizonsReviewPrompt());
    });

    // Document-level: copy buttons live both in the Settings view and inside
    // the sync wizard modal (which is outside #view).
    $(document).on('click', '[data-action="copy-value"]', function () {
      var value = String($(this).data('value'));
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(value).then(
          function () {
            toast('Copiado');
          },
          function () {
            global.prompt('Copia este valor:', value);
          }
        );
      } else {
        global.prompt('Copia este valor:', value);
      }
    });

    // ---- Sync setup wizard events (the modal lives outside #view) ----

    var $wizard = $('#sync-wizard-overlay');

    $wizard.on('click', '#sync-wizard-close', function () {
      closeSyncWizard(false);
    });

    $wizard.on('click', function (e) {
      if (e.target === this) closeSyncWizard(false);
    });

    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') closeSyncWizard(false);
    });

    // First-screen branch: each choice decides which steps follow.
    $wizard.on('click', '[data-action="sw-choice"]', function () {
      var choice = $(this).data('choice');
      if (choice === 'have-id') {
        syncWizard.path = 'have-id';
        syncWizardGo('client-id');
      } else if (choice === 'guide') {
        syncWizard.path = 'guide';
        syncWizardGo('g-project');
      } else if (choice === 'manual') {
        syncWizard.path = 'manual';
        syncWizardGo('server-data');
      }
    });

    $wizard.on('click', '[data-action="sw-back"]', function () {
      // Same code path as the hardware back button: pop the history entry
      // and let the popstate handler restore the previous step.
      if (syncWizardDepth > 1) global.history.back();
    });

    // Continue: validate and store the current step's input, then advance.
    $wizard.on('submit', '#sync-wizard-form', function (e) {
      e.preventDefault();
      if (!syncWizard) return;
      var steps = syncWizardSteps();
      var step = syncWizard.step;
      if (step === 'client-id') {
        var clientId = $('#sync-client-id').val().trim();
        var clientSecret = $('#sync-client-secret').val().trim();
        if (!clientId || !clientSecret) {
          toast('Pega tu ID y tu secreto de cliente para continuar');
          return;
        }
        syncWizard.clientId = clientId;
        syncWizard.clientSecret = clientSecret;
      } else if (step === 'server-data') {
        var url = $('#sync-server-url').val();
        var key = $('#sync-server-key').val().trim();
        if (!global.GTD.syncer._pure.normalizeServerUrl(url)) {
          toast('Revisa la dirección del servidor');
          return;
        }
        if (!key) {
          toast('Falta la clave de acceso');
          return;
        }
        syncWizard.serverUrl = url.trim();
        syncWizard.serverKey = key;
      } else if (step === 'passphrase') {
        var phrase = $('#sync-passphrase').val();
        if (!phrase) {
          toast('Escribe o genera tu frase de cifrado');
          return;
        }
        syncWizard.passphrase = phrase;
      } else if (step === 'connect') {
        finishSyncWizard();
        return;
      }
      syncWizardGo(steps[steps.indexOf(step) + 1]);
    });

    // Key file import (server first screen): configures everything at once
    // and jumps ahead — to the passphrase step only if the file lacks one.
    $wizard.on('change', '#sync-keyfile-input', function () {
      var input = this;
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        var password = '';
        if (global.GTD.crypto.isEnvelope(text)) {
          password = global.prompt('Contraseña del archivo de llave:');
          if (password === null) return;
        }
        global.GTD.syncer
          .importKeyFile(text, password)
          .then(function (data) {
            input.value = '';
            if (!syncWizard) return;
            syncWizard.path = 'keyfile';
            syncWizard.serverUrl = data.url;
            syncWizard.serverKey = data.key;
            if (!global.GTD.syncer.status().configured && data.passphrase) {
              syncWizard.passphrase = data.passphrase;
              syncWizard.passFromFile = true;
            }
            toast('Archivo de llave importado');
            syncWizardGo(syncWizardSteps()[1]);
          })
          .catch(function (err) {
            input.value = '';
            toast(err && err.message === 'decrypt-failed' ? 'Contraseña del archivo incorrecta' : 'El archivo de llave no es válido');
          });
      };
      reader.readAsText(file);
    });

    $wizard.on('click', '[data-action="toggle-passphrase"]', function () {
      var $input = $('#sync-passphrase');
      var show = $input.attr('type') === 'password';
      $input.attr('type', show ? 'text' : 'password');
      $(this).text(show ? 'Ocultar' : 'Mostrar').attr('aria-pressed', String(show));
    });

    // Fills the field with a strong random phrase (~79 bits; confusable
    // characters excluded) and reveals it so the user can write it down.
    $wizard.on('click', '[data-action="sync-generate-passphrase"]', function () {
      var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
      var bytes = global.crypto.getRandomValues(new Uint8Array(16));
      var phrase = Array.prototype.map
        .call(bytes, function (b, i) {
          return alphabet[b % alphabet.length] + (i % 4 === 3 && i < 15 ? '-' : '');
        })
        .join('');
      $('#sync-passphrase').attr('type', 'text').val(phrase);
      $wizard.find('[data-action="toggle-passphrase"]').text('Ocultar').attr('aria-pressed', 'true');
      toast('Frase generada: guárdala antes de continuar');
    });

    // Hardware/browser back while the wizard is open: restore the step
    // recorded in the entry we land on, or close the modal when popping past
    // its first entry (see js/process.js for the reference pattern).
    $(global).on('popstate', function (e) {
      if (syncWizardUnwinding) {
        syncWizardUnwinding = false;
        return;
      }
      if (!syncWizard) return;
      var state = e.originalEvent.state;
      if (state && state.swSession === SYNC_WIZARD_SESSION) {
        syncWizard.step = state.swStep;
        syncWizard.path = state.swPath;
        syncWizardDepth = state.swDepth;
        renderSyncWizard();
        return;
      }
      closeSyncWizard(true);
    });
  }

  // Runs a sync pass and reports the outcome; shared by the Settings button
  // and the wizard's final step.
  function syncNow() {
    toast('Sincronizando…');
    global.GTD.syncer
      .sync()
      .then(function (result) {
        // {redirecting: true} means the page is leaving for Google's
        // consent screen; the flow resumes at boot after the redirect.
        if (!result || result.redirecting) return;
        if (result.ok) {
          toast('Sincronizado ✅');
        } else {
          var failed = result.results.filter(function (r) {
            return !r.ok;
          })[0];
          toast(syncBackendLabel(failed.provider) + ': ' + syncErrorMessage(failed.error));
        }
        refresh();
      })
      .catch(function (err) {
        toast(syncErrorMessage(err));
      });
  }

  // Copies long multi-line text (AI prompts). navigator.clipboard needs a
  // secure context (the PWA normally runs in one); the hidden-textarea path
  // covers the rest — window.prompt would mangle multi-line text.
  function copyToClipboard(value) {
    function legacyCopy() {
      var textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      textarea.remove();
      toast(ok ? 'Prompt copiado' : 'No se pudo copiar');
    }
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(value).then(function () {
        toast('Prompt copiado');
      }, legacyCopy);
    } else {
      legacyCopy();
    }
  }

  // Backend name as shown in toasts and confirmations.
  function syncBackendLabel(provider) {
    return provider === 'gdrive' ? 'Google Drive' : 'Servidor propio';
  }

  // Spanish UI message for a sync failure (error codes come from js/syncer.js
  // and its transports). Also used by app.js after the OAuth redirect.
  function syncErrorMessage(err) {
    var code = (err && err.message) || '';
    if (code === 'auth-expired') return 'La sesión de Google caducó. Pulsa «Sincronizar ahora» para volver a conectar.';
    if (code === 'auth-invalid') return 'El servidor rechazó la clave de acceso. Revísala en Ajustes.';
    if (code === 'decrypt-failed') return 'La frase de cifrado no coincide con la de tus otros dispositivos.';
    if (code === 'not-configured') return 'Configura la sincronización en Ajustes primero.';
    if (code.indexOf('drive-http-') === 0) return 'Google Drive respondió con un error (' + code.slice('drive-http-'.length) + '). Inténtalo de nuevo.';
    if (code.indexOf('server-http-') === 0) return 'El servidor respondió con un error (' + code.slice('server-http-'.length) + '). Inténtalo de nuevo.';
    return 'No se pudo sincronizar. Comprueba tu conexión e inténtalo de nuevo.';
  }

  global.GTD.views = {
    bind: bind,
    esc: esc,
    header: header,
    emptyState: emptyState,
    renderToday: renderToday,
    renderInbox: renderInbox,
    renderNext: function () {
      return renderNext(currentContextFilter);
    },
    renderAgenda: renderAgenda,
    renderProjects: renderProjects,
    renderProjectDetail: renderProjectDetail,
    gcalIcon: gcalIcon,
    helpIcon: helpIcon,
    renderWaiting: renderWaiting,
    renderSomeday: renderSomeday,
    renderHorizons: renderHorizons,
    renderAI: renderAI,
    renderReference: renderReference,
    renderTrash: renderTrash,
    renderSettings: renderSettings,
    syncErrorMessage: syncErrorMessage,
    syncBackendLabel: syncBackendLabel,
    collapseEditor: function () {
      expandedItemId = null;
      closeHorizonEditor();
      closeSortMenu();
      closeChooser();
    },
  };
})(window, jQuery);
