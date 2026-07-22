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

  function contextOptions(selected) {
    var html = '<option value="">Sin contexto</option>';
    store.getContexts().forEach(function (c) {
      html += '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>';
    });
    return html;
  }

  function projectOptions(selected) {
    var html = '<option value="">Sin proyecto</option>';
    model.activeProjects().forEach(function (p) {
      html += '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function statusOptions(selected) {
    var order = ['next', 'scheduled', 'waiting', 'someday', 'reference', 'inbox'];
    var html = '';
    order.forEach(function (s) {
      // Reference/Waiting disabled: hide the option unless the item already is one.
      if (s === 'reference' && s !== selected && !model.referenceEnabled()) return;
      if (s === 'waiting' && s !== selected && !model.waitingEnabled()) return;
      html += '<option value="' + s + '"' + (s === selected ? ' selected' : '') + '>' +
        esc(model.STATUS_LABELS[s]) + '</option>';
    });
    return html;
  }

  // Select for one Engage criterion (estimate/energy/priority). Empty list =>
  // the field is off; render nothing.
  function criterionSelect(field, label, emptyLabel, values, selected) {
    if (!values.length) return '';
    var html = '<select class="field" data-field="' + field + '" aria-label="' + esc(label) + '">' +
      '<option value="">' + esc(emptyLabel) + '</option>';
    values.forEach(function (v) {
      html += '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    // A stored value no longer in the list stays selectable until changed.
    if (selected && values.indexOf(selected) === -1) {
      html += '<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>';
    }
    return html + '</select>';
  }

  // Inline editor shown under an expanded row.
  function itemEditor(item) {
    return (
      '<div class="border-t border-stone-100 dark:border-stone-800 px-4 py-4 space-y-3" data-editor-for="' + item.id + '">' +
      '<input type="text" class="field" data-field="title" value="' + esc(item.title) + '" aria-label="Título" />' +
      '<textarea class="field" rows="2" data-field="notes" placeholder="Notas (opcional)" aria-label="Notas">' + esc(item.notes) + '</textarea>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<select class="field" data-field="status" aria-label="Lista">' + statusOptions(item.status) + '</select>' +
      (model.contextsEnabled()
        ? '<select class="field" data-field="context" aria-label="Contexto">' + contextOptions(item.context) + '</select>'
        : '') +
      '<select class="field" data-field="projectId" aria-label="Proyecto">' + projectOptions(item.projectId) + '</select>' +
      '<input type="date" class="field" data-field="date" value="' + esc(item.date || '') + '" aria-label="Fecha" />' +
      (model.timeFieldEnabled()
        ? '<input type="time" class="field" data-field="time" value="' + esc(item.time || '') + '" aria-label="Hora (opcional)" />'
        : '') +
      criterionSelect('estimate', 'Tiempo estimado', 'Sin tiempo estimado', model.timeEstimates(), item.estimate) +
      criterionSelect('energy', 'Nivel de energía', 'Sin nivel de energía', model.energyLevels(), item.energy) +
      criterionSelect('priority', 'Prioridad', 'Sin prioridad', model.priorities(), item.priority) +
      '</div>' +
      '<input type="text" class="field" data-field="waitingFor" value="' + esc(item.waitingFor || '') + '" placeholder="¿De quién esperas respuesta?" aria-label="A la espera de" ' +
      (item.status === model.STATUS.WAITING ? '' : 'style="display:none"') + ' />' +
      '<div class="flex items-center justify-between gap-2 pt-1">' +
      '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="delete" data-id="' + item.id + '">Eliminar</button>' +
      (item.status === model.STATUS.SCHEDULED && item.date && model.gcalEnabled() ? gcalLink(item) : '') +
      '<button type="button" class="btn-primary" data-action="save-item" data-id="' + item.id + '">Guardar</button>' +
      '</div>' +
      '</div>'
    );
  }

  function list(items, options) {
    if (!items.length) return '';
    return '<ul>' + items.map(function (item) { return itemRow(item, options); }).join('') + '</ul>';
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
      html += list(visible);
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

    html +=
      '<form id="project-item-form" class="card flex items-center gap-2 px-3 py-2 mb-6" data-project-id="' + project.id + '">' +
      '<input type="text" id="project-item-input" class="flex-1 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="Añadir próxima acción…" autocomplete="off" />' +
      '<button type="submit" class="btn-primary">Añadir</button>' +
      '</form>';

    if (open.length) html += list(open);
    else html += emptyState('✨', 'Nada pendiente en este proyecto.');

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
    html += list(items);
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
      html += '<ul>' + items.map(function (item) {
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
    html += list(items);
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

    html += sectionTitle('Sincronización entre dispositivos');
    html += '<div class="card px-4 py-4 space-y-3">';
    var syncStatus = global.GTD.syncer.status();
    // Which setup form (if any) is shown: the picker's choice on a fresh
    // setup, or the backend being added to an already-configured device.
    var formProvider = null;
    if (!syncStatus.configured) {
      formProvider = syncProvider;
    } else if (syncAddProvider === 'gdrive' && !syncStatus.hasGdrive) {
      formProvider = 'gdrive';
    } else if (syncAddProvider === 'server' && !syncStatus.hasServer) {
      formProvider = 'server';
    }

    if (syncStatus.configured) {
      // One block per connected backend; both can be active at once and the
      // deterministic merge keeps them convergent (a device connected to
      // both bridges devices that only use one).
      syncStatus.backends.forEach(function (b) {
        var lastText = b.lastSyncAt
          ? 'Última sincronización: ' + model.formatDate(b.lastSyncAt) + '.'
          : 'Aún sin sincronizar.';
        html += '<div class="space-y-2">';
        if (b.provider === 'gdrive') {
          html += '<p class="text-sm text-stone-500 dark:text-stone-400">Conectado a tu Google Drive. ' + lastText + '</p>';
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Tus datos se suben cifrados a la carpeta de datos de aplicaciones de tu Google Drive ' +
            '(<code>appDataFolder</code>), que no aparece entre tus archivos. Cada dispositivo guarda ' +
            'ahí su propio archivo; el de este es <code class="break-all">' + esc(syncStatus.fileName) + '</code>. ' +
            'Puedes ver el espacio que ocupa o borrarla en «Gestionar aplicaciones», dentro de ' +
            '<a href="https://drive.google.com/drive/settings" target="_blank" rel="noopener" class="text-accent underline">los ajustes de Google Drive en la web</a>. ' +
            'La app móvil de Drive no tiene esa opción: abre el enlace en un navegador (si no aparece, ' +
            'activa «Versión para ordenador»).' +
            '</p>';
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Si tu proyecto de Google sigue en modo «Testing», te pedirá autorizar de nuevo cada 7 días; ' +
            'publícalo en producción para evitarlo.' +
            '</p>';
          // The Client ID is not a secret (it travels in the OAuth URL);
          // showing it here saves the trip to the Google console when
          // connecting another device — only the passphrase must be retyped.
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Para conectar otro dispositivo usa este mismo ID de cliente (y tu frase de cifrado): ' +
            '<code class="break-all">' + esc(b.clientId || '') + '</code> ' +
            '<button type="button" class="btn-ghost" data-action="copy-value" data-value="' + esc(b.clientId || '') + '">Copiar</button>' +
            '</p>';
        } else {
          html +=
            '<p class="text-sm text-stone-500 dark:text-stone-400">Conectado a tu servidor ' +
            '(<code class="break-all">' + esc(b.serverUrl || '') + '</code>). ' + lastText + '</p>';
          html +=
            '<p class="text-xs text-stone-400 dark:text-stone-500">' +
            'Cada dispositivo guarda su propio archivo cifrado en el servidor; el de este es ' +
            '<code class="break-all">' + esc(syncStatus.fileName) + '</code>. ' +
            'El archivo de llave (protegido con contraseña) configura tus otros dispositivos sin teclear nada.' +
            '</p>';
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
      if (!formProvider) {
        // A second, redundant destination: same encrypted files everywhere.
        if (!syncStatus.hasGdrive) {
          html += '<button type="button" class="btn-secondary" data-action="sync-add-backend" data-provider="gdrive">Añadir Google Drive</button>';
        }
        if (!syncStatus.hasServer) {
          html += '<button type="button" class="btn-secondary" data-action="sync-add-backend" data-provider="server">Añadir servidor propio</button>';
        }
      }
      html += '</div>';
    } else {
      html +=
        '<p class="text-sm text-stone-500 dark:text-stone-400">' +
        'Opcional: guarda una copia cifrada de tus datos y mantén makeGTD igual en tu móvil, portátil u otros ' +
        'dispositivos. Los datos se cifran en este dispositivo antes de subirse: el destino nunca puede leerlos. ' +
        'Puedes activar más de un destino después.' +
        '</p>';
      html +=
        '<label class="block">' +
        '<span class="block">Dónde guardar la copia</span>' +
        '<select id="sync-provider-select" class="field mt-1">' +
        '<option value="gdrive"' + (syncProvider === 'gdrive' ? ' selected' : '') + '>Google Drive (tu cuenta de Google)</option>' +
        '<option value="server"' + (syncProvider === 'server' ? ' selected' : '') + '>Servidor propio (autoalojado)</option>' +
        '</select>' +
        '</label>';
    }
    if (formProvider === 'server') {
        html +=
          '<p class="text-xs text-stone-400 dark:text-stone-500">' +
          'Un servidor pequeño y portable que guarda tus copias cifradas. En la carpeta ' +
          '<a href="https://github.com/leobrines/makegtd/tree/main/server" target="_blank" rel="noopener" class="text-accent underline"><code>server/</code> del proyecto</a> ' +
          'tienes una implementación de referencia (un solo archivo, sin dependencias) y el protocolo por si ' +
          'prefieres montar el tuyo (p. ej. sobre S3). Se configura como un proxy: dirección y clave — ' +
          'o importa el archivo de llave exportado desde otro dispositivo ya conectado.' +
          '</p>';
      }
      if (formProvider === 'gdrive') html +=
        '<details class="text-sm">' +
        '<summary class="cursor-pointer min-h-[44px] flex items-center text-accent">Guía: crear tu acceso en Google (una sola vez)</summary>' +
        '<p class="text-xs text-stone-400 dark:text-stone-500 mt-2 mb-2">' +
        'Cada enlace abre la página exacta de la consola de Google; inicia sesión con tu cuenta. ' +
        'Desde el móvil usa el navegador (la app de Google Cloud no permite crear credenciales); ' +
        'si algo no aparece, activa «Versión para ordenador».' +
        '</p>' +
        '<ol class="list-decimal ml-5 space-y-2 text-stone-600 dark:text-stone-300">' +
        '<li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener" class="text-accent underline">Crea un proyecto nuevo</a> ' +
        '(nombre libre, p. ej. «makegtd»).</li>' +
        '<li><a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener" class="text-accent underline">Habilita la Google Drive API</a> ' +
        'en ese proyecto (botón «Habilitar»).</li>' +
        '<li><a href="https://console.cloud.google.com/auth/overview/create" target="_blank" rel="noopener" class="text-accent underline">Registra la app en Google Auth Platform</a>: ' +
        'nombre de la app, tu correo y público «Externo»/External.</li>' +
        '<li><a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener" class="text-accent underline">Crea el cliente OAuth</a>: ' +
        'tipo «Aplicación web». En «Orígenes de JavaScript autorizados» añade:<br />' +
        '<code class="break-all">' + esc(syncStatus.origin) + '</code> ' +
        '<button type="button" class="btn-ghost" data-action="copy-value" data-value="' + esc(syncStatus.origin) + '">Copiar</button><br />' +
        'y en «URI de redireccionamiento autorizados» añade:<br />' +
        '<code class="break-all">' + esc(syncStatus.redirectUri) + '</code> ' +
        '<button type="button" class="btn-ghost" data-action="copy-value" data-value="' + esc(syncStatus.redirectUri) + '">Copiar</button></li>' +
        '<li><a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener" class="text-accent underline">Publica la aplicación</a> ' +
        '(«Publish app»): el permiso que usa makeGTD (solo los datos de la propia app en tu Drive) no es sensible ' +
        'y no requiere verificación de Google. Si prefieres dejarla en modo «Testing», añade tu correo como usuario ' +
        'de prueba, pero tendrás que volver a autorizar cada 7 días.</li>' +
        '<li>Copia el «ID de cliente» (termina en <code>.apps.googleusercontent.com</code>) y pégalo aquí abajo. ' +
        'Los cambios en Google pueden tardar unos minutos en activarse.</li>' +
        '</ol></details>';
    if (formProvider) {
      html += '<form id="sync-config-form" class="space-y-3">';
      if (formProvider === 'gdrive') {
        html +=
          '<label class="block">' +
          '<span class="block">ID de cliente de Google</span>' +
          '<input type="text" id="sync-client-id" name="client-id" class="field mt-1" placeholder="…apps.googleusercontent.com" autocomplete="off" />' +
          '</label>';
      } else {
        html +=
          '<label class="block">' +
          '<span class="block">Dirección del servidor</span>' +
          '<input type="text" id="sync-server-url" class="field mt-1" placeholder="https://sync.midominio.com" autocomplete="off" inputmode="url" />' +
          '</label>';
        html +=
          '<label class="block">' +
          '<span class="block">Clave de acceso</span>' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5 mb-1">' +
          'La clave con la que arrancaste el servidor (<code>ACCESS_KEY</code>).' +
          '</span>' +
          '<input type="password" id="sync-server-key" class="field" autocomplete="off" />' +
          '</label>';
        html +=
          '<label class="btn-secondary cursor-pointer inline-block">Importar archivo de llave…' +
          '<input type="file" id="sync-keyfile-input" accept="application/json,.json" class="hidden" />' +
          '</label>';
      }
      // Hidden username so password managers (Bitwarden, Chrome…) save the
      // generated passphrase as a complete credential for this origin.
      html += '<input type="hidden" name="username" value="makeGTD" autocomplete="username" />';
      if (!syncStatus.configured) {
        html +=
          '<label class="block">' +
          '<span class="block">Frase de cifrado</span>' +
          '<span class="block text-xs text-stone-400 dark:text-stone-500 mt-0.5 mb-1">' +
          'Una contraseña que inventas tú: con ella se cifran tus datos en este dispositivo ' +
          'antes de subirse. Elige una larga —varias palabras que recuerdes— o genera una segura con el ' +
          'botón y guárdala en tu gestor de contraseñas. Tendrás que escribir la misma en cada dispositivo que ' +
          'conectes. No se puede recuperar: si la olvidas, la copia remota será ilegible (tus dispositivos ' +
          'conservan sus datos).' +
          '</span>' +
          '<span class="flex gap-2">' +
          '<input type="password" id="sync-passphrase" name="passphrase" class="field flex-1" autocomplete="new-password" />' +
          '<button type="button" class="btn-secondary shrink-0" data-action="sync-generate-passphrase">Generar</button>' +
          '<button type="button" class="btn-ghost shrink-0" data-action="toggle-passphrase" aria-pressed="false">Mostrar</button>' +
          '</span>' +
          '</label>';
      }
      // Adding a second destination reuses the stored passphrase: the
      // encrypted files must be identical on every backend.
      html += '<div class="flex flex-wrap gap-2">';
      html +=
        '<button type="submit" class="btn-primary">' +
        (formProvider === 'gdrive' ? 'Guardar y conectar con Google' : 'Guardar y sincronizar') +
        '</button>';
      if (syncStatus.configured) {
        html += '<button type="button" class="btn-ghost" data-action="sync-add-cancel">Cancelar</button>';
      }
      html += '</div>';
      html += '</form>';
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

  // ---- Event wiring (delegated once) ----

  var currentContextFilter = '';

  // Provider selected in the sync setup form (before it is configured).
  var syncProvider = 'gdrive';

  // Backend being added from an already-configured device ('gdrive',
  // 'server' or null when no add-form is open).
  var syncAddProvider = null;

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
    $view.on('change', '[data-field="status"]', function () {
      var $editor = $(this).closest('[data-editor-for]');
      $editor.find('[data-field="waitingFor"]').toggle($(this).val() === model.STATUS.WAITING);
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
      store.addItem({ title: title, status: model.STATUS.NEXT, projectId: projectId });
      refresh();
      $('#project-item-input').trigger('focus');
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
          global.alert(
            'PROTECCIÓN ACTIVADA\n\nTu código de recuperación es:\n\n' +
              code +
              '\n\nGuárdalo ahora en tu gestor de contraseñas. Es la única forma de ' +
              'recuperar tus datos si pierdes la biometría.'
          );
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
          global.alert('NUEVO código de recuperación:\n\n' + next + '\n\nGuárdalo; el anterior ya no sirve.');
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

    $view.on('change', '#sync-provider-select', function () {
      syncProvider = $(this).val();
      refresh();
    });

    $view.on('submit', '#sync-config-form', function (e) {
      e.preventDefault();
      // The passphrase field only exists on a fresh setup; when adding a
      // second backend the stored passphrase is reused (empty value).
      var passphrase = $('#sync-passphrase').val() || '';
      if ($('#sync-client-id').length) {
        if (!global.GTD.syncer.setGdriveConfig($('#sync-client-id').val(), passphrase)) {
          toast('Faltan el ID de cliente o la frase de cifrado');
          return;
        }
      } else if (
        !global.GTD.syncer.setServerConfig($('#sync-server-url').val(), $('#sync-server-key').val(), passphrase)
      ) {
        toast('Revisa la dirección del servidor, la clave y la frase de cifrado');
        return;
      }
      syncAddProvider = null;
      syncNow(); // On Google Drive, the first sync triggers the consent redirect.
    });

    $view.on('click', '[data-action="sync-add-backend"]', function () {
      syncAddProvider = $(this).data('provider');
      refresh();
    });

    $view.on('click', '[data-action="sync-add-cancel"]', function () {
      syncAddProvider = null;
      refresh();
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

    $view.on('click', '[data-action="toggle-passphrase"]', function () {
      var $input = $('#sync-passphrase');
      var show = $input.attr('type') === 'password';
      $input.attr('type', show ? 'text' : 'password');
      $(this).text(show ? 'Ocultar' : 'Mostrar').attr('aria-pressed', String(show));
    });

    $view.on('click', '[data-action="sync-now"]', syncNow);

    // Key file import: fills the server form from a (usually encrypted)
    // key file exported on an already-configured device.
    $view.on('change', '#sync-keyfile-input', function () {
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
            $('#sync-server-url').val(data.url);
            $('#sync-server-key').val(data.key);
            // The passphrase field only exists on a fresh setup; when adding
            // a backend the stored passphrase is reused instead.
            if (data.passphrase && $('#sync-passphrase').length) $('#sync-passphrase').val(data.passphrase);
            input.value = '';
            toast('Archivo de llave importado: revisa y pulsa guardar');
          })
          .catch(function (err) {
            input.value = '';
            toast(err && err.message === 'decrypt-failed' ? 'Contraseña del archivo incorrecta' : 'El archivo de llave no es válido');
          });
      };
      reader.readAsText(file);
    });

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

    // Fills the field with a strong random phrase (~79 bits; confusable
    // characters excluded) and reveals it so the user can write it down.
    $view.on('click', '[data-action="sync-generate-passphrase"]', function () {
      $('#sync-passphrase').attr('type', 'text').val(randomPassphrase());
      $view.find('[data-action="toggle-passphrase"]').text('Ocultar').attr('aria-pressed', 'true');
      toast('Frase generada: guárdala antes de continuar');
    });

    $view.on('click', '[data-action="copy-ai-prompt"]', function () {
      var key = $(this).data('prompt');
      if (key === 'horizons-review') copyToClipboard(buildHorizonsReviewPrompt());
    });

    $view.on('click', '[data-action="copy-value"]', function () {
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
    },
  };
})(window, jQuery);
