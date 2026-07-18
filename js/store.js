/* Persistence layer: whole app state lives as a single versioned document in
 * IndexedDB, written atomically and mirrored in memory. Boot must await
 * GTD.store.init(); after that every accessor is synchronous.
 *
 * Legacy data (the pre-IndexedDB localStorage key) is migrated on first run
 * and the old key is kept as a snapshot backup. When IndexedDB is unavailable
 * or a write fails, saves fall back to that same localStorage key; init picks
 * whichever copy is newer (savedAt), so no fallback write is ever lost. */
(function (global) {
  'use strict';

  var DB_NAME = 'gtd';
  var DB_VERSION = 1;
  var DB_STORE = 'state';
  var DB_KEY = 'gtd:data';

  // Pre-IndexedDB storage key, now the migration source and fallback target.
  var LEGACY_KEY = 'gtd:data:v1';

  var DEFAULT_CONTEXTS = ['@casa', '@trabajo', '@recados', '@llamadas', '@ordenador'];

  // Contexts are entities so deletions sync via tombstones, but their id IS
  // the (normalized) name: there is no rename, the name is the identity, and
  // two devices adding "@casa" independently converge on one entity. Default
  // and legacy-migrated contexts get this epoch timestamp instead of the
  // wall clock so a real deletion (tombstone) or edit on another device
  // always wins over a fresh install or an old un-upgraded document.
  var CONTEXT_EPOCH = '1970-01-01T00:00:00.000Z';

  function contextEntity(name, stampISO) {
    return { id: name, name: name, createdAt: stampISO, updatedAt: stampISO };
  }

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
      version: 3,
      items: [],
      projects: [],
      // Higher horizons of focus (Levels of Your Work): entries for horizons
      // 2 (areas of focus) through 5 (purpose and principles).
      horizons: [],
      contexts: DEFAULT_CONTEXTS.map(function (name) {
        return contextEntity(name, CONTEXT_EPOCH);
      }),
      trash: {
        items: [],
        projects: [],
        horizons: [],
      },
      // Permanent deletion log ({id, type, deletedAt}), written when an entity
      // leaves the system for good (trash emptied or hard-deleted). A future
      // sync layer needs these so a deletion on one device is not undone by a
      // stale copy on another.
      tombstones: [],
      settings: {
        lastReviewAt: null,
        focusDate: null,
        // Contexts are optional in GTD (Setup Guide: a single "Todas" list is
        // fine); this flag hides the whole feature across the app when false.
        contextsEnabled: true,
        // Reference is a canonical section but may live outside the app; this
        // flag hides the list, the nav entry and the Clarify choice when false.
        referenceEnabled: true,
        // Higher horizons (2-5) are optional until ground level is under
        // control; this flag hides the view and its nav entry when false.
        // Stored entries are kept.
        horizonsEnabled: true,
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
  var db = null; // Open IndexedDB handle; null means localStorage-fallback mode.
  var initPromise = null;

  // ---- Boot / persistence plumbing ----

  function init() {
    if (initPromise) return initPromise;
    initPromise = openDatabase()
      .then(function (database) {
        db = database;
        return readRecord();
      })
      .catch(function () {
        // IndexedDB unavailable or broken: run entirely on localStorage.
        db = null;
        return null;
      })
      .then(function (record) {
        // The legacy/localStorage copy wins only when it is strictly newer
        // (savedAt), i.e. after a fallback write; otherwise IndexedDB rules.
        var legacy = readLegacy();
        state = migrate(pickNewer(record, legacy));
        save(); // Persist the migrated document so storage is current from boot.
        return state;
      });
    return initPromise;
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('indexeddb-unavailable'));
        return;
      }
      var request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(DB_STORE)) {
          database.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error('indexeddb-open-failed'));
      };
    });
  }

  function readRecord() {
    return new Promise(function (resolve, reject) {
      var request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function () {
        reject(request.error || new Error('indexeddb-read-failed'));
      };
    });
  }

  function readLegacy() {
    try {
      var raw = global.localStorage.getItem(LEGACY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      // Corrupted storage: start fresh rather than crash. Keep a backup copy.
      try {
        global.localStorage.setItem(LEGACY_KEY + ':corrupted', global.localStorage.getItem(LEGACY_KEY) || '');
      } catch (ignored) {}
      return null;
    }
  }

  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (b.savedAt || '') > (a.savedAt || '') ? b : a;
  }

  // Fire-and-forget write of the whole document. In-memory state is the source
  // of truth, IndexedDB readwrite transactions on one store commit in creation
  // order, and put() clones the value synchronously, so the last save() always
  // wins on disk with no awaiting needed.
  function persist() {
    if (db) {
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(state, DB_KEY);
        tx.onabort = persistToLocalStorage; // e.g. quota exceeded mid-commit.
        return;
      } catch (err) {
        // Fall through to localStorage so the change is not lost.
      }
    }
    persistToLocalStorage();
  }

  function persistToLocalStorage() {
    try {
      global.localStorage.setItem(LEGACY_KEY, JSON.stringify(state));
    } catch (ignored) {
      // Nowhere left to write; the in-memory state still works this session.
    }
  }

  function load() {
    if (!state) throw new Error('GTD.store.init() must complete before using the store');
    return state;
  }

  function migrate(data) {
    var base = defaultState();
    if (!data || typeof data !== 'object') return base;
    data.version = 3;
    data.items = Array.isArray(data.items) ? data.items : base.items;
    data.projects = Array.isArray(data.projects) ? data.projects : base.projects;
    data.horizons = Array.isArray(data.horizons) ? data.horizons : base.horizons;
    // v2 -> v3: contexts were plain strings; now entities (id === name) with
    // epoch timestamps so tombstoned deletions on other devices still win.
    data.contexts = (Array.isArray(data.contexts) && data.contexts.length ? data.contexts : base.contexts)
      .map(function (context) {
        if (typeof context === 'string') return contextEntity(context, CONTEXT_EPOCH);
        return context && context.id ? context : null;
      })
      .filter(Boolean);
    var trash = data.trash && typeof data.trash === 'object' ? data.trash : {};
    data.trash = {
      items: Array.isArray(trash.items) ? trash.items : [],
      projects: Array.isArray(trash.projects) ? trash.projects : [],
      horizons: Array.isArray(trash.horizons) ? trash.horizons : [],
    };
    data.tombstones = Array.isArray(data.tombstones) ? data.tombstones : [];
    data.settings = Object.assign({}, base.settings, data.settings || {});
    Object.keys(CRITERIA).forEach(function (key) {
      if (!Array.isArray(data.settings[key])) data.settings[key] = base.settings[key];
    });
    // v1 -> v2: every entity carries updatedAt so the sync layer can merge
    // by last-writer-wins. Backfill from createdAt on old data.
    [data.items, data.projects, data.horizons, data.contexts, data.trash.items, data.trash.projects, data.trash.horizons].forEach(
      function (list) {
        list.forEach(ensureUpdatedAt);
      }
    );
    return data;
  }

  function ensureUpdatedAt(entity) {
    if (!entity.updatedAt) entity.updatedAt = entity.createdAt || new Date().toISOString();
  }

  function save() {
    load().savedAt = new Date().toISOString();
    persist();
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Permanent deletion marker; callers save().
  // type: 'item'|'project'|'horizon'|'context'.
  function addTombstone(type, id) {
    load().tombstones.push({ id: id, type: type, deletedAt: new Date().toISOString() });
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
        var now = new Date().toISOString();
        item.isFocus = false;
        item.deletedAt = now;
        item.updatedAt = now;
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
        addTombstone('item', id);
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
    var now = new Date().toISOString();
    var project = Object.assign(
      {
        id: uid(),
        name: '',
        outcome: '',
        status: 'active',
        createdAt: now,
        updatedAt: now,
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
    Object.assign(project, fields, { updatedAt: new Date().toISOString() });
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
        var now = new Date().toISOString();
        project.deletedAt = now;
        project.updatedAt = now;
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
    var now = new Date().toISOString();
    var horizon = {
      id: uid(),
      level: level,
      text: text,
      note: '',
      createdAt: now,
      updatedAt: now,
    };
    load().horizons.push(horizon);
    save();
    return horizon;
  }

  function updateHorizon(id, fields) {
    var horizon = getHorizon(id);
    if (!horizon) return null;
    Object.assign(horizon, fields, { updatedAt: new Date().toISOString() });
    save();
    return horizon;
  }

  // Recoverable, like removeItem: the entry waits in the trash.
  function removeHorizon(id) {
    var s = load();
    for (var i = 0; i < s.horizons.length; i++) {
      if (s.horizons[i].id === id) {
        var horizon = s.horizons.splice(i, 1)[0];
        var now = new Date().toISOString();
        horizon.deletedAt = now;
        horizon.updatedAt = now;
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
        item.updatedAt = new Date().toISOString();
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
        project.updatedAt = new Date().toISOString();
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
        horizon.updatedAt = new Date().toISOString();
        s.horizons.push(horizon);
        save();
        return horizon;
      }
    }
    return null;
  }

  // The only truly destructive delete: once emptied, nothing comes back.
  // Each purged entity leaves a tombstone so the deletion is permanent even
  // for a future sync layer.
  function emptyTrash() {
    var s = load();
    var now = new Date().toISOString();
    // Projects are gone for good now, so cut the links that restore relied on.
    s.trash.projects.forEach(function (project) {
      s.items.forEach(function (item) {
        if (item.projectId === project.id) {
          item.projectId = null;
          item.updatedAt = now;
        }
      });
    });
    var TYPES = { items: 'item', projects: 'project', horizons: 'horizon' };
    Object.keys(TYPES).forEach(function (key) {
      s.trash[key].forEach(function (entity) {
        s.tombstones.push({ id: entity.id, type: TYPES[key], deletedAt: now });
      });
    });
    s.trash = { items: [], projects: [], horizons: [] };
    save();
  }

  // ---- Contexts ----

  // Contexts are entities internally (see contextEntity), but consumers only
  // ever deal in names: items store the name and the UI lists names.
  function getContexts() {
    return load().contexts.map(function (context) {
      return context.name;
    });
  }

  function addContext(name) {
    name = String(name || '').trim();
    if (!name) return false;
    if (name.charAt(0) !== '@') name = '@' + name;
    name = name.toLowerCase().replace(/\s+/g, '-');
    var s = load();
    var exists = s.contexts.some(function (context) {
      return context.name === name;
    });
    if (exists) return false;
    s.contexts.push(contextEntity(name, new Date().toISOString()));
    // Re-adding a previously purged context: the fresh updatedAt would win
    // the merge anyway (update-wins); drop the local tombstone eagerly so
    // the state never carries both.
    s.tombstones = s.tombstones.filter(function (t) {
      return !(t.type === 'context' && t.id === name);
    });
    save();
    return name;
  }

  function removeContext(name) {
    var s = load();
    var now = new Date().toISOString();
    s.contexts = s.contexts.filter(function (context) {
      return context.name !== name;
    });
    // Contexts have no trash: removal is permanent, so it tombstones right
    // away and the deletion propagates to other devices.
    addTombstone('context', name);
    s.items.forEach(function (item) {
      if (item.context === name) {
        item.context = null;
        item.updatedAt = now;
      }
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
    var now = new Date().toISOString();
    s.settings[key] = s.settings[key].filter(function (v) {
      return v !== name;
    });
    var field = CRITERIA[key];
    s.items.forEach(function (item) {
      if (item[field] === name) {
        item[field] = null;
        item.updatedAt = now;
      }
    });
    s.trash.items.forEach(function (item) {
      if (item[field] === name) {
        item[field] = null;
        item.updatedAt = now;
      }
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

  // Swap the whole in-memory state for a merged document (sync layer). The
  // document is normalized through migrate() and persisted atomically.
  function replaceState(doc) {
    state = migrate(doc);
    save();
    return state;
  }

  global.GTD = global.GTD || {};
  global.GTD.store = {
    init: init,
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
    replaceState: replaceState,
  };
})(window);
