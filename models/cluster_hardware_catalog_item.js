const mongoose = require('mongoose');

const clusterHardwareCatalogItemSchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      trim: true,
      maxlength: 120,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    vendor: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },
    category: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
      index: true,
    },
    roles: {
      type: [String],
      default: [],
    },
    summary: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    why: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    specs: {
      type: [String],
      default: [],
    },
    source: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2048,
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
      max: 9999,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

clusterHardwareCatalogItemSchema.index({ order: 1, vendor: 1, name: 1 });
clusterHardwareCatalogItemSchema.index({ category: 1, order: 1, name: 1 });

module.exports = mongoose.model('cluster_hardware_catalog_item', clusterHardwareCatalogItemSchema);
