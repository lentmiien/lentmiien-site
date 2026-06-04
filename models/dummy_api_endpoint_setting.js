const mongoose = require('mongoose');

const DummyApiEndpointSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'ok' },
  enabled: { type: Boolean, default: false },
  updatedBy: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('dummy_api_endpoint_setting', DummyApiEndpointSettingSchema);
