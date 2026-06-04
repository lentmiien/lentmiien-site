const mongoose = require('mongoose');

const { Schema } = mongoose;

const DummyApiRequestLogSchema = new Schema({
  receivedAt: { type: Date, default: Date.now, index: true },
  method: { type: String, required: true },
  requestPath: { type: String, required: true, index: true },
  raw: { type: Schema.Types.Mixed, default: {} },
}, {
  minimize: false,
  timestamps: false,
});

DummyApiRequestLogSchema.index({ receivedAt: -1 });

module.exports = mongoose.model('dummy_api_request_log', DummyApiRequestLogSchema);
