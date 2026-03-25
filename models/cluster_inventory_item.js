const mongoose = require('mongoose');

const inventorySpecSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    value: {
      type: String,
      required: true,
      trim: true,
      maxlength: 280,
    },
  },
  {
    _id: false,
  }
);

const clusterInventoryItemSchema = new mongoose.Schema(
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
    shortName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 60,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    nodeTypeKey: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
      maxlength: 40,
      index: true,
    },
    roles: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'planned', 'cloud', 'maintenance', 'retired'],
      default: 'offline',
      index: true,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    hostname: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    location: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    homeLanAddress: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    fabricAddress: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    specs: {
      type: [inventorySpecSchema],
      default: [],
    },
    notes: {
      type: [String],
      default: [],
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

clusterInventoryItemSchema.index({ order: 1, name: 1 });
clusterInventoryItemSchema.index({ nodeTypeKey: 1, status: 1, order: 1 });

module.exports = mongoose.model('cluster_inventory_item', clusterInventoryItemSchema);
