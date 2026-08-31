const mongoose = require('mongoose');

const { Schema } = mongoose;

const DatabaseAvailabilityEventSchema = new Schema({
  occurredAt: { type: Date, required: true },
  type: { type: String, required: true, trim: true, maxlength: 80 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed, default: null },
}, { _id: false });

const DatabaseAvailabilityIncidentSchema = new Schema({
  _id: { type: String, required: true },
  startedAt: { type: Date, required: true, index: true },
  recoveredAt: { type: Date, default: null, index: true },
  startupFailure: { type: Boolean, default: false },
  connectionAttempts: { type: Number, default: 0, min: 0 },
  processStarts: { type: Number, default: 1, min: 1 },
  lastFailure: {
    occurredAt: { type: Date, default: null },
    name: { type: String, default: '', maxlength: 120 },
    code: { type: String, default: '', maxlength: 120 },
    message: { type: String, default: '', maxlength: 500 },
  },
  notification: {
    attemptedAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0, min: 0 },
    sentAt: { type: Date, default: null },
    receipt: { type: String, default: '', maxlength: 120 },
    cancellationAttemptCount: { type: Number, default: 0, min: 0 },
    cancelledAt: { type: Date, default: null },
    recoveryAttemptCount: { type: Number, default: 0, min: 0 },
    recoverySentAt: { type: Date, default: null },
    error: { type: String, default: '', maxlength: 500 },
    cancellationError: { type: String, default: '', maxlength: 500 },
    recoveryError: { type: String, default: '', maxlength: 500 },
  },
  events: {
    type: [DatabaseAvailabilityEventSchema],
    default: [],
  },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, {
  collection: 'database_availability_incidents',
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model(
  'database_availability_incident',
  DatabaseAvailabilityIncidentSchema
);
