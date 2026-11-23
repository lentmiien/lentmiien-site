const { invoices, invoiceTag, filedInvoice } = require('./insuranceInvoices');
const { Batch } = require('../models/insurance_batch');
const { visibility } = require('./insuranceBatches');
const Claim = require('../models/insurance_claim');
const { Group } = require('../models/document_vault');
const User = require('../models/useraccount');
const { VaultError, PAGE_SIZE } = require('./documentVault/policy');
const logger = require('../utils/logger');

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
    .select('pages._id pages.state pages.tags pages.duplicateStatus').maxTimeMS(10000).lean();
  const rows = groups.flatMap(group => group.pages.filter(page =>
    page.state === 'stored' && !page.duplicateStatus && page.tags?.some(tag => invoiceTag.test(tag))
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

function monthlyTotals(dateField) {
  return [
    { $group: {
      _id: { month: { $substrCP: [dateField, 0, 7] }, currency: { $ifNull: ['$currency', null] } },
      count: { $sum: 1 },
      missing: { $sum: { $cond: [{ $isNumber: '$amount' }, 0, 1] } },
      total: { $sum: { $toDecimal: { $toString: '$amount' } } },
    } },
    { $sort: { '_id.month': -1, '_id.currency': 1 } },
  ];
}

function summarize(monthly) {
  let count = 0;
  const months = new Map();
  for (const { _id, total, count: entries, missing } of monthly) {
    const month = _id.month || 'Undated';
    if (!months.has(month)) months.set(month, { month, totals: [], missing: 0 });
    const row = months.get(month);
    count += entries;
    row.missing += missing;
    if (entries > missing) row.totals.push({ amount: total.toString(), currency: _id.currency });
  }
  return { count, months: [...months.values()] };
}

async function list(actor, { view, date, owner, offset, includeSummary = false, includeSubmitted = false }, size = PAGE_SIZE) {
  const batches = view === 'batches';
  const status = batches || view === 'batch' ? 'completed' : view;
  const pipeline = [...invoices(actor, { owner }), { $match: date ? { status, submittedOn: date } : { status } }];
  if (batches && includeSubmitted) pipeline.push({ $unionWith: { coll: Batch.collection.name, pipeline: [
    { $match: { status: 'submitted' } }, ...visibility(actor), { $unwind: '$invoices' },
    { $project: { batchId: '$_id', ownerId: 1, submittedOn: 1, amount: '$invoices.amount', currency: '$invoices.currency', planName: '$plan.name' } },
  ] } });
  const groupBatches = { $group: { _id: { date: '$submittedOn', owner: '$ownerId', batch: '$batchId' }, planName: { $first: '$planName' }, count: { $sum: 1 } } };
  const page = batches ? [
    groupBatches,
    { $project: { ownerId: '$_id.owner', submittedOn: '$_id.date', batchId: '$_id.batch', planName: 1, count: 1 } },
    { $sort: { submittedOn: -1, ownerId: 1, batchId: 1 } },
  ] : [{ $sort: { date: 1, _id: 1 } }];
  page.push({ $skip: offset }, { $limit: size + 1 });

  let found, summary;
  if (includeSummary) {
    const facet = { page, monthly: monthlyTotals(batches ? '$submittedOn' : '$date') };
    if (batches) facet.batchCount = [groupBatches, { $count: 'count' }];
    const [result] = await Group.aggregate([...pipeline, { $facet: facet }]).option(queryLimit);
    found = result.page;
    summary = summarize(result.monthly);
    if (batches) summary.batchCount = result.batchCount[0]?.count || 0;
  } else {
    found = await Group.aggregate([...pipeline, ...page]).option(queryLimit);
  }
  const rows = found.slice(0, size);
  const names = await User.find({ _id: { $in: rows.map(row => row.ownerId) } }).select('_id name').lean();
  const owners = new Map(names.map(u => [String(u._id), u.name]));
  for (const row of rows) row.ownerName = owners.get(String(row.ownerId)) || 'Unavailable account';
  return { rows, more: found.length > size, summary };
}

const transitions = { unreviewed: ['processing', 'dismissed', 'expired'], processing: ['expired'] };
async function transition(actor, ids, prior, status) {
  if (!transitions[prior]?.includes(status)) throw new VaultError(422, 'Choose an available action for this invoice.');
  const rows = await Group.aggregate(invoices(actor, { ids })).option(queryLimit);
  if (rows.length !== ids.length) throw new VaultError(404, 'An invoice is no longer available.');
  if (rows.some(row => row.status !== prior)) throw new VaultError(409, 'An invoice has already moved. Refresh the list.');
  if (prior === 'unreviewed') await register(rows);
  if (prior === 'processing') {
    await Batch.init();
    await Batch.create({ status: 'expired', ownerId: rows[0].ownerId, invoiceIds: ids });
    return;
  }
  const changes = { status, updatedBy: actor };
  const result = await Claim.updateMany({ _id: { $in: ids }, status: prior }, { $set: changes });
  if (result.modifiedCount !== ids.length) throw new VaultError(409, 'Another reviewer moved an invoice. Refresh the list to see the saved statuses.');
}

module.exports = { start, stop, syncChunk, list, transition };
