const mongoose = require('mongoose');

const BatchRequest = new mongoose.Schema({
  id: { type: String, required: true },
  input_file_id: { type: String, required: true },
  provider: { type: String, required: true },
  status: { type: String, required: true },
  output_file_id: { type: String, required: true },
  error_file_id: { type: String, required: true },
  created_at: { type: Date, required: true },
  completed_at: { type: Date, required: true },
  request_counts_total: { type: Number, required: true },
  request_counts_completed: { type: Number, required: true },
  request_counts_failed: { type: Number, required: true },
  processing_token: String,
  processing_expires_at: Date,
  finalization_state: { type: String, enum: ['retry_wait', 'needs_review', 'done'] },
  finalization_attempts: { type: Number, default: 0 },
  finalization_next_attempt_at: Date,
  finalization_failure: { reason: String, status: Number, at: Date },
  result_counts: { succeeded: Number, failed: Number },
});

module.exports = mongoose.model('batchrequest', BatchRequest);
