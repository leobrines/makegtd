/* Domain constants and pure helpers. UI strings here are Spanish (user-facing). */
(function (global) {
  'use strict';

  var store = global.GTD.store;

  var STATUS = {
    INBOX: 'inbox',
    NEXT: 'next',
    WAITING: 'waiting',
    SCHEDULED: 'scheduled',
    SOMEDAY: 'someday',
    REFERENCE: 'reference',
    DONE: 'done',
  };

  var STATUS_LABELS = {
    inbox: 'Bandeja de entrada',
    next: 'Próxima acción',
    waiting: 'A la espera',
    scheduled: 'Programada',
    someday: 'Algún día',
    reference: 'Referencia',
    done: 'Hecha',
  };

  var FOCUS_LIMIT = 3;
  var REVIEW_INTERVAL_DAYS = 7;

  // Higher horizons of focus (2-5), per the official "Levels of Your Work"
  // altitude map (docs/gtd/gtd-levels-of-your-work.pdf). Ground (actions) and
  // Horizon 1 (projects) already have their own views, so they are not here.
  // Definitions, timeframes and review cadences follow the official document;
  // Horizon 4's 3-5 year timeframe comes from "The 6 Horizons of Focus"
  // (gettingthingsdone.com). Rendered top of the page first = Horizon 2, the
  // level closest to your projects.
  var HORIZONS = [
    {
      level: 2,
      title: 'Áreas de enfoque y responsabilidad',
      description:
        'Las esferas importantes de tu trabajo y tu vida que debes mantener en buen estado ' +
        'para que «el motor siga funcionando». No se terminan: se mantienen. ' +
        'Revísalas una vez al mes o cuando tu trabajo o tu vida cambien.',
      placeholder: 'Ej.: Salud · Finanzas · Familia · Ventas…',
      help: true,
    },
    {
      level: 3,
      title: 'Metas y objetivos',
      description:
        '¿Qué quieres y necesitas lograr, en concreto, en los próximos 12–24 meses ' +
        'para hacer realidad tu visión? Revísalas cada año y recalibra cada trimestre.',
      placeholder: 'Ej.: Terminar el grado antes de junio',
    },
    {
      level: 4,
      title: 'Visión',
      description:
        'Cómo se verá, sonará y sentirá el éxito a 3–5 años: resultados a largo plazo ' +
        'y escenarios ideales. Revísala cuando necesites claridad, dirección o motivación.',
      placeholder: 'Ej.: Vivir del taller propio en el campo',
    },
    {
      level: 5,
      title: 'Propósito y principios',
      description:
        'La intención última de lo que haces y los estándares para su éxito. ' +
        '¿Por qué lo haces? ¿Qué comportamientos son innegociables? ' +
        'Revísalo cuando necesites claridad, dirección o motivación.',
      placeholder: 'Ej.: Ayudar a otros a lograr sus sueños',
    },
  ];

  // Local date as YYYY-MM-DD (never UTC, to avoid off-by-one around midnight).
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function byStatus(status) {
    return store.getItems().filter(function (item) {
      return item.status === status;
    });
  }

  function inboxItems() {
    return byStatus(STATUS.INBOX);
  }

  function nextActions() {
    return byStatus(STATUS.NEXT);
  }

  function waitingItems() {
    return byStatus(STATUS.WAITING);
  }

  function scheduledItems() {
    return byStatus(STATUS.SCHEDULED).sort(function (a, b) {
      return (a.date || '') < (b.date || '') ? -1 : 1;
    });
  }

  function somedayItems() {
    return byStatus(STATUS.SOMEDAY);
  }

  function referenceItems() {
    return byStatus(STATUS.REFERENCE);
  }

  function doneItems() {
    return byStatus(STATUS.DONE).sort(function (a, b) {
      return (a.completedAt || '') > (b.completedAt || '') ? -1 : 1;
    });
  }

  // Trash queries: newest deletions first.
  function byDeletedAt(a, b) {
    return (a.deletedAt || '') > (b.deletedAt || '') ? -1 : 1;
  }

  function trashedItems() {
    return store.getTrash().items.slice().sort(byDeletedAt);
  }

  function trashedProjects() {
    return store.getTrash().projects.slice().sort(byDeletedAt);
  }

  function overdueItems() {
    var today = todayISO();
    return scheduledItems().filter(function (item) {
      return item.date && item.date < today;
    });
  }

  function dueTodayItems() {
    var today = todayISO();
    return scheduledItems().filter(function (item) {
      return item.date === today;
    });
  }

  function upcomingItems() {
    var today = todayISO();
    return scheduledItems().filter(function (item) {
      return item.date && item.date > today;
    });
  }

  // Google Calendar "add event" URL. All-day by default (end date exclusive);
  // with an optional HH:MM time it becomes a one-hour timed event in floating
  // local time (Google applies the user's calendar timezone).
  // Format per https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs
  function gcalUrl(item) {
    var date = (item.date || todayISO()).slice(0, 10);
    var parts = date.split('-');
    var dates;
    if (item.time && /^\d{1,2}:\d{2}$/.test(item.time)) {
      var hm = item.time.split(':');
      var start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), Number(hm[0]), Number(hm[1]));
      var end = new Date(start.getTime() + 60 * 60 * 1000);
      dates = localStamp(start) + '/' + localStamp(end);
    } else {
      var next = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1);
      dates = date.replace(/-/g, '') + '/' +
        next.getFullYear() + pad(next.getMonth() + 1) + pad(next.getDate());
    }
    var url =
      'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(item.title || '') +
      '&dates=' + dates;
    if (item.notes) url += '&details=' + encodeURIComponent(item.notes);
    return url;
  }

  function localStamp(d) {
    return (
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'
    );
  }

  // Focus tasks are reset each day: settings.focusDate marks the day they belong to.
  function ensureFocusIsCurrent() {
    var settings = store.getSettings();
    var today = todayISO();
    if (settings.focusDate !== today) {
      store.getItems().forEach(function (item) {
        if (item.isFocus) item.isFocus = false;
      });
      store.updateSettings({ focusDate: today });
    }
  }

  function focusItems() {
    ensureFocusIsCurrent();
    return store.getItems().filter(function (item) {
      return item.isFocus && item.status !== STATUS.DONE;
    });
  }

  function canAddFocus() {
    return focusItems().length < FOCUS_LIMIT;
  }

  function toggleFocus(id) {
    var item = store.getItem(id);
    if (!item) return false;
    if (item.isFocus) {
      store.updateItem(id, { isFocus: false });
      return true;
    }
    if (!canAddFocus()) return false;
    store.updateItem(id, { isFocus: true });
    return true;
  }

  // Whether the contexts feature is on. When off, contexts disappear from the
  // whole UI (lists, editors, Clarify wizard, review) but stored values are
  // kept, so re-enabling brings everything back untouched.
  function contextsEnabled() {
    return store.getSettings().contextsEnabled !== false;
  }

  // Whether the Reference list is on. When off, the nav entry, the view and
  // the Clarify choice disappear; stored reference items are kept (project
  // support material stays visible inside its project).
  function referenceEnabled() {
    return store.getSettings().referenceEnabled !== false;
  }

  // Whether the "add to Google Calendar" buttons are shown.
  function gcalEnabled() {
    return store.getSettings().gcalEnabled !== false;
  }

  // Whether the global 'n' quick-capture shortcut is on (the FAB always works).
  function captureShortcutEnabled() {
    return store.getSettings().captureShortcutEnabled !== false;
  }

  // Engage criteria — the four-criteria model for choosing actions in the
  // moment (GTD book, "Engaging" chapter): context, time available, energy
  // available, priority. Context is its own first-class field; these are the
  // other three, as user-editable value lists.
  //
  // Whether one criterion is on. When off, the field disappears from the
  // whole UI but its value list and the values stored on items are kept, so
  // re-enabling brings everything back untouched (same idea as
  // contextsEnabled).
  function criterionEnabled(key) {
    return store.getSettings()[key + 'Enabled'] !== false;
  }

  // Accessors return an empty list while the criterion is off, which hides
  // the field everywhere (every render site treats an empty list as "off").
  function criterionValues(key) {
    return criterionEnabled(key) ? store.getCriterionValues(key) : [];
  }

  function timeEstimates() {
    return criterionValues('timeEstimates');
  }

  function energyLevels() {
    return criterionValues('energyLevels');
  }

  function priorities() {
    return criterionValues('priorities');
  }

  // Entries of one horizon level (2-5), oldest first (stable, list-like order).
  function horizonItems(level) {
    return store.getHorizons().filter(function (h) {
      return h.level === level;
    });
  }

  function trashedHorizons() {
    return store.getTrash().horizons.slice().sort(byDeletedAt);
  }

  function horizonMeta(level) {
    for (var i = 0; i < HORIZONS.length; i++) {
      if (HORIZONS[i].level === level) return HORIZONS[i];
    }
    return null;
  }

  function activeProjects() {
    return store.getProjects().filter(function (p) {
      return p.status === 'active';
    });
  }

  function somedayProjects() {
    return store.getProjects().filter(function (p) {
      return p.status === 'someday';
    });
  }

  function projectItems(projectId) {
    return store.getItems().filter(function (item) {
      return item.projectId === projectId;
    });
  }

  // A healthy active project has at least one actionable step (next or scheduled).
  function projectHasNextAction(projectId) {
    return store.getItems().some(function (item) {
      return (
        item.projectId === projectId &&
        (item.status === STATUS.NEXT || item.status === STATUS.SCHEDULED || item.status === STATUS.WAITING)
      );
    });
  }

  function stalledProjects() {
    return activeProjects().filter(function (p) {
      return !projectHasNextAction(p.id);
    });
  }

  // Incubate a project (Someday/Maybe): it has no current commitment, so its
  // actionable steps leave the active lists and incubate with it.
  function incubateProject(id) {
    store.updateProject(id, { status: 'someday' });
    store.getItems().forEach(function (item) {
      if (
        item.projectId === id &&
        (item.status === STATUS.NEXT || item.status === STATUS.SCHEDULED)
      ) {
        store.updateItem(item.id, { status: STATUS.SOMEDAY, date: null, isFocus: false });
      }
    });
  }

  // Reactivate an incubated project and bring its parked steps back to Next Actions.
  function activateProject(id) {
    store.updateProject(id, { status: 'active' });
    store.getItems().forEach(function (item) {
      if (item.projectId === id && item.status === STATUS.SOMEDAY) {
        store.updateItem(item.id, { status: STATUS.NEXT, tickleDate: null });
      }
    });
  }

  // Tickler (workflow map: incubate with a date-specific trigger): someday items
  // whose reminder date has arrived come back to the inbox to be clarified again.
  function promoteTickledItems() {
    var today = todayISO();
    var changed = false;
    store.getItems().forEach(function (item) {
      if (item.status === STATUS.SOMEDAY && item.tickleDate && item.tickleDate <= today) {
        item.status = STATUS.INBOX;
        item.tickleDate = null;
        changed = true;
      }
    });
    if (changed) store.save();
  }

  function completeItem(id) {
    return store.updateItem(id, {
      status: STATUS.DONE,
      isFocus: false,
      completedAt: new Date().toISOString(),
    });
  }

  function reopenItem(id) {
    return store.updateItem(id, { status: STATUS.NEXT, completedAt: null });
  }

  function daysSinceReview() {
    var last = store.getSettings().lastReviewAt;
    if (!last) return null;
    var ms = Date.now() - new Date(last).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  // Preferred weekday for the weekly review: 0 (Sunday) … 6 (Saturday), or
  // null to use the plain "7 days since last review" rule.
  function reviewDay() {
    var day = store.getSettings().reviewDay;
    return typeof day === 'number' && day >= 0 && day <= 6 ? day : null;
  }

  function reviewIsDue() {
    var days = daysSinceReview();
    if (days === null) return true;
    var day = reviewDay();
    if (day === null) return days >= REVIEW_INTERVAL_DAYS;
    // Due from the most recent occurrence of the preferred weekday (today
    // included) until a review is completed on or after it.
    var t = todayISO().split('-');
    var today = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
    var occurrence = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - ((today.getDay() - day + 7) % 7)
    );
    var last = new Date(store.getSettings().lastReviewAt);
    var lastISO = last.getFullYear() + '-' + pad(last.getMonth() + 1) + '-' + pad(last.getDate());
    var occurrenceISO = occurrence.getFullYear() + '-' + pad(occurrence.getMonth() + 1) + '-' + pad(occurrence.getDate());
    return lastISO < occurrenceISO;
  }

  // "hace 3 días", "hoy", "ayer" — compact Spanish relative day description.
  function relativeDays(isoDate) {
    if (!isoDate) return '';
    var today = todayISO();
    if (isoDate === today) return 'hoy';
    var diff = Math.round(
      (new Date(today + 'T00:00:00') - new Date(isoDate.slice(0, 10) + 'T00:00:00')) / (24 * 60 * 60 * 1000)
    );
    if (diff === 1) return 'ayer';
    if (diff === -1) return 'mañana';
    if (diff > 1) return 'hace ' + diff + ' días';
    return 'en ' + Math.abs(diff) + ' días';
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    var parts = isoDate.slice(0, 10).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  global.GTD.model = {
    STATUS: STATUS,
    STATUS_LABELS: STATUS_LABELS,
    FOCUS_LIMIT: FOCUS_LIMIT,
    HORIZONS: HORIZONS,
    horizonItems: horizonItems,
    horizonMeta: horizonMeta,
    trashedHorizons: trashedHorizons,
    todayISO: todayISO,
    inboxItems: inboxItems,
    nextActions: nextActions,
    waitingItems: waitingItems,
    scheduledItems: scheduledItems,
    somedayItems: somedayItems,
    referenceItems: referenceItems,
    doneItems: doneItems,
    trashedItems: trashedItems,
    trashedProjects: trashedProjects,
    overdueItems: overdueItems,
    dueTodayItems: dueTodayItems,
    upcomingItems: upcomingItems,
    gcalUrl: gcalUrl,
    contextsEnabled: contextsEnabled,
    referenceEnabled: referenceEnabled,
    gcalEnabled: gcalEnabled,
    captureShortcutEnabled: captureShortcutEnabled,
    criterionEnabled: criterionEnabled,
    timeEstimates: timeEstimates,
    energyLevels: energyLevels,
    priorities: priorities,
    reviewDay: reviewDay,
    focusItems: focusItems,
    canAddFocus: canAddFocus,
    toggleFocus: toggleFocus,
    activeProjects: activeProjects,
    somedayProjects: somedayProjects,
    projectItems: projectItems,
    projectHasNextAction: projectHasNextAction,
    stalledProjects: stalledProjects,
    incubateProject: incubateProject,
    activateProject: activateProject,
    promoteTickledItems: promoteTickledItems,
    completeItem: completeItem,
    reopenItem: reopenItem,
    daysSinceReview: daysSinceReview,
    reviewIsDue: reviewIsDue,
    relativeDays: relativeDays,
    formatDate: formatDate,
  };
})(window);
