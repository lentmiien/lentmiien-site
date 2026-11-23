const mongoose = require('mongoose');
const { Schema } = mongoose;
const id = Schema.Types.ObjectId;

const planFields = {
  name: String, company: String, startDate: String, monthlyCost: String, currency: String,
  coverage: String, claimUrl: String, instructions: String, number: { type: String, select: false },
};
const plan = new Schema({ ownerId: { type: id, required: true }, ...planFields }, { timestamps: true });
plan.index({ ownerId: 1, name: 1 });
const item = new Schema({ pageId: id, groupId: id, ownerId: id, title: String, date: String, amount: Number, currency: String }, { _id: false });
const batch = new Schema({
  ownerId: { type: id, required: true }, status: { type: String, enum: ['draft', 'submitted', 'expired', 'legacy'], required: true },
  invoiceIds: [id], supportingIds: [id], groupIds: [id], anchorGroupId: id, externalGroupIds: [id], planId: id,
  invoices: [item], supporting: [item], plan: new Schema(planFields, { _id: false }),
  notes: String, followUp: String, submittedOn: String, legacyKey: String,
}, { timestamps: true, optimisticConcurrency: true });
// A single document write reserves or releases all selected invoices on standalone MongoDB.
batch.index({ invoiceIds: 1 }, { unique: true, partialFilterExpression: { 'invoiceIds.0': { $exists: true } } });
batch.index({ legacyKey: 1 }, { unique: true, sparse: true });
batch.index({ status: 1, ownerId: 1 });
module.exports = { Plan: mongoose.model('InsurancePlan', plan), Batch: mongoose.model('InsuranceBatch', batch) };
