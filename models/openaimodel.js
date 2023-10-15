const mongoose = require('mongoose');

const Openaimodel = new mongoose.Schema({
  model_name: { type: String, required: true },
  api_endpoint: { type: String, required: true },
  input_1k_token_cost: { type: Number, required: true },
  output_1k_token_cost: { type: Number, required: true },
  model_type: { type: String, required: true },
  max_tokens: { type: Number, required: true },
});
// model_name, api_endpoint, input_1k_token_cost, output_1k_token_cost, model_type, max_tokens

module.exports = mongoose.model('openaimodel', Openaimodel);
