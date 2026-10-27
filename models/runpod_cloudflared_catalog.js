const mongoose = require('mongoose');
const {
  CLOUDFLARED_VERSION_PATTERN,
  CLOUDFLARED_SHA256_PATTERN,
  MAX_CLOUDFLARED_RELEASES,
} = require('../services/runpodCloudflaredCatalog');

const ReleaseSchema = new mongoose.Schema({
  version: { type: String, required: true, maxlength: 12, match: CLOUDFLARED_VERSION_PATTERN },
  sha256: { type: String, required: true, match: CLOUDFLARED_SHA256_PATTERN },
}, { _id: false });

const RunpodCloudflaredCatalogSchema = new mongoose.Schema({
  _id: { type: String, enum: ['cloudflared'], default: 'cloudflared' },
  releases: {
    type: [ReleaseSchema],
    required: true,
    validate: {
      validator: (releases) => releases.length > 0
        && releases.length <= MAX_CLOUDFLARED_RELEASES
        && new Set(releases.map(({ version }) => version)).size === releases.length,
      message: 'The tunnel catalog must contain between 1 and 50 unique releases.',
    },
  },
  defaultVersion: { type: String, required: true, maxlength: 12, match: CLOUDFLARED_VERSION_PATTERN },
}, { timestamps: true, versionKey: false });

RunpodCloudflaredCatalogSchema.pre('validate', function validateDefault() {
  if (!this.releases.some(({ version }) => version === this.defaultVersion)) {
    this.invalidate('defaultVersion', 'The default must be a saved release.');
  }
});

module.exports = mongoose.model('runpod_cloudflared_catalog', RunpodCloudflaredCatalogSchema);
