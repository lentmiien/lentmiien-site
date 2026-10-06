const { parseString } = require('fast-csv');
const { fail, object, string } = require('../../utils/taricContracts');
const { sha, hash } = require('../../utils/taricProtocol');
const logger = require('../../utils/logger');
const MAX_BYTES = 2 * 1024 * 1024;
const LIMITS = { headings: 4000, goods_summary: 2000, description_summary: 255 };
const query = q => q.maxTimeMS(2000).lean().exec();
function code(value) {
  if (typeof value !== 'string') fail('INVALID_REQUEST');
  const normalized = value.trim().replace(/[ .]/g, '');
  if (!/^\d{10}$/.test(normalized)) fail('INVALID_REQUEST');
  return normalized;
}
function fields(value) {
  return Object.fromEntries(Object.entries(LIMITS).map(([key, max]) => {
    if (typeof value[key] !== 'string' || value[key].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value[key])) fail('INVALID_REQUEST');
    return [key, value[key].trim()];
  }));
}
async function parseCsv(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) fail('IMPORT_INVALID');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { fail('IMPORT_INVALID'); }
  const rows = new Map(); let count = 0;
  await new Promise((resolve, reject) => {
    const parser = parseString(text, { headers: h => h.map(k => k.trim() === 'taricCode' ? 'taric_code' : k.trim()), ignoreEmpty: true, strictColumnHandling: true, maxRows: 10001 });
    const invalid = () => { parser.destroy(); try { fail('IMPORT_INVALID'); } catch (e) { reject(e); } };
    parser.on('headers', headers => {
      if (!headers.includes('taric_code') || headers.some(k => !['taric_code', ...Object.keys(LIMITS)].includes(k)) || new Set(headers).size !== headers.length) invalid();
    });
    parser.on('error', invalid).on('data-invalid', invalid);
    parser.on('data', row => {
      try {
        if (++count > 10000) return invalid();
        const id = code(row.taric_code);
        const values = fields(Object.fromEntries(Object.keys(LIMITS).map(k => [k, row[k] || ''])));
        const previous = rows.get(id);
        if (previous) {
          for (const key of Object.keys(LIMITS)) {
            if (previous[key] && values[key] && previous[key] !== values[key]) return invalid();
            previous[key] ||= values[key];
          }
        } else rows.set(id, { _id: id, ...values });
      } catch (_) { invalid(); }
    });
    parser.on('end', resolve);
  });
  if (!count) fail('IMPORT_INVALID');
  return { rows: [...rows.values()], count, duplicates: count - rows.size, sha256: sha(buffer) };
}
function snapshot(row) {
  return { taric_code: row._id, headings: row.headings, goods_summary: row.goods_summary,
    description_summary: row.description_summary, approved: row.approved, revision: row.revision };
}
function createApprovedCodes({ model, adminPrincipal }) {
  async function authorize(actor) {
    string(actor, 24, 'FORBIDDEN', /^[a-f0-9]{24}$/);
    const principal = await adminPrincipal(actor);
    if (principal?.id !== `admin_${actor}` || !principal.owner) fail('FORBIDDEN');
  }
  async function lookup(codes) {
    const unique = [...new Set(codes.filter(v => typeof v === 'string' && /^\d{10}$/.test(v)))];
    if (unique.length > 10000) fail('INVALID_REQUEST');
    if (!unique.length) return new Map();
    return new Map((await query(model.find({ _id: { $in: unique } }).limit(10000))).map(r => [r._id, snapshot(r)]));
  }
  async function check(value) {
    const row = (await lookup([value])).get(value);
    return { status: row?.approved ? 'approved' : 'unapproved', taric_code: value, revision: row?.revision || null };
  }
  async function list(actor, value = {}) {
    await authorize(actor); object({ ...value }, ['prefix', 'after'], 'INVALID_REQUEST');
    const prefix = value.prefix || ''; const after = value.after || '';
    if (typeof prefix !== 'string' || !/^\d{0,10}$/.test(prefix) || typeof after !== 'string' || (after && !/^\d{10}$/.test(after))) fail('INVALID_REQUEST');
    const rows = await query(model.find({ _id: { $regex: `^${prefix}`, ...(after ? { $gt: after } : {}) } }).sort({ _id: 1 }).limit(51));
    return { rows: rows.slice(0, 50), next: rows.length > 50 ? rows[49]._id : null };
  }
  async function edit(actor, id, value) {
    await authorize(actor); id = code(id);
    object(value, ['headings', 'goods_summary', 'description_summary', 'approved', 'expectedRevision'], 'INVALID_REQUEST');
    if (typeof value.approved !== 'boolean' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) fail('INVALID_REQUEST');
    const row = await query(model.findOneAndUpdate({ _id: id, revision: value.expectedRevision },
      { $set: { ...fields(value), approved: value.approved, updatedBy: actor }, $inc: { revision: 1 } }, { returnDocument: 'after', runValidators: true }));
    if (!row) fail('STALE');
    return row;
  }
  async function importCsv(actor, buffer, expectedSha) {
    await authorize(actor);
    const parsed = await parseCsv(buffer);
    if (expectedSha !== undefined && expectedSha !== parsed.sha256) fail('STALE');
    const existing = await lookup(parsed.rows.map(r => r._id));
    const fresh = parsed.rows.filter(r => !existing.has(r._id));
    const manifest = { sha256: parsed.sha256, rows: parsed.count, unique: parsed.rows.length, duplicates: parsed.duplicates,
      additions: fresh.length, existing: existing.size, missingDescriptions: fresh.filter(r => !r.description_summary).length };
    if (expectedSha === undefined) return manifest;
    // Insert only. Neither repeat uploads nor concurrent editors can overwrite curated text.
    if (fresh.length) {
      try {
        const result = await model.bulkWrite(fresh.map(row => ({ updateOne: { filter: { _id: row._id },
          update: { $setOnInsert: { ...row, approved: true, revision: 1, updatedBy: actor, createdAt: new Date(), updatedAt: new Date() } }, upsert: true, timestamps: false } })), { ordered: true });
        manifest.inserted = result.upsertedCount;
      } catch (e) {
        logger.error('TARIC approved-code import failed; retry the file to complete insert-only import', { category: 'taric', metadata: { operation: 'codes.import' } });
        throw e;
      }
    } else manifest.inserted = 0;
    return manifest;
  }
  return { list, edit, importCsv, lookup, check };
}
function registryCandidate(candidate, entry) {
  return { ...candidate, approvedDescription: entry.description_summary,
    approvedCode: entry, approvedCodeHash: hash(entry),
    missingness: { ...candidate.missingness, approvedDescription: false } };
}
module.exports = { createApprovedCodes, parseCsv, code, fields, registryCandidate, MAX_BYTES };
