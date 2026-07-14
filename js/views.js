/* View rendering. All user-facing strings are Spanish; code is English. */
(function (global, $) {
  'use strict';

  var store = global.GTD.store;
  var model = global.GTD.model;

  // Which item row is expanded into its inline editor (progressive disclosure).
  var expandedItemId = null;

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
      '<h2 class="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mt-8 mb-2 px-1">' +
      esc(text) + (extra || '') +
      '</h2>'
    );
  }

  function itemMeta(item) {
    var bits = [];
    if (item.context) bits.push('<span>' + esc(item.context) + '</span>');
    if (item.projectId) {
      var project = store.getProject(item.projectId);
      if (project) bits.push('<span>▸ ' + esc(project.name) + '</span>');
    }
    if (item.status === model.STATUS.SCHEDULED && item.date) {
      var overdue = item.date < model.todayISO();
      bits.push(
        '<span class="' + (overdue ? 'text-red-600 dark:text-red-400' : '') + '">' +
        esc(model.formatDate(item.date)) + '</span>'
      );
    }
    if (item.status === model.STATUS.WAITING && item.waitingFor) {
      bits.push('<span>' + esc(item.waitingFor) + '</span>');
    }
    if (item.status === model.STATUS.SOMEDAY && item.tickleDate) {
      bits.push('<span>Vuelve el ' + esc(model.formatDate(item.tickleDate)) + '</span>');
    }
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
  function gcalLink(item, withLabel) {
    return (
      '<a href="' + esc(model.gcalUrl(item)) + '" target="_blank" rel="noopener noreferrer" ' +
      'class="btn-ghost shrink-0 gap-2" aria-label="Añadir a Google Calendar">' +
      gcalIcon() +
      (withLabel ? '<span class="text-sm">Google Calendar</span>' : '') +
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
      html += '<option value="' + s + '"' + (s === selected ? ' selected' : '') + '>' +
        esc(model.STATUS_LABELS[s]) + '</option>';
    });
    return html;
  }

  // Inline editor shown under an expanded row.
  function itemEditor(item) {
    return (
      '<div class="border-t border-stone-100 dark:border-stone-800 px-4 py-4 space-y-3" data-editor-for="' + item.id + '">' +
      '<input type="text" class="field" data-field="title" value="' + esc(item.title) + '" aria-label="Título" />' +
      '<textarea class="field" rows="2" data-field="notes" placeholder="Notas (opcional)" aria-label="Notas">' + esc(item.notes) + '</textarea>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<select class="field" data-field="status" aria-label="Lista">' + statusOptions(item.status) + '</select>' +
      '<select class="field" data-field="context" aria-label="Contexto">' + contextOptions(item.context) + '</select>' +
      '<select class="field" data-field="projectId" aria-label="Proyecto">' + projectOptions(item.projectId) + '</select>' +
      '<input type="date" class="field" data-field="date" value="' + esc(item.date || '') + '" aria-label="Fecha" />' +
      '</div>' +
      '<input type="text" class="field" data-field="waitingFor" value="' + esc(item.waitingFor || '') + '" placeholder="¿De quién esperas respuesta?" aria-label="A la espera de" ' +
      (item.status === model.STATUS.WAITING ? '' : 'style="display:none"') + ' />' +
      '<div class="flex items-center justify-between gap-2 pt-1">' +
      '<button type="button" class="btn-ghost text-red-500 dark:text-red-400" data-action="delete" data-id="' + item.id + '">Eliminar</button>' +
      (item.status === model.STATUS.SCHEDULED && item.date ? gcalLink(item, false) : '') +
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
      '<form id="inbox-capture" class="card flex items-center gap-2 px-3 py-2 mb-6">' +
      '<input type="text" id="inbox-input" class="flex-1 min-h-[44px] bg-transparent outline-none px-1 placeholder-stone-400 dark:placeholder-stone-500" placeholder="¿Qué tienes en la cabeza?" autocomplete="off" />' +
      '<button type="submit" class="btn-primary">Capturar</button>' +
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
    var html = header('Próximas acciones', 'Una lista, un contexto, una acción.');

    if (items.length) {
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
      var count = model.projectItems(p.id).filter(function (i) { return i.status !== 'done'; }).length;
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
    var open = items.filter(function (i) { return i.status !== 'done'; });
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
      return '<ul>' + items.map(function (item) {
        return itemRow(item, { trailing: gcalLink(item, false) });
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

  function renderReference() {
    var items = model.referenceItems();
    var html = header('Referencia', 'Material útil que no requiere acción.');
    if (!items.length) return html + emptyState('📚', 'Sin material de referencia todavía.');
    html += list(items);
    return html;
  }

  function renderSettings() {
    var contexts = store.getContexts();
    var html = header('Ajustes');

    html += sectionTitle('Contextos');
    html += '<div class="card px-4 py-4">';
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
      '</form></div>';

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
        context: $editor.find('[data-field="context"]').val() || null,
        projectId: $editor.find('[data-field="projectId"]').val() || null,
        date: $editor.find('[data-field="date"]').val() || null,
        waitingFor: $editor.find('[data-field="waitingFor"]').val() || null,
      };
      if (fields.status === model.STATUS.SCHEDULED && !fields.date) fields.status = model.STATUS.NEXT;
      if (fields.status !== model.STATUS.SCHEDULED) fields.date = null;
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
      toast('Eliminada');
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

    // Inbox capture form.
    $view.on('submit', '#inbox-capture', function (e) {
      e.preventDefault();
      var $input = $('#inbox-input');
      var title = $input.val().trim();
      if (!title) return;
      store.addItem({ title: title });
      $input.val('');
      refresh();
      $('#inbox-input').trigger('focus');
    });

    // Next actions: context filter chips.
    $view.on('click', '[data-action="filter-context"]', function () {
      currentContextFilter = $(this).data('context') || '';
      refresh();
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
      var open = model.projectItems(id).filter(function (i) { return i.status !== model.STATUS.DONE; });
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

    $view.on('click', '[data-action="delete-project"]', function () {
      if (!global.confirm('¿Eliminar este proyecto? Sus tareas quedarán sin proyecto.')) return;
      store.removeProject($(this).data('id'));
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

    // Settings.
    $view.on('submit', '#context-form', function (e) {
      e.preventDefault();
      var name = $('#context-input').val();
      if (store.addContext(name)) refresh();
    });
    $view.on('click', '[data-action="remove-context"]', function () {
      store.removeContext($(this).data('context'));
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
    renderWaiting: renderWaiting,
    renderSomeday: renderSomeday,
    renderReference: renderReference,
    renderSettings: renderSettings,
    collapseEditor: function () {
      expandedItemId = null;
    },
  };
})(window, jQuery);
