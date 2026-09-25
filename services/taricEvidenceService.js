const logger = require('../utils/logger');
const { SCHEMA_VERSION, LIMITS, FACT_FIELDS, TaricError, fail, string, jan, gcode,
  validateRequest, validateEvidence, hash } = require('../utils/taricContracts');

const DETAIL_FIELDS = Object.freeze({ name: 'itemName', specifications: 'specifications',
  details: 'details', remarks: 'remarks', brand: 'brand', seriesTitle: 'seriesTitle',
  characterName: 'characterName', releaseDate: 'releaseDate' });

function optionalText(value, max = LIMITS.text) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return string(value, max, 'EVIDENCE_INVALID');
}
function assertIdentity(row, request) {
  gcode(row.gcode, 'EVIDENCE_INVALID');
  if (row.detailsType && !['object', 'missing', 'null'].includes(row.detailsType)) fail('EVIDENCE_INVALID');
  if (!row.listing || row.listing.gcode !== row.gcode) fail('IDENTITY_MISMATCH');
  const detailCode = row.details?.gcode;
  if (detailCode !== undefined && detailCode !== null && detailCode !== ''
    && detailCode !== row.gcode) fail('IDENTITY_MISMATCH');
  if (request.item_code && row.gcode !== request.item_code) fail('IDENTITY_MISMATCH');
  const storedJan = optionalText(row.details?.janCode, 13);
  if (storedJan !== null) jan(storedJan, 'EVIDENCE_INVALID');
  if (request.jan) {
    if (!storedJan) fail('IDENTITY_UNVERIFIABLE');
    if (storedJan !== request.jan) fail('IDENTITY_MISMATCH');
  }
  return storedJan;
}
function snapshot(row, request, resolution) {
  const storedJan = assertIdentity(row, request);
  const details = row.details || {};
  // The upstream normalizer stores scode separately; it is not a product identity.
  const scode = optionalText(details.scode, 64);
  const credible = (value) => {
    const name = optionalText(value, LIMITS.name);
    return name && name.trim().toLowerCase() !== row.gcode.toLowerCase() ? name : null;
  };
  const detailName = credible(details.itemName);
  const name = detailName || credible(row.listing.itemName);
  if (!name) fail('EVIDENCE_INCOMPLETE');
  const facts = Object.fromEntries(FACT_FIELDS.map((field) => [field,
    field === 'name' ? name : optionalText(details[DETAIL_FIELDS[field]])]));
  const timestamp = details.apiFetchedAt || row.detailFetchedAt || null;
  let fetchedAt = null;
  if (timestamp !== null) {
    if (!(timestamp instanceof Date) && typeof timestamp !== 'string') fail('EVIDENCE_INVALID');
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) fail('EVIDENCE_INVALID');
    fetchedAt = date.toISOString();
  }
  const warnings = [];
  if (!facts.specifications) warnings.push('specifications_missing');
  if (!facts.details) warnings.push('details_missing');
  if (!detailName) warnings.push('listing_name_fallback');
  if (!fetchedAt) warnings.push('source_timestamp_missing');
  const content = {
    schema_version: SCHEMA_VERSION, gcode: row.gcode, jan: storedJan, facts,
    provenance: { source: 'amiami', source_url: `https://www.amiami.com/eng/detail?gcode=${row.gcode}`,
      ...(scode === null ? {} : { scode }),
      resolution, name_field: detailName ? 'details.itemName' : 'listing.itemName',
      identity: request.jan ? (request.item_code ? 'both_agree' : 'jan') : 'item_code',
      fetched_at: fetchedAt, fields: Object.fromEntries(FACT_FIELDS.map((field) => [field, facts[field] !== null])) },
    warnings,
  };
  return validateEvidence({ ...content, hash: hash(content) });
}

// Limit returned data in Mongo, before the driver allocates full source fields. Over-limit
// strings retain one extra character so validation rejects, never silently truncates facts.
function boundedField(path, max) {
  return { $cond: [{ $eq: [{ $type: `$${path}` }, 'string'] },
    { $substrCP: [`$${path}`, 0, max + 1] },
    { $cond: [{ $in: [{ $type: `$${path}` }, ['missing', 'null']] }, null, false] }] };
}
function projection() {
  const fields = { _id: 1, updatedAt: 1, detailFetchedAt: 1, detailsType: { $type: '$details' },
    gcode: boundedField('gcode', 64), detailStatus: boundedField('detailStatus', 20),
    'listing.gcode': boundedField('listing.gcode', 64),
    'listing.itemName': boundedField('listing.itemName', LIMITS.name),
    'details.gcode': boundedField('details.gcode', 64),
    'details.scode': boundedField('details.scode', 64),
    'details.janCode': boundedField('details.janCode', 13), 'details.apiFetchedAt': 1 };
  for (const field of FACT_FIELDS) {
    const path = `details.${DETAIL_FIELDS[field]}`;
    fields[path] = boundedField(path, field === 'name' ? LIMITS.name : LIMITS.text);
  }
  return fields;
}

function createTaricEvidenceService({ itemModel, fetchFactual = null, serviceLogger = logger,
  now = Date.now } = {}) {
  // fetchFactual is an explicitly trusted infrastructure dependency, NOT a caller option.
  // No default transport exists. It must enforce deadline/streamed bytes/redirect denial.
  const attempts = [];
  const inFlight = new Set();
  async function aggregate(pipeline) {
    return itemModel.aggregate(pipeline).option({ maxTimeMS: LIMITS.queryMs }).exec();
  }
  async function findCode(code) {
    const rows = await aggregate([{ $match: { gcode: code } }, { $limit: 2 }, { $project: projection() }]);
    if (rows.length > 1) fail('IDENTITY_MISMATCH');
    return rows[0] || null;
  }
  async function fetchAndPersist(request, existing) {
    if (!fetchFactual) fail('FETCH_DISABLED');
    const time = now();
    while (attempts.length && attempts[0].at <= time - 60000) attempts.shift();
    // Bounded retry of incomplete/error records: at most once/code/minute, 20/minute
    // and two active attempts per factory. This is not a distributed endpoint limiter.
    if (attempts.length >= 20 || inFlight.size >= 2 || inFlight.has(request.item_code)
      || attempts.some((attempt) => attempt.code === request.item_code)) fail('FETCH_LIMITED');
    if (existing && (!(existing.updatedAt instanceof Date) || !existing._id)) fail('EVIDENCE_RACE');
    attempts.push({ at: time, code: request.item_code });
    inFlight.add(request.item_code);
    try {
      let details;
      try {
        details = await fetchFactual(request.item_code);
      } catch (cause) {
        const error = new TaricError(['HTTP_ACCESS_DENIED', 'TLS_CHAIN_UNTRUSTED', 'FETCH_DISABLED'].includes(cause.code) ? cause.code : 'FETCH_FAILED');
        error.transport = require('../utils/taricDiagnostics').errorStatus(cause.transport);
        throw error;
      }
      if (!details || details.gcode !== request.item_code) fail('IDENTITY_MISMATCH');
      const fetchedAt = new Date(now());
      const candidate = { gcode: request.item_code,
        listing: { gcode: request.item_code, itemName: details.itemName },
        details: { ...details, apiFetchedAt: fetchedAt }, detailFetchedAt: fetchedAt };
      const evidence = snapshot(candidate, request, 'online_item_code');
      // Persist an allowlist only. Neither API raw data nor supplied URLs survive.
      const safeDetails = { gcode: candidate.gcode, janCode: evidence.jan,
        apiFetchedAt: fetchedAt, sourceUrl: evidence.provenance.source_url };
      if (evidence.provenance.scode !== undefined) safeDetails.scode = evidence.provenance.scode;
      for (const field of FACT_FIELDS) safeDetails[DETAIL_FIELDS[field]] = evidence.facts[field];
      const record = { gcode: candidate.gcode, url: evidence.provenance.source_url,
        source: 'taric-amiami-factual', sourceUrl: evidence.provenance.source_url,
        firstSeenAt: fetchedAt, lastSeenAt: fetchedAt, listingChangedAt: fetchedAt,
        listing: { gcode: candidate.gcode, url: evidence.provenance.source_url, itemName: evidence.facts.name },
        details: safeDetails, detailStatus: 'fetched', detailFetchedAt: fetchedAt,
        detailError: { message: null, at: null } };
      try {
        if (existing) {
          // Preserve legacy fields outside the factual allowlist on an existing detail
          // object. A null/missing detail container must first be created as an object.
          const detailsType = existing.detailsType || (existing.details == null ? 'null' : 'object');
          const detailUpdate = detailsType === 'object'
            ? Object.fromEntries(Object.entries(safeDetails).map(([field, value]) => [`details.${field}`, value]))
            : { details: safeDetails };
          await itemModel.updateOne({ _id: existing._id, gcode: candidate.gcode, updatedAt: existing.updatedAt },
            { $set: { ...detailUpdate, detailStatus: 'fetched', detailFetchedAt: fetchedAt,
              detailError: record.detailError } }, { runValidators: true }).exec();
        } else {
          await itemModel.updateOne({ gcode: candidate.gcode }, { $setOnInsert: record },
            { upsert: true, runValidators: true, setDefaultsOnInsert: true }).exec();
        }
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
      const winner = await findCode(candidate.gcode);
      if (!winner || !winner.details || ['missing', 'null'].includes(winner.detailsType) || ['error', 'pending'].includes(winner.detailStatus)) fail('EVIDENCE_RACE');
      // A raced winner may contain different facts. Return its validated snapshot, never ours.
      const winnerSnapshot = snapshot(winner, request, 'online_item_code');
      return winnerSnapshot.hash === evidence.hash ? winnerSnapshot : snapshot(winner, request, 'local_item_code');
    } finally { inFlight.delete(request.item_code); }
  }
  async function resolve(input) {
    const request = validateRequest(input);
    try {
      let row;
      if (request.item_code) row = await findCode(request.item_code);
      else {
        const matches = await aggregate([{ $match: { 'details.janCode': request.jan } },
          { $group: { _id: '$gcode' } }, { $limit: 2 },
          { $project: { _id: 0, gcode: boundedField('_id', 64) } }]);
        if (matches.length > 1) fail('JAN_AMBIGUOUS');
        if (!matches.length) fail('EVIDENCE_NOT_FOUND');
        row = await findCode(gcode(matches[0].gcode, 'EVIDENCE_INVALID'));
      }
      if (row) {
        try {
          const evidence = snapshot(row, request, request.item_code ? 'local_item_code' : 'local_jan');
          if (row.detailStatus !== 'error' && row.detailStatus !== 'pending' && row.details && !['missing', 'null'].includes(row.detailsType)) return evidence;
        } catch (error) {
          if (!(error instanceof TaricError)
            || !['EVIDENCE_INCOMPLETE', 'IDENTITY_UNVERIFIABLE'].includes(error.code)) throw error;
          if (!request.item_code || (error.code === 'IDENTITY_UNVERIFIABLE' && !fetchFactual)) throw error;
        }
      }
      if (!request.item_code) fail('EVIDENCE_INCOMPLETE');
      return await fetchAndPersist(request, row);
    } catch (error) {
      const safe = error instanceof TaricError ? error : new TaricError('STORAGE_FAILED');
      if (!['JAN_AMBIGUOUS', 'EVIDENCE_NOT_FOUND', 'FETCH_DISABLED', 'FETCH_LIMITED'].includes(safe.code)) {
        serviceLogger.warning('TARIC evidence resolution requires follow-up', {
          category: 'taric-evidence', metadata: { code: safe.code, transport: require('../utils/taricDiagnostics').errorStatus(safe.transport) },
        });
      }
      throw safe;
    }
  }
  async function resolveLocal(input, resolvedGcode = null) {
    const request = validateRequest(input);
    // A previously resolved identity may disambiguate a JAN, but must still
    // agree with that JAN. Never call fetchAndPersist or any fallback transport.
    if (!request.jan) fail('INVALID_REQUEST');
    if (resolvedGcode) {
      const exact = await findCode(gcode(resolvedGcode, 'EVIDENCE_INVALID'));
      if (exact) return snapshot(exact, { ...request, item_code: resolvedGcode }, 'local_item_code');
    }
    const matches = await aggregate([{ $match: { 'details.janCode': request.jan } },
      { $group: { _id: '$gcode' } }, { $limit: 2 }, { $project: { _id: 0, gcode: boundedField('_id', 64) } }]);
    if (matches.length > 1) fail('JAN_AMBIGUOUS');
    if (!matches.length) fail('EVIDENCE_NOT_FOUND');
    const row = await findCode(gcode(matches[0].gcode, 'EVIDENCE_INVALID'));
    if (!row) fail('EVIDENCE_NOT_FOUND');
    return snapshot(row, request, 'local_jan');
  }
  return { resolve, resolveLocal };
}

module.exports = { createTaricEvidenceService, snapshot, projection };
