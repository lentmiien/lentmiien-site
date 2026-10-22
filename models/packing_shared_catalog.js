const mongoose = require('mongoose');
const LegacyCatalog = require('./packing_container_catalog');
const schema = new mongoose.Schema({
  _id: { type: String, enum: ['shared'] },
  containers: LegacyCatalog.schema.path('containers').options,
  revision: { type: Number, required: true, default: 0, min: 0 },
  migratedFrom: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
}, { collection: 'packing_shared_container_catalogs', timestamps: true, bufferCommands: false });
module.exports = mongoose.model('PackingSharedCatalog', schema);
