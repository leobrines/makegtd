/* Persistence layer: whole app state lives under a single versioned localStorage key. */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'gtd:data:v1';

  var DEFAULT_CONTEXTS = ['@casa', '@trabajo', '@recados', '@llamadas', '@ordenador'];

  function defaultState() {
    return {
      version: 1,
      items: [],
      projects: [],
      contexts: DEFAULT_CONTEXTS.slice(),
      settings: {
        lastReviewAt: null,
        focusDate: null,
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
    data.contexts = Array.isArray(data.contexts) && data.contexts.length ? data.contexts : base.contexts;
    data.settings = Object.assign({}, base.settings, data.settings || {});
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
        tickleDate: null,
        waitingFor: null,
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

  function removeItem(id) {
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

  function removeProject(id) {
    var s = load();
    s.projects = s.projects.filter(function (p) {
      return p.id !== id;
    });
    // Detach items that pointed to this project.
    s.items.forEach(function (item) {
      if (item.projectId === id) item.projectId = null;
    });
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
    getProjects: getProjects,
    getProject: getProject,
    addProject: addProject,
    updateProject: updateProject,
    removeProject: removeProject,
    getContexts: getContexts,
    addContext: addContext,
    removeContext: removeContext,
    getSettings: getSettings,
    updateSettings: updateSettings,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
  };
})(window);
