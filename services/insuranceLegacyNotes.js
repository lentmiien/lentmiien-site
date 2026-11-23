const { Types } = require('mongoose');
const Claim = require('../models/insurance_claim');
const { Batch, ensureBatchIndexes } = require('../models/insurance_batch');
const { Group } = require('../models/document_vault');
const { VaultError } = require('./documentVault/policy');
const { visibility } = require('./insuranceBatches');

async function read(actor, owner, date) {
  const key = owner + '/' + date;
  const groups = await Claim.aggregate([{ $match: { status: 'completed', submittedOn: date } },
    { $group: { _id: '$groupId' } },
    { $lookup: { from: Group.collection.name, localField: '_id', foreignField: '_id',
      pipeline: [{ $match: { ownerId: new Types.ObjectId(owner), state: 'ready' } }, { $project: { viewerIds: 1 } }], as: 'source' } },
    { $unwind: '$source' }, { $project: { allowed: { $in: [new Types.ObjectId(String(actor)), '$source.viewerIds'] } } },
  ]).option({ maxTimeMS: 10000 });
  if (!groups.length || (String(actor) !== owner && groups.some(g => !g.allowed))) return null;
  const saved = await Batch.findOne({ legacyKey: key }).select('_id').lean();
  if (!saved) return { revision: 0, text: '', groupIds: groups.map(g => g._id) };
  const [notes] = await Batch.aggregate([{ $match: { _id: saved._id } }, ...visibility(actor), { $project: { followUp: 1, __v: 1 } }]);
  return notes && { revision: notes.__v, text: notes.followUp, groupIds: groups.map(g => g._id) };
}
async function save(actor, owner, date, revision, notes) {
  const current = await read(actor, owner, date);
  if (!current) throw new VaultError(404, 'Batch unavailable.');
  if (revision !== current.revision) throw new VaultError(409, 'Follow-up notes changed. Refresh to continue.');
  await ensureBatchIndexes();
  const result = await Batch.updateOne({ legacyKey: owner + '/' + date, __v: revision },
    { $set: { ownerId: owner, status: 'legacy', groupIds: current.groupIds, followUp: notes }, $inc: { __v: 1 } }, { upsert: revision === 0 });
  if (!result.modifiedCount && !result.upsertedCount) throw new VaultError(409, 'Follow-up notes changed.');
}
module.exports = { read, save };
