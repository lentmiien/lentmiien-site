const mongoose = require('mongoose');
const { Schema } = mongoose;
const mixed = Schema.Types.Mixed;
const expiry = { type: Date, default: () => new Date(Date.now() + 90 * 86400000) };
function model(name, fields, indexes = []) {
  const schema = new Schema(fields, { timestamps: true, minimize: false, strict: 'throw', autoCreate: false, autoIndex: false, bufferCommands: false });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.models[name] || mongoose.model(name, schema, name);
}
const Settings = model('taric_settings', { _id: String, revision: Number, nextRunSequence: { type: Number, default: 0 }, enabled: Boolean,
  owner: String, currentBenchmark: String, catalog: mixed, testCatalog: mixed, runtime: mixed, maxTokens: Number });
const Credential = model('taric_credentials', { _id: String, owner: String, generation: Number,
  digest: { type: String, select: false }, active: Boolean, scopes: [String], expiresAt: Date, issuedBy: String,
  revokedAt: Date, rateWindow: Number, rateCount: Number });
const Benchmark = model('taric_benchmarks', { _id: String, version: Number, state: String,
  releaseEligible: Boolean, contaminated: Boolean, sourceLineage: [String], manifest: mixed,
  cases: [mixed], policy: mixed, review: mixed, publishedAt: Date, publishedBy: String }, [
  [{ version: 1 }, { unique: true, name: 'benchmark_version' }],
  [{ createdAt: -1, _id: -1 }, { name: 'benchmark_chronology' }],
]);
const Run = model('taric_runs', { _id: String, benchmark: String, adapter: String, identity: String, sequence: Number,
  fingerprint: String, configuration: mixed, policy: mixed, state: String, active: Boolean, slot: Number,
  requestedCount: Number, actualCount: Number, exact: Number, invalid: Number, results: [mixed],
  score: Number, passed: Boolean, cancelRequested: Boolean, deadline: Date, actor: String, fence: String,
  error: String, finishedAt: Date, dispatchContract: String, sessionId: String, sessionHardExpiresAt: Date, warmSessionRequired: Boolean, attemptedCount: Number,
  successfulGenerations: Number, sessionCount: Number, sessionEndReasons: mixed, lastYieldAt: Date,
  errorCount: Number, catalogRejected: Number, codeExact: Number, currentAttempt: mixed, recoveryRequired: Boolean }, [
  [{ slot: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'bounded_run_slots' }],
  [{ benchmark: 1, adapter: 1, sequence: -1 }, { name: 'authoritative_runs' }],
]);
const Request = model('taric_requests', { _id: String, owner: String, principal: String, generation: Number,
  key: String, digest: String, input: mixed, admission: mixed, state: String, active: Boolean, slot: Number,
  fence: String, sessionId: String, correlationId: String, evidence: mixed, result: mixed, diagnostics: mixed, errorStatus: mixed, errorStage: String, inferenceDispatched: Boolean, retryable: Boolean, error: String, finishedAt: Date, expiresAt: expiry }, [
  [{ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'request_retention_90d' }],
  [{ principal: 1, key: 1 }, { unique: true, name: 'request_idempotency' }],
  [{ slot: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'bounded_request_slots' }],
  [{ owner: 1, createdAt: -1, _id: -1 }, { name: 'request_inspection' }],
]);
const Feedback = model('taric_outcomes', { _id: String, owner: String, principal: String, request: String,
  key: String, digest: String, selected_code: String, decision: String, catalog_status: String,
  verification: { type: String, default: 'unverified', enum: ['unverified'] },
  training_approved: { type: Boolean, default: false, enum: [false] }, recommendationHash: String, expiresAt: expiry }, [
  [{ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'feedback_retention_90d' }],
  [{ principal: 1, key: 1 }, { unique: true, name: 'feedback_idempotency' }],
  [{ request: 1 }, { unique: true, name: 'one_final_feedback' }],
]);
const Control = model('taric_controls', { _id: String, holder: String, until: Date, attempts: [mixed], blocked: Boolean, reason: String, epoch: { type: Number, default: 0 }, sessionId: String, capabilityProof: { digest: String, observedAt: String, protocol: String }, recoveryPhase: String });
const Attempt = model('taric_attempts', { _id: String, run: String, index: Number, fence: String,
  correlationId: String, sessionId: String, state: String, claimedAt: Date, startedAt: Date,
  finishedAt: Date, result: mixed, diagnostics: mixed, generationSucceeded: Boolean, error: String, errorStatus: mixed,
  inputHash: String, exact: Boolean, proposalExact: Boolean, lexicalSimilarity: Number }, [
  [{ run: 1, index: 1 }, { unique: true, name: 'one_attempt_per_case' }],
]);
module.exports = { Settings, Credential, Benchmark, Run, Request, Feedback, Control, Attempt };
