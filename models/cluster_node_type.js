const mongoose = require('mongoose');

const specRangeSchema = new mongoose.Schema(
  {
    metric: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    min: {
      type: String,
      default: '',
      trim: true,
      maxlength: 140,
    },
    rec: {
      type: String,
      default: '',
      trim: true,
      maxlength: 140,
    },
    ideal: {
      type: String,
      default: '',
      trim: true,
      maxlength: 160,
    },
  },
  {
    _id: false,
  }
);

const clusterNodeTypeSchema = new mongoose.Schema(
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
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      trim: true,
      lowercase: true,
      maxlength: 40,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 12,
    },
    tabId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
      maxlength: 600,
    },
    workloads: {
      type: [String],
      default: [],
    },
    policy: {
      type: [String],
      default: [],
    },
    avoid: {
      type: [String],
      default: [],
    },
    software: {
      type: [String],
      default: [],
    },
    ranges: {
      type: [specRangeSchema],
      default: [],
    },
    hardwareRoles: {
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

clusterNodeTypeSchema.index({ tabId: 1, order: 1, code: 1 });

module.exports = mongoose.model('cluster_node_type', clusterNodeTypeSchema);
