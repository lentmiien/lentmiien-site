const { Types } = require('mongoose');
const Claim = require('../models/insurance_claim');
const { Batch } = require('../models/insurance_batch');

const invoiceTag = /^invoice$/i;
const filedInvoice = { state: 'stored', tags: invoiceTag, duplicateStatus: null };

// Every query starts from current vault membership and page eligibility.
// A freshly filed page is actionable even before the next importer sweep.
function invoices(actor, { ids, owner } = {}) {
  const principal = new Types.ObjectId(String(actor));
  const scope = { state: 'ready', $or: [{ ownerId: principal }, { viewerIds: principal }], pages: { $elemMatch: filedInvoice } };
  if (owner) scope.ownerId = new Types.ObjectId(owner);
  const pageFilter = { 'pages.state': 'stored', 'pages.tags': invoiceTag, 'pages.duplicateStatus': null };
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
    { $lookup: { from: Batch.collection.name, localField: '_id', foreignField: 'invoiceIds',
      pipeline: [{ $project: { status: 1 } }], as: 'assignment' } },
    { $set: { status: { $ifNull: [{ $first: '$assignment.status' }, '$status'] } } },
    { $unset: ['claim', 'assignment'] },
  ];
}

module.exports = { invoices, invoiceTag, filedInvoice };
