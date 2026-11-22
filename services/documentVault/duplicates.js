const { Types } = require('mongoose');
const { Group, Scan, DuplicateFeedback } = require('../../models/document_vault');
const Claim = require('../../models/insurance_claim');
const { mutate } = require('./repository');
const { isInvoiceTag } = require('./content');
const { filingLocked, refreshSummary } = require('./workflow');
const { VaultError, PAGE_SIZE, sameId, validId, INTAKE } = require('./policy');

const THRESHOLD = 85;
const pending = 'possible_duplicate';
const reviewed = ['stored', 'approved'];
const missing = () => new VaultError(404, 'Duplicate review not found.');
const changed = () => new VaultError(409, 'The comparison changed. Refresh duplicate review.');
const membership = actor => ({ $or: [{ ownerId: actor }, { viewerIds: actor }] });

// Multiset Sørensen–Dice over adjacent Unicode characters. Repeated phrases
// contribute only as many times as they occur in both scans.
function characterPairs(text) {
  const chars = Array.from((text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, ''));
  const pairs = new Map();
  const size = chars.length > 1 ? chars.length - 1 : chars.length;
  for (let i = 0; i < size; i++) {
    const pair = chars[i] + (chars[i + 1] || '');
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }
  return { pairs, size };
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const [pair, n] of right.pairs) common += Math.min(n, left.pairs.get(pair) || 0);
  return 200 * common / (left.size + right.size);
}

async function nextMatch(group, page, actor, through = page.duplicateThrough) {
  const invoice = page.tags.some(isInvoiceTag);
  if (!page.documentDate || (invoice && page.totalAmount == null)) return null;
  const source = !invoice && characterPairs(page.ocrText);
  if (!invoice && !source.size) return null;
  const criteria = { state: { $in: reviewed }, documentDate: page.documentDate,
    tags: invoice ? /^invoice$/i : { $not: /^invoice$/i } };
  if (invoice) criteria.totalAmount = page.totalAmount;
  const filter = Object.fromEntries(Object.entries(criteria).map(([key, value]) => ['pages.' + key, value]));
  filter['pages._id'] = { $ne: page._id };
  if (page.duplicateAfter) filter['pages._id'].$gt = page.duplicateAfter;
  const pipeline = [
    { $match: { state: 'ready', ownerId: group.ownerId, pages: { $elemMatch: criteria } } },
    { $unwind: '$pages' }, { $match: filter },
    { $match: { $or: [{ 'pages.duplicateReviewedAt': null }, { 'pages.duplicateReviewedAt': { $lte: through } }] } },
    // The first check sees concurrent reviews regardless of write order. If both
    // are flagged, only the later one may be deleted against the other.
    ...(actor || page.duplicateAfter ? [{ $match: { $or: [
      { 'pages.duplicateStatus': null }, { 'pages.duplicateReviewedAt': { $lt: page.duplicateReviewedAt } },
      { 'pages.duplicateReviewedAt': page.duplicateReviewedAt, 'pages._id': { $lt: page._id } },
    ] } }] : []),
    { $project: { _id: '$pages._id', title: '$pages.title', state: '$pages.state', viewerIds: 1,
      revision: '$pages.revision', ...(invoice ? {} : { ocrText: '$pages.ocrText' }) } }, { $sort: { _id: 1 } },
  ];
  const cursor = Group.aggregate(pipeline).option({ maxTimeMS: 15000 }).cursor({ batchSize: 16 });
  try {
    for await (const other of cursor) {
      const score = invoice ? null : overlap(source, characterPairs(other.ocrText));
      if (!invoice && score < THRESHOLD) continue;
      if (actor && !sameId(group.ownerId, actor) && !(other.state === 'stored' && other.viewerIds.some(id => sameId(id, actor)))) {
        return { restricted: true };
      }
      return { id: String(other._id), title: other.title, revision: other.revision, score };
    }
    return null;
  } finally { await cursor.close(); }
}

async function check(group, page) {
  if (page.duplicateStatus !== 'checking' || !reviewed.includes(page.state)) return;
  const through = page.duplicateThrough || new Date();
  const match = await nextMatch(group, page, null, through);
  const filter = { _id: group._id, pages: { $elemMatch: { _id: page._id,
    duplicateStatus: 'checking', state: { $in: reviewed }, duplicateReviewedAt: page.duplicateReviewedAt,
    duplicateAfter: page.duplicateAfter ?? null } } };
  const update = match
    ? { $set: { 'pages.$.duplicateStatus': pending, 'pages.$.duplicateThrough': through } }
    : { $unset: { 'pages.$.duplicateStatus': 1, 'pages.$.duplicateThrough': 1, 'pages.$.duplicateAfter': 1 } };
  await Group.updateOne(filter, { ...update, $inc: { __v: 1 } });
}

async function listing(actor, offset) {
  const rows = await Group.aggregate([
    { $match: { state: 'ready', ...membership(new Types.ObjectId(String(actor))), 'pages.duplicateStatus': pending } },
    { $unwind: '$pages' }, { $match: { 'pages.duplicateStatus': pending, 'pages.state': 'stored' } },
    { $sort: { 'pages.duplicateReviewedAt': 1, 'pages._id': 1 } }, { $skip: offset }, { $limit: PAGE_SIZE + 1 },
    { $project: { _id: '$pages._id', title: '$pages.title', date: '$pages.documentDate' } },
  ]).option({ maxTimeMS: 5000 });
  const stats = await DuplicateFeedback.aggregate([{ $group: { _id: '$outcome', count: { $sum: 1 },
    min: { $min: '$overlap' }, mean: { $avg: '$overlap' }, max: { $max: '$overlap' } } }, { $sort: { _id: 1 } }]);
  return { rows: rows.slice(0, PAGE_SIZE), more: rows.length > PAGE_SIZE, stats };
}

async function comparison(id, actor) {
  if (!validId(id)) throw missing();
  const group = await Group.findOne({ state: 'ready', ...membership(actor),
    pages: { $elemMatch: { _id: id, state: 'stored', duplicateStatus: pending } } });
  if (!group) throw missing();
  const page = group.pages.id(id);
  return { group, page, match: await nextMatch(group, page, actor) };
}

// The page decision and its pending side effects share one atomic group save.
// Repeat each effect safely after a crash, including removal of the last scan.
async function flush(group) {
  for (const effect of group.duplicateEffects || []) {
    if (effect.overlap != null) await DuplicateFeedback.updateOne({ _id: effect._id },
      { $setOnInsert: { overlap: effect.overlap, outcome: effect.outcome } }, { upsert: true });
    if (effect.removePage) {
      await Scan.deleteOne({ _id: effect.removePage, groupId: group._id });
      await Claim.deleteOne({ _id: effect.removePage, groupId: group._id });
    }
    await Group.updateOne({ _id: group._id, 'duplicateEffects._id': effect._id },
      { $pull: { duplicateEffects: { _id: effect._id } }, $inc: { __v: 1 } });
  }
  await Group.deleteOne({ _id: group._id, state: 'ready', pages: { $size: 0 }, 'duplicateEffects.0': { $exists: false } });
}

async function decide(id, actor, body) {
  const { group, page, match } = await comparison(id, actor);
  if (match?.restricted) throw new VaultError(403, 'The owner must review this comparison.');
  if (String(page.revision) !== body.revision || (match ? match.id + '/' + match.revision : '') !== body.match) throw changed();
  if (!['unique', 'duplicate'].includes(body.outcome) || (!match && body.outcome === 'duplicate')) throw changed();
  if (body.outcome === 'duplicate' && filingLocked(group, page)) throw new VaultError(409, 'This filed document is locked.');
  const updated = await mutate({ _id: group._id, state: 'ready', ...membership(actor), __v: group.__v }, current => {
    const target = current.pages.id(id);
    if (match?.score != null || body.outcome === 'duplicate') {
      current.duplicateEffects ||= [];
      current.duplicateEffects.push({ overlap: match?.score, outcome: body.outcome,
        removePage: body.outcome === 'duplicate' ? target._id : undefined });
    }
    if (body.outcome === 'duplicate') {
      current.pages.pull(target._id);
      current.jobs = current.jobs.filter(job => !sameId(job.pageId, id) && job.kind !== 'group');
      if (current.pages.length) refreshSummary(current, current.uploaderId, INTAKE);
    } else {
      if (!match) target.duplicateThrough = undefined;
      target.duplicateAfter = match?.id;
      target.duplicateStatus = match ? 'checking' : undefined;
      target.revision++;
    }
  });
  if (updated.duplicateEffects?.length) await flush(updated);
  if (updated.pages.id(id)) await check(updated, updated.pages.id(id));
}

async function recover() {
  const groups = await Group.find({ state: 'ready', $or: [
    { pages: { $elemMatch: { duplicateStatus: 'checking', state: { $in: reviewed } } } },
    { 'duplicateEffects.0': { $exists: true } }, { pages: { $size: 0 } },
  ] }).limit(16);
  for (const group of groups) {
    for (const page of group.pages) await check(group, page);
    if (!group.pages.length || group.duplicateEffects?.length) await flush(group);
  }
}
module.exports = { check, listing, comparison, decide, recover, THRESHOLD, characterPairs, overlap };
