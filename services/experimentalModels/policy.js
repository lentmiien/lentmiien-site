const { z } = require('zod');

const CAPABILITY = 'experimental.models.manage';
// Intentionally no per-user grants: this lab requires the authoritative admin role.
const BUNDLES = { admin: [CAPABILITY], family: [], user: [] };
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LIMITS = Object.freeze({ ttlMs: 86400000, sweepMs: 60000, fileBytes: 8388608,
  sessionBytes: 33554432, userBytes: 67108864, globalBytes: 268435456,
  sessionFiles: 8, userSessions: 2, globalSessions: 16, maxPixels: 8000000, maxEdge: 4096 });
class LabError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}
const fail = (code, status, message) => { throw new LabError(code, status, message); };
const assetSchema = z.object({ id: z.string().regex(ID), mime: z.literal('image/png'), bytes: z.number().int().positive().max(LIMITS.fileBytes),
  width: z.number().int().positive().max(LIMITS.maxEdge), height: z.number().int().positive().max(LIMITS.maxEdge) }).strict();
const sessionSchema = z.object({ version: z.literal(1), id: z.string().regex(ID), owner: z.string().regex(/^[a-f0-9]{24}$/),
  binding: z.string().regex(ID), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  deletePending: z.boolean(), assets: z.array(assetSchema).max(LIMITS.sessionFiles) }).strict();
module.exports = { CAPABILITY, BUNDLES, ID, LIMITS, LabError, fail, sessionSchema };
