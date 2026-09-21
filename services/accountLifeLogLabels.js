const { allows, SECTIONS } = require('./accountSurfacePolicy');

const MAX_QUERY_LENGTH = 160;
const LIMIT = 5;
const MAX_TIME_MS = 2000;

// Same UTC instant one calendar year ago; Feb 29 clamps to Feb 28.
function labelWindow(now = new Date()) {
  const end = new Date(now);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  if (start.getUTCMonth() !== end.getUTCMonth()) start.setUTCDate(0);
  return { $gte: start, $lte: end };
}

function parseLabelQuery(query) {
  if (!query || Object.keys(query).some(k => k !== 'q')
    || (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > MAX_QUERY_LENGTH || query.q.includes('\0')))) {
    throw new Error('Invalid label query');
  }
  return (query.q || '').trim();
}

function createLifeLogLabels({ model = () => require('../models/my_life_log_entry'), now = () => new Date() } = {}) {
  return async (policy, query) => {
    // This legacy collection belongs exclusively to the configured personal owner.
    // It has no per-record owner field: deny before any model access, even for admins.
    if (!allows(policy, SECTIONS.find(s => s.id === 'life'))) throw new Error('Life log access denied');
    const q = parseLabelQuery(query);
    const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cursor = model().find({ timestamp: labelWindow(now()), label: { $regex: literal, $options: 'i' } })
      .select({ _id: 0, label: 1 }).sort({ timestamp: -1, _id: -1 })
      .maxTimeMS(MAX_TIME_MS).setOptions({ sanitizeFilter: false, allowDiskUse: false })
      .lean().cursor({ batchSize: 100 });
    const labels = [];
    const seen = new Set();
    const deadline = Date.now() + MAX_TIME_MS;
    try {
      // No record limit before matching/deduplication. A rare label remains reachable
      // regardless of how many newer unrelated entries or duplicate labels exist.
      for await (const entry of cursor) {
        if (Date.now() > deadline) throw new Error('Label query timed out');
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        const key = label.toLowerCase();
        if (!label || label.length > MAX_QUERY_LENGTH || seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
        if (labels.length === LIMIT) break;
      }
      return labels;
    } finally {
      await cursor.close();
    }
  };
}

module.exports = { createLifeLogLabels, labelWindow, parseLabelQuery };
