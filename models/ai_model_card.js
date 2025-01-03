const mongoose = require('mongoose');

const AiModelCardModel = new mongoose.Schema({
  model_name: { type: String, required: true },
  provider: { type: String, required: true },
  api_model: { type: String, required: true },
  input_1m_token_cost: { type: Number, required: true },
  output_1m_token_cost: { type: Number, required: true },
  model_type: { type: String, required: true, enum: ['chat', 'embedding', 'image', 'audio', 'realtime'] },
  in_modalities: { type: [String], required: true, enum: ['text', 'image', 'audio', 'video', 'vector'] },
  out_modalities: { type: [String], required: true, enum: ['text', 'image', 'audio', 'video', 'vector'] },
  max_tokens: { type: Number, required: true },
  max_out_tokens: { type: Number, required: true },
  added_date: { type: Date, required: true },
  batch_use: { type: Boolean, required: true },
  context_type: { type: String, required: true, enum: ['none', 'system', 'developer'] },
});

module.exports = mongoose.model('AiModelCardModel', AiModelCardModel);
