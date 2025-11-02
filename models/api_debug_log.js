const mongoose = require('mongoose');

const { Schema } = mongoose;

const ApiDebugLogSchema = new Schema({
  requestUrl: { type: String, required: true },
  requestHeaders: { type: Schema.Types.Mixed, default: null },
  requestBody: { type: Schema.Types.Mixed, default: null },
  responseHeaders: { type: Schema.Types.Mixed, default: null },
  responseBody: { type: Schema.Types.Mixed, default: null },
  jsFileName: { type: String, required: true },
  functionName: { type: String, required: true },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false },
});

module.exports = mongoose.model('api_debug_log', ApiDebugLogSchema);
