const mongoose = require('mongoose');

const Openaicalllog = new mongoose.Schema({
  timestamp: { type: Date, required: true },
  user_id: { type: String, required: true },
  api_endpoint: { type: String, required: true },
  input_token_count: { type: Number, required: true },
  output_token_count: { type: Number, required: true },
  input_text_or_embedding: { type: String },
  output_text_or_embedding: { type: String },
  total_request_cost: { type: Number, required: true },
});

module.exports = mongoose.model('openaicalllog', Openaicalllog);
