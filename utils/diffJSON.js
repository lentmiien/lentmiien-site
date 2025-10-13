// diffJSON.js
// Deep diff two JSON-like values at leaf level (objects + arrays) for Node.js.
// Usage:
//   const { diffJSON } = require('./diffJSON');
//   const diff = diffJSON(a, b, { includeUnchanged: false, onTypeMismatch: 'record' });
//   res.render('diff', { title: 'JSON Diff', diff, sideALabel: 'Left', sideBLabel: 'Right' });

function diffJSON(a, b, userOptions = {}) {
  const options = {
    includeUnchanged: false,
    onTypeMismatch: 'record', // 'record' | 'expand'. 'record' creates a single typeMismatch entry; 'expand' expands into added/removed leaves at this path.
    sortKeys: true,
    treatArrayHolesAsUndefined: false,
    ...userOptions,
  };

  const entries = [];
  const hasOwn = Object.prototype.hasOwnProperty;

  function getType(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (v instanceof Date) return 'date';
    return typeof v; // 'object', 'string', 'number', 'boolean', 'undefined', 'bigint', 'symbol', 'function'
  }

  function isLeaf(v) {
    const t = getType(v);
    return t !== 'object' && t !== 'array';
  }

  function leafEquals(a, b) {
    const ta = getType(a);
    const tb = getType(b);
    if (ta !== tb) return false;
    if (ta === 'date') return a.getTime() === b.getTime();
    return Object.is(a, b);
  }

  function summarizeNonLeaf(v) {
    const t = getType(v);
    if (t === 'array') return `[array: ${v.length}]`;
    if (t === 'object') return `{object: ${Object.keys(v).length} keys}`;
    return `[${t}]`;
  }

  function formatValue(v) {
    const t = getType(v);
    if (t === 'string') return JSON.stringify(v);
    if (t === 'number' || t === 'boolean') return String(v);
    if (t === 'null') return 'null';
    if (t === 'undefined') return 'undefined';
    if (t === 'bigint') return v.toString() + 'n';
    if (t === 'symbol') return v.toString();
    if (t === 'date') return `Date("${v.toISOString()}")`;
    if (t === 'array' || t === 'object') return summarizeNonLeaf(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function pathToString(segs) {
    let s = '';
    for (const seg of segs) {
      if (seg.type === 'key') {
        if (s) s += '.';
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg.key)) {
          s += seg.key;
        } else {
          s += `["${String(seg.key).replace(/"/g, '\\"')}"]`;
        }
      } else {
        s += `[${seg.index}]`;
      }
    }
    return s || '(root)';
  }

  function makeEntry(kind, segs, aVal, bVal) {
    const e = {
      kind, // 'added' | 'removed' | 'changed' | 'typeMismatch' | 'unchanged'
      path: pathToString(segs),
      pathSegments: segs.slice(),
      aValue: aVal,
      bValue: bVal,
      aType: getType(aVal),
      bType: getType(bVal),
      aDisplay: formatValue(aVal),
      bDisplay: formatValue(bVal),
    };
    entries.push(e);
  }

  function collectLeavesOnlyIn(val, isA, segs) {
    if (isLeaf(val)) {
      if (isA) makeEntry('removed', segs, val, undefined);
      else makeEntry('added', segs, undefined, val);
      return;
    }
    const t = getType(val);
    if (t === 'array') {
      const len = val.length;
      for (let i = 0; i < len; i++) {
        if (!options.treatArrayHolesAsUndefined && !(i in val)) continue;
        collectLeavesOnlyIn(val[i], isA, segs.concat([{ type: 'index', index: i }]));
      }
    } else if (t === 'object') {
      const keys = Object.keys(val);
      if (options.sortKeys) keys.sort();
      for (const k of keys) {
        if (!hasOwn.call(val, k)) continue;
        collectLeavesOnlyIn(val[k], isA, segs.concat([{ type: 'key', key: k }]));
      }
    } else {
      // Fallback (should not hit for JSON)
      if (isA) makeEntry('removed', segs, val, undefined);
      else makeEntry('added', segs, undefined, val);
    }
  }

  function walk(aNode, bNode, segs) {
    const aIsLeaf = isLeaf(aNode);
    const bIsLeaf = isLeaf(bNode);

    if (!aIsLeaf && !bIsLeaf) {
      const aType = getType(aNode);
      const bType = getType(bNode);

      if (aType === 'array' && bType === 'array') {
        const len = Math.max(aNode.length, bNode.length);
        for (let i = 0; i < len; i++) {
          const hasA = options.treatArrayHolesAsUndefined ? (i <= aNode.length - 1) : (i in aNode);
          const hasB = options.treatArrayHolesAsUndefined ? (i <= bNode.length - 1) : (i in bNode);
          if (hasA && hasB) {
            walk(aNode[i], bNode[i], segs.concat([{ type: 'index', index: i }]));
          } else if (hasA) {
            collectLeavesOnlyIn(aNode[i], true, segs.concat([{ type: 'index', index: i }]));
          } else if (hasB) {
            collectLeavesOnlyIn(bNode[i], false, segs.concat([{ type: 'index', index: i }]));
          }
        }
        return;
      }

      if (aType === 'object' && bType === 'object') {
        const keys = new Set([...Object.keys(aNode), ...Object.keys(bNode)]);
        const sorted = options.sortKeys ? Array.from(keys).sort() : Array.from(keys);
        for (const k of sorted) {
          const hasA = hasOwn.call(aNode, k);
          const hasB = hasOwn.call(bNode, k);
          if (hasA && hasB) {
            walk(aNode[k], bNode[k], segs.concat([{ type: 'key', key: k }]));
          } else if (hasA) {
            collectLeavesOnlyIn(aNode[k], true, segs.concat([{ type: 'key', key: k }]));
          } else {
            collectLeavesOnlyIn(bNode[k], false, segs.concat([{ type: 'key', key: k }]));
          }
        }
        return;
      }

      // Both are containers but of different kinds (e.g., object vs array)
      if (options.onTypeMismatch === 'expand') {
        collectLeavesOnlyIn(aNode, true, segs);
        collectLeavesOnlyIn(bNode, false, segs);
      } else {
        makeEntry('typeMismatch', segs, aNode, bNode);
      }
      return;
    }

    if (aIsLeaf && bIsLeaf) {
      if (leafEquals(aNode, bNode)) {
        if (options.includeUnchanged) {
          makeEntry('unchanged', segs, aNode, bNode);
        }
      } else {
        makeEntry('changed', segs, aNode, bNode);
      }
      return;
    }

    // One leaf, one container
    if (options.onTypeMismatch === 'expand') {
      collectLeavesOnlyIn(aNode, true, segs);
      collectLeavesOnlyIn(bNode, false, segs);
    } else {
      makeEntry('typeMismatch', segs, aNode, bNode);
    }
  }

  walk(a, b, []);

  const groups = { added: [], removed: [], changed: [], typeMismatch: [], unchanged: [] };
  const summary = { total: 0, added: 0, removed: 0, changed: 0, typeMismatch: 0, unchanged: 0 };

  for (const e of entries) {
    groups[e.kind].push(e);
    summary[e.kind]++;
  }
  summary.total = entries.length;

  for (const k of Object.keys(groups)) {
    groups[k].sort((x, y) => x.path.localeCompare(y.path));
  }

  return { entries, groups, summary, optionsUsed: options };
}

module.exports = { diffJSON };