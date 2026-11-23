const { invoices } = require('./insuranceInvoices');
const { Types } = require('mongoose');
const { Plan, Batch, ensureBatchIndexes } = require('../models/insurance_batch');
const { Group } = require('../models/document_vault');
const User = require('../models/useraccount');
const { VaultError, PAGE_SIZE } = require('./documentVault/policy');

const oid = value => new Types.ObjectId(String(value));
const options = { maxTimeMS: 10000 };
const missing = () => new VaultError(404, 'Plan or batch unavailable.');
const conflict = () => new VaultError(409, 'This batch or invoice changed. Refresh before trying again.');
const accounts = { type_user: { $in: ['admin', 'family'] } };
const family = user => ['admin', 'family'].includes(user.type_user);
const scope = actor => ({ $or: [{ ownerId: oid(actor) }, { viewerIds: oid(actor) }] });

// Batch notes may describe every attachment. A delegate needs current access to all source groups.
function visibility(actor) {
  return [
    { $lookup: { from: Group.collection.name, localField: 'groupIds', foreignField: '_id',
      pipeline: [{ $match: { state: 'ready', ...scope(actor) } }, { $project: { _id: 1 } }], as: 'accessible' } },
    { $match: { $or: [{ ownerId: oid(actor),
      $expr: { $setIsSubset: [{ $ifNull: ['$externalGroupIds', []] }, '$accessible._id'] } }, { 'groupIds.0': { $exists: true },
      $expr: { $eq: [{ $size: '$accessible' }, { $size: '$groupIds' }] } }] } },
    { $unset: 'accessible' },
  ];
}
async function getBatch(actor, id, reveal = false) {
  const pipeline = [{ $match: { _id: oid(id), status: { $in: ['draft', 'submitted'] } } }, ...visibility(actor)];
  if (!reveal) pipeline.push({ $unset: 'plan.number' });
  const [batch] = await Batch.aggregate(pipeline).option(options);
  if (!batch) throw missing();
  return batch;
}
async function drafts(actor, offset) {
  return Batch.aggregate([{ $match: { status: 'draft' } }, ...visibility(actor), { $sort: { updatedAt: -1, _id: -1 } },
    { $skip: offset }, { $limit: PAGE_SIZE + 1 },
    { $lookup: { from: User.collection.name, localField: 'ownerId', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'owner' } },
    { $project: { owner: { $first: '$owner.name' }, count: { $size: '$invoiceIds' }, title: { $first: '$invoices.title' } } },
  ]).option(options);
}

async function planDirectory(offset) {
  return Plan.aggregate([{ $sort: { ownerId: 1, name: 1, _id: 1 } }, { $skip: offset }, { $limit: PAGE_SIZE + 1 },
    { $lookup: { from: User.collection.name, localField: 'ownerId', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'owner' } },
    { $project: { owner: { $first: '$owner.name' }, name: 1, company: 1 } }]).option(options);
}
async function savePlan(id, body) {
  const { ownerId, revision, number, clearNumber, ...fields } = body;
  if (!await User.exists({ _id: ownerId, ...accounts })) throw new VaultError(422, 'Select a family policyholder.');
  if (number && clearNumber) throw new VaultError(422, 'Choose a replacement policy number or clear the saved one.');
  if (number || clearNumber) fields.number = number || '';
  if (!id) return Plan.create({ ownerId, ...fields });
  const saved = await Plan.findOneAndUpdate({ _id: id, __v: revision }, { $set: { ...fields, ownerId }, $inc: { __v: 1 } }, { returnDocument: 'after' });
  if (!saved) throw conflict();
  return saved;
}
async function planDetail(id, reveal = false) {
  const query = Plan.findById(id);
  if (reveal) query.select('+number');
  const plan = await query.lean();
  if (!plan) throw missing();
  return plan;
}
function documentPipeline(actor, owner, ids) {
  // Attaching a scan must never share it with a policyholder who cannot read it.
  const filter = { state: 'ready', $and: [scope(actor), scope(owner)] };
  if (ids) filter['pages._id'] = { $in: ids.map(oid) };
  return [{ $match: filter }, { $unwind: '$pages' }, { $match: {
    'pages.state': 'stored', ...(ids ? { 'pages._id': filter['pages._id'] } : {}),
  } }, { $project: { _id: '$pages._id', pageId: '$pages._id', groupId: '$_id', ownerId: 1,
    title: { $ifNull: ['$pages.title', '$pages.filename'] }, date: '$pages.documentDate', amount: '$pages.totalAmount', currency: '$pages.currency' } }];
}
async function picker(actor, batch, kind, q, offset) {
  const pipeline = kind === 'invoice' ? [...invoices(actor, { owner: String(batch.ownerId) }), { $match: { status: 'processing' } }]
    : documentPipeline(actor, batch.ownerId);
  pipeline.push({ $match: { _id: { $nin: [...batch.invoiceIds, ...batch.supportingIds] }, title: new RegExp(RegExp.escape(q), 'i') } },
    { $sort: { date: -1, _id: 1 } }, { $skip: offset }, { $limit: PAGE_SIZE + 1 });
  return Group.aggregate(pipeline).option(options);
}
const item = row => ({ pageId: row._id, groupId: row.groupId, ownerId: row.ownerId, title: row.title, date: row.date, amount: row.amount, currency: row.currency });
async function invoiceRows(actor, ids, owner, status) {
  const rows = await Group.aggregate(invoices(actor, { owner, ids })).option(options);
  if (rows.length !== ids.length || rows.some(row => row.status !== status)) throw conflict();
  return rows;
}
async function createDraft(actor, ids) {
  const rows = await invoiceRows(actor, ids, null, 'processing');
  if (new Set(rows.map(row => String(row.ownerId))).size !== 1) throw new VaultError(422, 'Select invoices for one policyholder per batch.');
  if (!await User.exists({ _id: rows[0].ownerId, ...accounts })) throw new VaultError(422, 'A batch needs an admin or family policyholder.');
  await ensureBatchIndexes();
  return Batch.create({ status: 'draft', ownerId: rows[0].ownerId, anchorGroupId: rows[0].groupId, invoiceIds: ids,
    invoices: rows.map(item), groupIds: [...new Set(rows.map(row => String(row.groupId)))] });
}
async function draftDetails(actor, batch, body) {
  const planQuery = Plan.findOne({ _id: body.planId || null, ownerId: batch.ownerId });
  if (body.action === 'submit') planQuery.select('+number');
  const plan = body.planId && await planQuery.lean();
  if (body.planId && !plan) throw missing();
  const changes = { planId: plan?._id || null, notes: body.notes };
  if (body.action === 'details') return changes;
  if (!plan || !batch.invoiceIds.length) throw new VaultError(422, 'Choose a plan and at least one invoice before submission.');
  const [rows, supporting] = await Promise.all([
    invoiceRows(actor, batch.invoiceIds, String(batch.ownerId), 'draft'),
    Group.aggregate(documentPipeline(actor, batch.ownerId, batch.supportingIds)).option(options),
  ]);
  if (supporting.length !== batch.supportingIds.length) throw new VaultError(409, 'A supporting document is unavailable. Remove it before submitting.');
  return { ...changes, status: 'submitted', submittedOn: body.submittedOn, plan, invoices: rows.map(item), supporting: supporting.map(item) };
}

async function draftAttachments(actor, batch, body) {
  const invoice = body.kind === 'invoice';
  let entries = invoice ? batch.invoices : batch.supporting;
  if (body.action === 'add') {
    const attached = [...batch.invoiceIds, ...batch.supportingIds];
    if (attached.length >= 128) throw new VaultError(422, 'A batch holds up to 128 scans.');
    if (attached.some(id => String(id) === body.pageId)) throw conflict();
    const rows = invoice ? await invoiceRows(actor, [body.pageId], String(batch.ownerId), 'processing')
      : await Group.aggregate(documentPipeline(actor, batch.ownerId, [body.pageId])).option(options);
    if (!rows.length) throw missing();
    entries = [...entries, item(rows[0])];
  } else {
    entries = entries.filter(row => String(row.pageId) !== body.pageId);
  }
  const changes = invoice ? { invoices: entries, invoiceIds: entries.map(row => row.pageId) }
    : { supporting: entries, supportingIds: entries.map(row => row.pageId) };
  const remainingInvoices = changes.invoices || batch.invoices;
  const all = [...remainingInvoices, ...(changes.supporting || batch.supporting)];
  // A supporting scan alone cannot delegate authority over the policyholder's draft.
  changes.anchorGroupId = remainingInvoices[0]?.groupId || batch.anchorGroupId;
  changes.groupIds = [...new Set([String(changes.anchorGroupId), ...all.map(row => String(row.groupId))])];
  changes.externalGroupIds = all.filter(row => String(row.ownerId) !== String(batch.ownerId)).map(row => row.groupId);
  return changes;
}

async function edit(actor, id, body) {
  const batch = await getBatch(actor, id);
  const expected = body.action === 'followUp' ? 'submitted' : 'draft';
  if (batch.__v !== body.revision || batch.status !== expected) throw conflict();
  const filter = { _id: id, __v: body.revision, status: expected };
  if (body.action === 'discard') {
    if (!(await Batch.deleteOne(filter)).deletedCount) throw conflict();
    return;
  }
  let changes;
  switch (body.action) {
    case 'followUp': changes = { followUp: body.notes }; break;
    case 'details':
    case 'submit': changes = await draftDetails(actor, batch, body); break;
    case 'add':
    case 'remove': changes = await draftAttachments(actor, batch, body); break;
    default: throw new VaultError(422, 'Choose an available batch action.');
  }
  if (body.action === 'add' && body.kind === 'invoice') await ensureBatchIndexes();
  if (!(await Batch.updateOne(filter, { $set: changes, $inc: { __v: 1 } })).modifiedCount) throw conflict();
}
module.exports = { family, accounts, visibility, getBatch, drafts, planDirectory, savePlan, planDetail, createDraft, edit, picker };
