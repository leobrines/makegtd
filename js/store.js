/* Persistence layer: whole app state lives under a single versioned localStorage key. */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'gtd:data:v1';

  var DEFAULT_CONTEXTS = ['@casa', '@trabajo', '@recados', '@llamadas', '@ordenador'];

  // Default value lists for the Engage four-criteria model (GTD book,
  // "Engaging" chapter: context, time available, energy available, priority;
  // the vendored PDFs cover contexts but not the model itself). Each list is
  // user-editable in Settings; emptying a list hides that field everywhere.
  var DEFAULT_TIME_ESTIMATES = ['5 min', '15 min', '30 min', '1 h', '2 h+'];
  var DEFAULT_ENERGY_LEVELS = ['Alta', 'Media', 'Baja'];
  var DEFAULT_PRIORITIES = ['Alta', 'Media', 'Baja'];

  // Settings keys of the editable criterion lists -> item field each one feeds.
  var CRITERIA = {
    timeEstimates: 'estimate',
    energyLevels: 'energy',
    priorities: 'priority',
  };

  function defaultState() {
    return {
      version: 1,
      items: [],
      projects: [],
      // Higher horizons of focus (Levels of Your Work): entries for horizons
      // 2 (areas of focus) through 5 (purpose and principles).
      horizons: [],
      contexts: DEFAULT_CONTEXTS.slice(),
      trash: {
        items: [],
        projects: [],
        horizons: [],
      },
      settings: {
        lastReviewAt: null,
        focusDate: null,
        // Contexts are optional in GTD (Setup Guide: a single "Todas" list is
        // fine); this flag hides the whole feature across the app when false.
        contextsEnabled: true,
        // Reference is a canonical section but may live outside the app; this
        // flag hides the list, the nav entry and the Clarify choice when false.
        referenceEnabled: true,
        // "Add to Google Calendar" buttons (the app's only outward link).
        gcalEnabled: true,
        // Global 'n' keyboard shortcut for quick capture (the FAB always works).
        captureShortcutEnabled: true,
        // Preferred weekday for the weekly review: 0 (Sunday) … 6 (Saturday),
        // or null to fall back to the plain "7 days since last review" rule.
        reviewDay: null,
        timeEstimates: DEFAULT_TIME_ESTIMATES.slice(),
        energyLevels: DEFAULT_ENERGY_LEVELS.slice(),
        priorities: DEFAULT_PRIORITIES.slice(),
        // Per-criterion on/off switches (like contextsEnabled): turning one
        // off hides the field everywhere but keeps its value list and the
        // values stored on items, so re-enabling restores everything.
        timeEstimatesEnabled: true,
        energyLevelsEnabled: true,
        prioritiesEnabled: true,
      },
    };
  }

  var state = null;

  function load() {
    if (state) return state;
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaultState();
    } catch (err) {
      // Corrupted storage: start fresh rather than crash. Keep a backup copy.
      try {
        global.localStorage.setItem(STORAGE_KEY + ':corrupted', global.localStorage.getItem(STORAGE_KEY) || '');
      } catch (ignored) {}
      state = defaultState();
    }
    return state;
  }

  function migrate(data) {
    var base = defaultState();
    if (!data || typeof data !== 'object') return base;
    data.version = 1;
    data.items = Array.isArray(data.items) ? data.items : base.items;
    data.projects = Array.isArray(data.projects) ? data.projects : base.projects;
    data.horizons = Array.isArray(data.horizons) ? data.horizons : base.horizons;
    data.contexts = Array.isArray(data.contexts) && data.contexts.length ? data.contexts : base.contexts;
    var trash = data.trash && typeof data.trash === 'object' ? data.trash : {};
    data.trash = {
      items: Array.isArray(trash.items) ? trash.items : [],
      projects: Array.isArray(trash.projects) ? trash.projects : [],
      horizons: Array.isArray(trash.horizons) ? trash.horizons : [],
    };
    data.settings = Object.assign({}, base.settings, data.settings || {});
    Object.keys(CRITERIA).forEach(function (key) {
      if (!Array.isArray(data.settings[key])) data.settings[key] = base.settings[key];
    });
    return data;
  }

  function save() {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(load()));
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // ---- Items ----

  function getItems() {
    return load().items;
  }

  function getItem(id) {
    var items = load().items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function addItem(fields) {
    var now = new Date().toISOString();
    var item = Object.assign(
      {
        id: uid(),
        title: '',
        notes: '',
        status: 'inbox',
        projectId: null,
        context: null,
        date: null,
        time: null,
        tickleDate: null,
        waitingFor: null,
        estimate: null,
        energy: null,
        priority: null,
        isFocus: false,
        createdAt: now,
        completedAt: null,
        updatedAt: now,
      },
      fields
    );
    load().items.push(item);
    save();
    return item;
  }

  function updateItem(id, fields) {
    var item = getItem(id);
    if (!item) return null;
    Object.assign(item, fields, { updatedAt: new Date().toISOString() });
    save();
    return item;
  }

  // Deleting is recoverable: the item moves to the trash and only leaves the
  // system for good when the trash is emptied.
  function removeItem(id) {
    var s = load();
    for (var i = 0; i < s.items.length; i++) {
      if (s.items[i].id === id) {
        var item = s.items.splice(i, 1)[0];
        item.isFocus = false;
        item.deletedAt = new Date().toISOString();
        s.trash.items.push(item);
        save();
        return true;
      }
    }
    return false;
  }

  // Hard delete, skipping the trash. Only for internal replacements (e.g. an
  // inbox item transformed into a project during Clarify), never for the
  // user-facing delete actions.
  function destroyItem(id) {
    var items = load().items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        items.splice(i, 1);
        save();
        return true;
      }
    }
    return false;
  }

  // ---- Projects ----

  function getProjects() {
    return load().projects;
  }

  function getProject(id) {
    var projects = load().projects;
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].id === id) return projects[i];
    }
    return null;
  }

  function addProject(fields) {
    var project = Object.assign(
      {
        id: uid(),
        name: '',
        outcome: '',
        status: 'active',
        createdAt: new Date().toISOString(),
      },
      fields
    );
    load().projects.push(project);
    save();
    return project;
  }

  function updateProject(id, fields) {
    var project = getProject(id);
    if (!project) return null;
    Object.assign(project, fields);
    save();
    return project;
  }

  // Recoverable, like removeItem. Items keep their projectId while the project
  // sits in the trash (so restoring relinks them); links are only cut for good
  // when the trash is emptied.
  function removeProject(id) {
    var s = load();
    for (var i = 0; i < s.projects.length; i++) {
      if (s.projects[i].id === id) {
        var project = s.projects.splice(i, 1)[0];
        project.deletedAt = new Date().toISOString();
        s.trash.projects.push(project);
        save();
        return true;
      }
    }
    return false;
  }

  // ---- Horizons of focus (levels 2-5) ----

  function getHorizons() {
    return load().horizons;
  }

  function getHorizon(id) {
    var horizons = load().horizons;
    for (var i = 0; i < horizons.length; i++) {
      if (horizons[i].id === id) return horizons[i];
    }
    return null;
  }

  function addHorizon(level, text) {
    text = String(text || '').trim();
    level = Number(level);
    if (!text || level < 2 || level > 5) return null;
    var horizon = {
      id: uid(),
      level: level,
      text: text,
      createdAt: new Date().toISOString(),
    };
    load().horizons.push(horizon);
    save();
    return horizon;
  }

  function updateHorizon(id, fields) {
    var horizon = getHorizon(id);
    if (!horizon) return null;
    Object.assign(horizon, fields);
    save();
    return horizon;
  }

  // Recoverable, like removeItem: the entry waits in the trash.
  function removeHorizon(id) {
    var s = load();
    for (var i = 0; i < s.horizons.length; i++) {
      if (s.horizons[i].id === id) {
        var horizon = s.horizons.splice(i, 1)[0];
        horizon.deletedAt = new Date().toISOString();
        s.trash.horizons.push(horizon);
        save();
        return true;
      }
    }
    return false;
  }

  // ---- Trash ----

  function getTrash() {
    return load().trash;
  }

  function restoreItem(id) {
    var s = load();
    for (var i = 0; i < s.trash.items.length; i++) {
      if (s.trash.items[i].id === id) {
        var item = s.trash.items.splice(i, 1)[0];
        delete item.deletedAt;
        s.items.push(item);
        save();
        return item;
      }
    }
    return null;
  }

  function restoreProject(id) {
    var s = load();
    for (var i = 0; i < s.trash.projects.length; i++) {
      if (s.trash.projects[i].id === id) {
        var project = s.trash.projects.splice(i, 1)[0];
        delete project.deletedAt;
        s.projects.push(project);
        save();
        return project;
      }
    }
    return null;
  }

  function restoreHorizon(id) {
    var s = load();
    for (var i = 0; i < s.trash.horizons.length; i++) {
      if (s.trash.horizons[i].id === id) {
        var horizon = s.trash.horizons.splice(i, 1)[0];
        delete horizon.deletedAt;
        s.horizons.push(horizon);
        save();
        return horizon;
      }
    }
    return null;
  }

  // The only truly destructive delete: once emptied, nothing comes back.
  function emptyTrash() {
    var s = load();
    // Projects are gone for good now, so cut the links that restore relied on.
    s.trash.projects.forEach(function (project) {
      s.items.forEach(function (item) {
        if (item.projectId === project.id) item.projectId = null;
      });
    });
    s.trash = { items: [], projects: [], horizons: [] };
    save();
  }

  // ---- Contexts ----

  function getContexts() {
    return load().contexts;
  }

  function addContext(name) {
    name = String(name || '').trim();
    if (!name) return false;
    if (name.charAt(0) !== '@') name = '@' + name;
    name = name.toLowerCase().replace(/\s+/g, '-');
    var contexts = load().contexts;
    if (contexts.indexOf(name) !== -1) return false;
    contexts.push(name);
    save();
    return name;
  }

  function removeContext(name) {
    var s = load();
    s.contexts = s.contexts.filter(function (c) {
      return c !== name;
    });
    s.items.forEach(function (item) {
      if (item.context === name) item.context = null;
    });
    save();
  }

  // ---- Engage criteria value lists (time estimate / energy / priority) ----

  function getCriterionValues(key) {
    if (!CRITERIA.hasOwnProperty(key)) return [];
    return load().settings[key];
  }

  function addCriterionValue(key, name) {
    if (!CRITERIA.hasOwnProperty(key)) return false;
    name = String(name || '').trim();
    if (!name) return false;
    var values = load().settings[key];
    var exists = values.some(function (v) {
      return v.toLowerCase() === name.toLowerCase();
    });
    if (exists) return false;
    values.push(name);
    save();
    return name;
  }

  function removeCriterionValue(key, name) {
    if (!CRITERIA.hasOwnProperty(key)) return;
    var s = load();
    s.settings[key] = s.settings[key].filter(function (v) {
      return v !== name;
    });
    var field = CRITERIA[key];
    s.items.forEach(function (item) {
      if (item[field] === name) item[field] = null;
    });
    s.trash.items.forEach(function (item) {
      if (item[field] === name) item[field] = null;
    });
    save();
  }

  // ---- Settings ----

  function getSettings() {
    return load().settings;
  }

  function updateSettings(fields) {
    Object.assign(load().settings, fields);
    save();
  }

  // ---- Backup ----

  function exportJSON() {
    return JSON.stringify(load(), null, 2);
  }

  function importJSON(text) {
    var data = JSON.parse(text); // Throws on invalid JSON; caller handles it.
    if (!data || !Array.isArray(data.items)) {
      throw new Error('invalid backup');
    }
    state = migrate(data);
    save();
  }

  function clearAll() {
    state = defaultState();
    save();
  }

  global.GTD = global.GTD || {};
  global.GTD.store = {
    load: load,
    save: save,
    getItems: getItems,
    getItem: getItem,
    addItem: addItem,
    updateItem: updateItem,
    removeItem: removeItem,
    destroyItem: destroyItem,
    getProjects: getProjects,
    getProject: getProject,
    addProject: addProject,
    updateProject: updateProject,
    removeProject: removeProject,
    getHorizons: getHorizons,
    getHorizon: getHorizon,
    addHorizon: addHorizon,
    updateHorizon: updateHorizon,
    removeHorizon: removeHorizon,
    getTrash: getTrash,
    restoreItem: restoreItem,
    restoreProject: restoreProject,
    restoreHorizon: restoreHorizon,
    emptyTrash: emptyTrash,
    getContexts: getContexts,
    addContext: addContext,
    removeContext: removeContext,
    getCriterionValues: getCriterionValues,
    addCriterionValue: addCriterionValue,
    removeCriterionValue: removeCriterionValue,
    getSettings: getSettings,
    updateSettings: updateSettings,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
  };
})(window);
