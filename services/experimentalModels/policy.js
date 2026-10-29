const { z } = require('zod');

const CAPABILITY = 'experimental.models.manage';
// Intentionally no per-user grants: this lab requires the authoritative admin role.
const BUNDLES = { admin: [CAPABILITY], family: [], user: [] };
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LIMITS = Object.freeze({ ttlMs: 86400000, sweepMs: 60000, fileBytes: 8388608, referenceBytes: 6291456,
  sessionBytes: 33554432, userBytes: 67108864, globalBytes: 268435456,
  sessionFiles: 8, userSessions: 2, globalSessions: 16, maxPixels: 16000000, maxEdge: 16384, sessionJobs: 8, pendingJobs: 4 });
class LabError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}
const fail = (code, status, message) => { throw new LabError(code, status, message); };
const assetSchema = z.object({ id: z.string().regex(ID), mime: z.enum(['image/png', 'application/json', 'audio/wav']), bytes: z.number().int().positive().max(LIMITS.fileBytes),
  audio: z.object({ sampleRate: z.number().int().min(16000).max(48000), channels: z.union([z.literal(1), z.literal(2)]),
    bitsPerSample: z.literal(16), durationSeconds: z.number().min(1).max(30) }).strict().optional(),
  width: z.number().int().positive().max(LIMITS.maxEdge), height: z.number().int().positive().max(LIMITS.maxEdge) }).partial({ width: true, height: true }).strict();
const jobSchema = z.object({ id: z.string().regex(ID), model: z.enum(['wevisone-vl', 'ming-tts']),
  state: z.enum(['queued', 'waiting_gateway', 'succeeded', 'failed', 'cancelled', 'interrupted']),
  createdAt: z.number(), startedAt: z.number().optional(), endedAt: z.number().optional(), reservedBytes: z.number().int().nonnegative(), reservedMetadataBytes: z.number().int().min(0).max(2048).optional(),
  request: z.string().max(20000), fileId: z.string().regex(ID).optional(), resultId: z.string().regex(ID).optional(),
  error: z.string().max(500).optional(), code: z.string().max(80).optional(), status: z.number().int().optional(),
  headers: z.record(z.string(), z.string().max(100)).optional(),
  audio: z.object({ sampleRate: z.number(), channels: z.literal(1), bitsPerSample: z.literal(16), durationSeconds: z.number() }).optional()
}).strict();
const sessionSchema = z.object({ version: z.literal(1), id: z.string().regex(ID), owner: z.string().regex(/^[a-f0-9]{24}$/),
  binding: z.string().regex(ID), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  deletePending: z.boolean(), assets: z.array(assetSchema).max(LIMITS.sessionFiles), jobs: z.array(jobSchema).max(LIMITS.sessionJobs).default([]) }).strict();
module.exports = { CAPABILITY, BUNDLES, ID, LIMITS, LabError, fail, sessionSchema };
