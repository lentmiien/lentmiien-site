const { Types } = require('mongoose');
const Claim = require('../models/insurance_claim');
const { Group } = require('../models/document_vault');
const User = require('../models/useraccount');
const { VaultError, PAGE_SIZE } = require('./documentVault/policy');
const logger = require('../utils/logger');

const invoiceTag = /^invoice$/i;
const filedInvoice = { state: 'stored', tags: invoiceTag };
const queryLimit = { maxTimeMS: 10000 };

async function register(rows) {
  if (!rows.length) return;
  await Claim.bulkWrite(rows.map(row => ({ updateOne: {
    filter: { _id: row._id },
    update: { $setOnInsert: { groupId: row.groupId, status: 'unreviewed' } },
    upsert: true,
  } })), { ordered: false });
}

// Walk bounded groups in upload order. Repeat the sweep to discover pages
// reviewed later, including pages in batches uploaded before this tool existed.
async function syncChunk(after) {
  const filter = { state: 'ready', pages: { $elemMatch: filedInvoice } };
  if (after) filter._id = { $gt: after };
  const groups = await Group.find(filter).sort({ _id: 1 }).limit(32)
    .select('pages._id pages.state pages.tags').maxTimeMS(10000).lean();
  const rows = groups.flatMap(group => group.pages.filter(page =>
    page.state === 'stored' && page.tags?.some(tag => invoiceTag.test(tag))
  ).map(page => ({ _id: page._id, groupId: group._id })));
  const existing = new Set((await Claim.find({ _id: { $in: rows.map(row => row._id) } }).select('_id').lean()).map(row => String(row._id)));
  await register(rows.filter(row => !existing.has(String(row._id))));
  return groups.length === 32 ? groups.at(-1)._id : null;
}

let timer, cursor, running = false;
function start() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { cursor = await syncChunk(cursor); }
    catch (error) {
      logger.warning('Insurance invoice import failed; check database availability', { category: 'insurance', metadata: { errorName: error.name } });
    } finally { running = false; }
  };
  timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
}
function stop() { clearInterval(timer); timer = null; }

// Every query starts from current vault membership and page eligibility.
// A freshly filed page is actionable even before the next importer sweep.
function invoices(actor, { ids, owner } = {}) {
  const principal = new Types.ObjectId(String(actor));
  const scope = { state: 'ready', $or: [{ ownerId: principal }, { viewerIds: principal }], pages: { $elemMatch: filedInvoice } };
  if (owner) scope.ownerId = new Types.ObjectId(owner);
  const pageFilter = { 'pages.state': 'stored', 'pages.tags': invoiceTag };
  if (ids) {
    const inIds = { $in: ids.map(id => new Types.ObjectId(id)) };
    scope['pages._id'] = inIds;
    pageFilter['pages._id'] = inIds;
  }
  return [
    { $match: scope }, { $unwind: '$pages' }, { $match: pageFilter },
    { $project: { _id: '$pages._id', groupId: '$_id', ownerId: 1, title: { $ifNull: ['$pages.title', '$pages.filename'] },
      date: '$pages.documentDate', amount: '$pages.totalAmount', currency: '$pages.currency' } },
    { $lookup: { from: Claim.collection.name, localField: '_id', foreignField: '_id', as: 'claim' } },
    { $set: { status: { $ifNull: [{ $first: '$claim.status' }, 'unreviewed'] }, submittedOn: { $first: '$claim.submittedOn' } } },
    { $unset: 'claim' },
  ];
}

async function list(actor, { view, date, owner, offset }, size = PAGE_SIZE) {
  const pipeline = invoices(actor, { owner });
  if (view === 'batches') {
    pipeline.push({ $match: { status: 'completed' } },
      { $group: { _id: { date: '$submittedOn', owner: '$ownerId' }, count: { $sum: 1 } } },
      { $project: { ownerId: '$_id.owner', submittedOn: '$_id.date', count: 1 } },
      { $sort: { submittedOn: -1, ownerId: 1 } });
  } else {
    pipeline.push({ $match: date ? { status: 'completed', submittedOn: date } : { status: view } },
      { $sort: { date: 1, _id: 1 } });
  }
  const found = await Group.aggregate([...pipeline, { $skip: offset }, { $limit: size + 1 }]).option(queryLimit);
  const rows = found.slice(0, size);
  const names = await User.find({ _id: { $in: rows.map(row => row.ownerId) } }).select('_id name').lean();
  const owners = new Map(names.map(u => [String(u._id), u.name]));
  for (const row of rows) row.ownerName = owners.get(String(row.ownerId)) || 'Unavailable account';
  return { rows, more: found.length > size };
}

const transitions = { unreviewed: ['processing', 'dismissed', 'expired'], processing: ['completed', 'expired'] };
async function transition(actor, ids, prior, status, submittedOn) {
  if (!transitions[prior]?.includes(status)) throw new VaultError(422, 'Choose an available action for this invoice.');
  const rows = await Group.aggregate(invoices(actor, { ids })).option(queryLimit);
  if (rows.length !== ids.length) throw new VaultError(404, 'An invoice is no longer available.');
  if (rows.some(row => row.status !== prior)) throw new VaultError(409, 'An invoice has already moved. Refresh the list.');
  if (prior === 'unreviewed') await register(rows);
  const changes = { status, updatedBy: actor };
  if (submittedOn) changes.submittedOn = submittedOn;
  const result = await Claim.updateMany({ _id: { $in: ids }, status: prior }, { $set: changes });
  if (result.modifiedCount !== ids.length) throw new VaultError(409, 'Another reviewer moved an invoice. Refresh the list to see the saved statuses.');
}

module.exports = { start, stop, syncChunk, list, transition };
