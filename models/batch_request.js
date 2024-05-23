const mongoose = require('mongoose');

const BatchPrompt = new mongoose.Schema({
  id: { type: String, required: true },
  input_file_id: { type: String, required: true },
  status: { type: String, required: true },
  output_file_id: { type: String, required: true },
  error_file_id: { type: String, required: true },
  created_at: { type: Date, required: true },
  completed_at: { type: Date, required: true },
  request_counts_total: { type: Number, required: true },
  request_counts_completed: { type: Number, required: true },
  request_counts_failed: { type: Number, required: true },
});

module.exports = mongoose.model('batchprompt', BatchPrompt);
