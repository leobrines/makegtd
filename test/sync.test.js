/* Unit tests for the pure merge engine (js/sync.js). Run: npm test */
'use strict';

var assert = require('assert');
var path = require('path');

require(path.join(__dirname, '..', 'js', 'sync.js'));
var merge = globalThis.GTD.sync.merge;

// ---- Fixtures ----

function doc(overrides) {
  return Object.assign(
    {
      version: 2,
      items: [],
      projects: [],
      horizons: [],
      contexts: ['@casa'],
      trash: { items: [], projects: [], horizons: [] },
      tombstones: [],
      settings: { contextsEnabled: true },
      savedAt: '2026-01-01T00:00:00.000Z',
    },
    overrides
  );
}

function item(id, updatedAt, overrides) {
  return Object.assign(
    { id: id, title: id, status: 'next', projectId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: updatedAt },
    overrides
  );
}

function byId(list, id) {
  return list.find(function (e) {
    return e.id === id;
  });
}

// Convergence helper: same entity content regardless of document order.
function entityMap(state) {
  var map = {};
  ['items', 'projects', 'horizons'].forEach(function (kind) {
    state[kind].forEach(function (e) {
      map[kind + ':' + e.id] = e;
    });
    state.trash[kind].forEach(function (e) {
      map['trash:' + kind + ':' + e.id] = e;
    });
  });
  state.tombstones.forEach(function (t) {
    map['tomb:' + t.type + ':' + t.id] = t;
  });
  return map;
}

// ---- Tests ----

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

test('newer remote edit wins', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { title: 'vieja' })] });
  var remote = doc({ items: [item('a', '2026-01-02T10:00:00.000Z', { title: 'nueva' })] });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.items.length, 1);
  assert.strictEqual(merged.items[0].title, 'nueva');
});

test('older remote edit loses', function () {
  var local = doc({ items: [item('a', '2026-01-02T10:00:00.000Z', { title: 'nueva' })] });
  var remote = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { title: 'vieja' })] });
  assert.strictEqual(merge([local, remote]).items[0].title, 'nueva');
});

test('items unknown locally are added', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z')] });
  var remote = doc({ items: [item('b', '2026-01-01T11:00:00.000Z')] });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.items.length, 2);
  assert.ok(byId(merged.items, 'b'));
});

test('local list order is preserved, new entities append', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z'), item('b', '2026-01-01T10:00:00.000Z')] });
  var remote = doc({ items: [item('c', '2026-01-01T10:00:00.000Z'), item('a', '2026-01-01T09:00:00.000Z')] });
  var ids = merge([local, remote]).items.map(function (i) {
    return i.id;
  });
  assert.deepStrictEqual(ids, ['a', 'b', 'c']);
});

test('a newer trashing beats an older active copy', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z')] });
  var remote = doc({
    trash: { items: [item('a', '2026-01-02T10:00:00.000Z', { deletedAt: '2026-01-02T10:00:00.000Z' })], projects: [], horizons: [] },
  });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.items.length, 0);
  assert.strictEqual(merged.trash.items.length, 1);
});

test('a newer restore beats an older trashed copy', function () {
  var local = doc({
    trash: { items: [item('a', '2026-01-01T10:00:00.000Z', { deletedAt: '2026-01-01T10:00:00.000Z' })], projects: [], horizons: [] },
  });
  var remote = doc({ items: [item('a', '2026-01-02T10:00:00.000Z')] });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.trash.items.length, 0);
  assert.strictEqual(merged.items[0].id, 'a');
});

test('tombstone kills copies not edited after it and is kept', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z')] });
  var remote = doc({ tombstones: [{ id: 'a', type: 'item', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.items.length, 0);
  assert.strictEqual(merged.trash.items.length, 0);
  assert.deepStrictEqual(merged.tombstones, [{ id: 'a', type: 'item', deletedAt: '2026-01-02T10:00:00.000Z' }]);
});

test('edit newer than the tombstone resurrects and drops it', function () {
  var local = doc({ items: [item('a', '2026-01-03T10:00:00.000Z', { title: 'editada tras purga' })] });
  var remote = doc({ tombstones: [{ id: 'a', type: 'item', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.items[0].title, 'editada tras purga');
  assert.strictEqual(merged.tombstones.length, 0);
});

test('tombstones are unioned and deduped keeping the newest', function () {
  var local = doc({ tombstones: [{ id: 'a', type: 'item', deletedAt: '2026-01-01T10:00:00.000Z' }] });
  var remote = doc({
    tombstones: [
      { id: 'a', type: 'item', deletedAt: '2026-01-02T10:00:00.000Z' },
      { id: 'b', type: 'project', deletedAt: '2026-01-01T10:00:00.000Z' },
    ],
  });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.tombstones.length, 2);
  assert.strictEqual(byId(merged.tombstones, 'a').deletedAt, '2026-01-02T10:00:00.000Z');
});

test('items lose the link to a tombstone-killed project', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { projectId: 'p1' })] });
  var remote = doc({ tombstones: [{ id: 'p1', type: 'project', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  assert.strictEqual(merge([local, remote]).items[0].projectId, null);
});

test('projects and horizons merge by the same rules', function () {
  var local = doc({
    projects: [{ id: 'p1', name: 'vieja', status: 'active', updatedAt: '2026-01-01T10:00:00.000Z' }],
    horizons: [{ id: 'h1', level: 2, text: 'Salud', updatedAt: '2026-01-01T10:00:00.000Z' }],
  });
  var remote = doc({
    projects: [{ id: 'p1', name: 'nueva', status: 'someday', updatedAt: '2026-01-02T10:00:00.000Z' }],
    horizons: [{ id: 'h2', level: 3, text: 'Meta', updatedAt: '2026-01-01T10:00:00.000Z' }],
  });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.projects[0].name, 'nueva');
  assert.strictEqual(merged.projects[0].status, 'someday');
  assert.strictEqual(merged.horizons.length, 2);
});

function contextNames(state) {
  return state.contexts.map(function (c) {
    return c.name;
  });
}

function ctx(name, updatedAt) {
  return { id: name, name: name, createdAt: updatedAt, updatedAt: updatedAt };
}

test('contexts merge as a union, local order first', function () {
  var local = doc({ contexts: ['@casa', '@trabajo'] });
  var remote = doc({ contexts: ['@recados', '@casa'] });
  assert.deepStrictEqual(contextNames(merge([local, remote])), ['@casa', '@trabajo', '@recados']);
});

test('legacy string contexts normalize to epoch-stamped entities', function () {
  var merged = merge([doc({ contexts: ['@casa'] })]);
  assert.deepStrictEqual(merged.contexts, [
    { id: '@casa', name: '@casa', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' },
  ]);
});

test('an entity context beats its legacy string copy', function () {
  var local = doc({ contexts: ['@casa'] });
  var remote = doc({ contexts: [ctx('@casa', '2026-01-01T10:00:00.000Z')] });
  var merged = merge([local, remote]);
  assert.strictEqual(merged.contexts.length, 1);
  assert.strictEqual(merged.contexts[0].updatedAt, '2026-01-01T10:00:00.000Z');
});

test('context deletion propagates via tombstone (beats legacy and older copies)', function () {
  var local = doc({ contexts: ['@casa', ctx('@recados', '2026-01-01T10:00:00.000Z')] });
  var remote = doc({
    contexts: [],
    tombstones: [
      { id: '@casa', type: 'context', deletedAt: '2026-01-02T10:00:00.000Z' },
      { id: '@recados', type: 'context', deletedAt: '2026-01-02T10:00:00.000Z' },
    ],
  });
  var merged = merge([local, remote]);
  assert.deepStrictEqual(contextNames(merged), []);
  assert.strictEqual(merged.tombstones.length, 2);
});

test('items lose the tag of a tombstone-killed context', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { context: '@gimnasio' })] });
  var remote = doc({ tombstones: [{ id: '@gimnasio', type: 'context', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  assert.strictEqual(merge([local, remote]).items[0].context, null);
});

test('re-adding a deleted context survives and drops the tombstone', function () {
  var local = doc({ contexts: [ctx('@casa', '2026-01-03T10:00:00.000Z')] });
  var remote = doc({ contexts: [], tombstones: [{ id: '@casa', type: 'context', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  var merged = merge([local, remote]);
  assert.deepStrictEqual(contextNames(merged), ['@casa']);
  assert.strictEqual(merged.tombstones.length, 0);
});

test('the same context added on two devices converges to one entity', function () {
  var a = doc({ contexts: [ctx('@casa', '2026-01-01T10:00:00.000Z')] });
  var b = doc({ contexts: [ctx('@casa', '2026-01-02T10:00:00.000Z')] });
  var merged = merge([a, b]);
  assert.strictEqual(merged.contexts.length, 1);
  assert.strictEqual(merged.contexts[0].updatedAt, '2026-01-02T10:00:00.000Z');
});

test('settings come whole from the most recently saved document', function () {
  var local = doc({ settings: { contextsEnabled: true, reviewDay: 1 }, savedAt: '2026-01-01T10:00:00.000Z' });
  var remote = doc({ settings: { contextsEnabled: false, reviewDay: 5 }, savedAt: '2026-01-02T10:00:00.000Z' });
  var merged = merge([local, remote]);
  assert.deepStrictEqual(merged.settings, { contextsEnabled: false, reviewDay: 5 });
  assert.strictEqual(merged.savedAt, '2026-01-02T10:00:00.000Z');
});

test('equal timestamps break ties deterministically regardless of order', function () {
  var a = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { title: 'alpha' })] });
  var b = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { title: 'beta' })] });
  var ab = merge([a, b]).items[0].title;
  var ba = merge([b, a]).items[0].title;
  assert.strictEqual(ab, ba);
});

test('merge converges: same content whichever device merges', function () {
  var a = doc({
    items: [item('x', '2026-01-01T10:00:00.000Z'), item('y', '2026-01-03T10:00:00.000Z', { title: 'editada en A' })],
    tombstones: [{ id: 'z', type: 'item', deletedAt: '2026-01-02T10:00:00.000Z' }],
    savedAt: '2026-01-03T10:00:00.000Z',
  });
  var b = doc({
    items: [item('y', '2026-01-02T10:00:00.000Z'), item('z', '2026-01-01T10:00:00.000Z')],
    trash: { items: [item('x', '2026-01-02T10:00:00.000Z', { deletedAt: '2026-01-02T10:00:00.000Z' })], projects: [], horizons: [] },
    savedAt: '2026-01-02T10:00:00.000Z',
  });
  assert.deepStrictEqual(entityMap(merge([a, b])), entityMap(merge([b, a])));
});

test('merge is idempotent: re-merging the result changes nothing', function () {
  var a = doc({ items: [item('x', '2026-01-01T10:00:00.000Z')], tombstones: [{ id: 'z', type: 'item', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  var b = doc({ items: [item('z', '2026-01-01T10:00:00.000Z'), item('y', '2026-01-02T10:00:00.000Z')] });
  var once = merge([a, b]);
  var twice = merge([once, b]);
  assert.deepStrictEqual(entityMap(twice), entityMap(once));
});

test('merge does not mutate its inputs', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z', { projectId: 'p1' })] });
  var remote = doc({ tombstones: [{ id: 'p1', type: 'project', deletedAt: '2026-01-02T10:00:00.000Z' }] });
  var localCopy = JSON.stringify(local);
  var remoteCopy = JSON.stringify(remote);
  merge([local, remote]);
  assert.strictEqual(JSON.stringify(local), localCopy);
  assert.strictEqual(JSON.stringify(remote), remoteCopy);
});

test('a single document passes through unchanged in content', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z')] });
  var merged = merge([local]);
  assert.deepStrictEqual(entityMap(merged), entityMap(local));
  assert.deepStrictEqual(contextNames(merged), local.contexts);
});

test('malformed documents and entities are skipped', function () {
  var local = doc({ items: [item('a', '2026-01-01T10:00:00.000Z'), null, { title: 'sin id' }] });
  var merged = merge([local, null, undefined, 'basura']);
  assert.strictEqual(merged.items.length, 1);
  assert.strictEqual(merge([]), null);
});

// ---- Runner ----

var failed = 0;
tests.forEach(function (t) {
  try {
    t.fn();
    console.log('PASS  ' + t.name);
  } catch (err) {
    failed++;
    console.error('FAIL  ' + t.name + '\n      ' + err.message);
  }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' tests passed');
process.exit(failed ? 1 : 0);
