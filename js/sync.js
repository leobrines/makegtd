/* Pure state-merge engine for multi-device sync (local-first phase 2).
 *
 * merge(docs) takes an array of migrated state documents (local first, then
 * one per remote device) and returns a new merged document. No I/O, no store
 * access, no clock reads: given the same set of documents in any order, every
 * device computes the same result, which is what makes the sync converge.
 *
 * Rules:
 * - Entities (items, projects, horizons) merge per id, last-writer-wins by
 *   updatedAt; being in the trash is part of the entity's state (deletedAt),
 *   so trashing and restoring resolve through the same rule. Equal timestamps
 *   break the tie deterministically by comparing serialized content.
 * - A tombstone kills every copy not edited after it (updatedAt <= deletedAt)
 *   and is kept; a copy edited after the tombstone survives and drops it
 *   (update-wins), so a purge and a later deliberate edit both converge.
 * - Items pointing at a tombstone-killed project lose the link, mirroring
 *   what emptyTrash() does locally. Merge never stamps updatedAt: results
 *   must be identical on every device, and re-stamping would ping-pong.
 * - Contexts are entities whose id IS the name (no rename exists), so they
 *   merge by the same rules and deletions propagate via tombstones. Legacy
 *   v2 documents carry them as plain strings: those are normalized here to
 *   epoch-stamped entities deterministically, so any real edit or tombstone
 *   beats them.
 * - settings has no per-key timestamps: the whole object is taken from the
 *   most recently saved document (savedAt).
 */
(function (global) {
  'use strict';

  // Entity kinds: state list, tombstone type tag, and whether the kind has a
  // trash list (contexts are deleted outright, never trashed).
  var KINDS = [
    { list: 'items', type: 'item', trash: true },
    { list: 'projects', type: 'project', trash: true },
    { list: 'horizons', type: 'horizon', trash: true },
    { list: 'contexts', type: 'context', trash: false },
  ];

  // Deterministic normalization of a legacy (v2) plain-string context. The
  // epoch stamp means any tombstone or real edit wins over the legacy copy.
  var CONTEXT_EPOCH = '1970-01-01T00:00:00.000Z';

  function legacyContext(name) {
    return { id: name, name: name, createdAt: CONTEXT_EPOCH, updatedAt: CONTEXT_EPOCH };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Deterministic "b beats a": newer updatedAt wins; equal timestamps fall
  // back to content comparison so every device picks the same winner.
  function beats(b, a) {
    var ub = b.updatedAt || '';
    var ua = a.updatedAt || '';
    if (ub !== ua) return ub > ua;
    return JSON.stringify(b) > JSON.stringify(a);
  }

  function merge(docs) {
    docs = (docs || []).filter(function (d) {
      return d && typeof d === 'object';
    });
    if (!docs.length) return null;

    // Collect tombstones: one per type:id, keeping the newest deletedAt.
    var tombstones = {};
    docs.forEach(function (doc) {
      (Array.isArray(doc.tombstones) ? doc.tombstones : []).forEach(function (t) {
        if (!t || !t.id || !t.type) return;
        var key = t.type + ':' + t.id;
        if (!tombstones[key] || (t.deletedAt || '') > (tombstones[key].deletedAt || '')) {
          tombstones[key] = { id: t.id, type: t.type, deletedAt: t.deletedAt };
        }
      });
    });

    var result = {
      version: 3,
      trash: { items: [], projects: [], horizons: [] },
      tombstones: [],
      settings: null,
      savedAt: '',
    };
    KINDS.forEach(function (kind) {
      var winners = {};
      var order = []; // First-seen order, local document first: stable lists.
      docs.forEach(function (doc) {
        var active = Array.isArray(doc[kind.list]) ? doc[kind.list] : [];
        var trashed = kind.trash && doc.trash && Array.isArray(doc.trash[kind.list]) ? doc.trash[kind.list] : [];
        active.concat(trashed).forEach(function (entity) {
          if (kind.type === 'context' && typeof entity === 'string') entity = legacyContext(entity);
          if (!entity || !entity.id) return;
          if (!winners[entity.id]) {
            winners[entity.id] = entity;
            order.push(entity.id);
          } else if (beats(entity, winners[entity.id])) {
            winners[entity.id] = entity;
          }
        });
      });

      result[kind.list] = [];
      order.forEach(function (id) {
        var winner = winners[id];
        var tomb = tombstones[kind.type + ':' + id];
        if (tomb) {
          // Update-wins: an edit made after the purge resurrects the entity.
          if ((winner.updatedAt || '') > (tomb.deletedAt || '')) {
            delete tombstones[kind.type + ':' + id];
          } else {
            return; // Purged for good; only the tombstone remains.
          }
        }
        (kind.trash && winner.deletedAt ? result.trash[kind.list] : result[kind.list]).push(clone(winner));
      });
    });

    // Mirror the local deletions' side effects on items: emptyTrash() cuts
    // links to purged projects and removeContext() clears the tag. Any
    // standing tombstone means the entity is dead everywhere, whether or not
    // a copy of it appeared in the merged documents.
    [result.items, result.trash.items].forEach(function (list) {
      list.forEach(function (item) {
        if (item.projectId && tombstones['project:' + item.projectId]) item.projectId = null;
        if (item.context && tombstones['context:' + item.context]) item.context = null;
      });
    });

    // Settings: whole object from the most recently saved document.
    var newest = docs[0];
    docs.forEach(function (doc) {
      if ((doc.savedAt || '') > (newest.savedAt || '')) newest = doc;
      if ((doc.savedAt || '') > result.savedAt) result.savedAt = doc.savedAt;
    });
    result.settings = clone(newest.settings || {});

    Object.keys(tombstones).forEach(function (key) {
      result.tombstones.push(tombstones[key]);
    });

    return result;
  }

  global.GTD = global.GTD || {};
  global.GTD.sync = { merge: merge };
})(typeof window !== 'undefined' ? window : globalThis); // globalThis: unit tests run in Node.
