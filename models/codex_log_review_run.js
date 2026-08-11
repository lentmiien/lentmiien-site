const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const ActorSchema = new Schema({
  id: { type: String, default: null },
  name: { type: String, default: '' },
}, { _id: false });

const WorkflowPhaseSchema = new Schema({
  workspaceId: { type: String, default: '', trim: true, index: true },
  sessionId: { type: String, default: '', trim: true, index: true },
  turnId: { type: String, default: '', trim: true, index: true },
  codexThreadId: { type: String, default: '', trim: true },
  mode: {
    type: String,
    enum: ['', 'question', 'action'],
    default: '',
  },
  permissionMode: {
    type: String,
    enum: ['', 'yolo'],
    default: '',
  },
  requestProfileId: { type: String, default: '', trim: true, maxlength: 80 },
  status: {
    type: String,
    enum: [
      'not_started',
      'pending',
      'queued',
      'running',
      'succeeded',
      'failed',
      'timed_out',
      'cancelled',
      'blocked',
    ],
    default: 'not_started',
  },
  prompt: { type: String, default: '' },
  response: { type: String, default: '' },
  requestedBy: { type: ActorSchema, default: () => ({}) },
  requestedAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  lastAttemptAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: null, index: true },
  attemptCount: { type: Number, default: 0, min: 0 },
  failureCount: { type: Number, default: 0, min: 0 },
  consecutiveFailures: { type: Number, default: 0, min: 0 },
  lastError: { type: String, default: '', trim: true, maxlength: 4000 },
  readyNotificationSentAt: { type: Date, default: null },
  errorNotificationSentAt: { type: Date, default: null },
}, { _id: false });

const CodexLogReviewRunSchema = new Schema({
  _id: { type: String, default: () => randomUUID() },
  status: {
    type: String,
    enum: [
      'analysis_pending',
      'analyzing',
      'awaiting_fix',
      'fix_pending',
      'fixing',
      'awaiting_commit',
      'commit_pending',
      'committing',
      'completed',
    ],
    default: 'analysis_pending',
    index: true,
  },
  scheduledFor: { type: Date, required: true, unique: true, index: true },
  logWindowStart: { type: Date, required: true },
  logWindowEnd: { type: Date, required: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null, index: true },
  userNotes: { type: String, default: '', maxlength: 5000 },
  analysis: { type: WorkflowPhaseSchema, default: () => ({}) },
  fix: { type: WorkflowPhaseSchema, default: () => ({}) },
  commit: { type: WorkflowPhaseSchema, default: () => ({}) },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'codex_log_review_runs',
});

CodexLogReviewRunSchema.index({ status: 1, scheduledFor: 1 });
CodexLogReviewRunSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('codex_log_review_run', CodexLogReviewRunSchema);
