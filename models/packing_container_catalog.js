const mongoose = require('mongoose');
const { Schema } = mongoose;
const { MAX_CONTAINERS } = require('../utils/smallestBoxValidation');
const dimension = { type: Number, required: true, min: Number.MIN_VALUE, max: 1000000 };
const weight = { type: Number, required: true, min: 0, max: 1000000 };
const containerSchema = new Schema({
  id: { type: String, required: true, trim: true, maxlength: 100 },
  tags: { type: [String], default: [], validate: tags => tags.length <= 20 && tags.every(tag => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(tag)) },
  w: dimension, d: dimension, h: dimension, emptyWeight: weight, maxLoadWeight: weight,
}, { _id: false });
const catalogSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true, unique: true },
  containers: { type: [containerSchema], default: [], validate: {
    validator: entries => entries.length <= MAX_CONTAINERS && new Set(entries.map(entry => entry.id)).size === entries.length,
    message: 'Use up to 50 uniquely named containers.',
  } },
}, { timestamps: true, collection: 'packing_container_catalogs', bufferCommands: false });
module.exports = mongoose.model('PackingContainerCatalog', catalogSchema);
