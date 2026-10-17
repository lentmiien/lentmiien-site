const { randomUUID } = require('crypto');
const { z } = require('zod');
const { CAP, ID, digest, problem } = require('./policy');
const { config } = require('./gateway');
const storage = require('./inputStorage');
const { ownerIdentity, previousCoordinatorTerminated } = require('./coordinator');
const RESERVATION = 2 * storage.MAX_BYTES + 65536;
const OVERHEAD = 4096;
const HASH = /^[a-f0-9]{64}$/;
const component = z.string().min(1).max(200).refine(v => !/[\\/:\[\]%\x00-\x1f\x7f]/.test(v) && v !== '.' && !v.includes('..') && !/[. ]$/.test(v) && !/(__gateway_batch__|gateway_batch_)/i.test(v));
const importSchema = z.object({ source: z.object({ filename: component, subfolder: z.string().max(400).refine(v => v === '' || v.split('/').every(p => component.safeParse(p).success)) }).strict(), expected_sha256: z.string().regex(HASH).optional() }).strict();
function limits() {
  const bounded = (value, fallback) => { const n = Number(value); if (value !== undefined && (!Number.isSafeInteger(n) || n < RESERVATION || n > 32 * 1024 ** 3)) throw problem('input_quota_config', 503); return value === undefined ? fallback : n; };
  return { total: bounded(process.env.LOCAL_AI_INPUT_QUOTA_BYTES, 2 * 1024 ** 3), owner: bounded(process.env.LOCAL_AI_INPUT_OWNER_QUOTA_BYTES, 512 * 1024 ** 2) };
}
function descriptor(record) {
  return { artifact_id: record._id, state: record.state, ...(record.descriptor || {}) };
}
const receiptSchema = z.object({
  artifact_id: z.string().regex(/^in_[a-f0-9]{32}$/), schema_version: z.literal(2), request_digest: z.string().regex(HASH),
  sha256: z.string().regex(HASH), bytes: z.number().int().min(1).max(storage.MAX_BYTES),
  media_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192), frames: z.literal(1), normalization: z.literal('identity-v1'), url: z.string().max(512),
}).strict();
function checkReceipt(receipt) {
  if (!receiptSchema.safeParse(receipt).success) throw problem('input_receipt_mismatch', 503);
}
function verifyReceipt(record, receipt) {
  checkReceipt(receipt);
  const expected = record.descriptor;
  const submitted = record.source?.kind === 'shared-library' ? { kind: 'comfy_shared_library', ...record.source.import } : { kind: 'upload', manifest: { schema_version: 2 } };
  if (!receipt || receipt.artifact_id !== record._id || receipt.schema_version !== 2 || !HASH.test(receipt.request_digest)
    || receipt.request_digest !== digest(submitted) || !expected || ['sha256', 'bytes', 'media_type', 'width', 'height', 'frames', 'normalization'].some(k => expected[k] !== receipt[k])) throw problem('input_receipt_mismatch', 503);
}
class Inputs {
  constructor(service) { this.service = service; this.db = service.db; this.gateway = service.gateway; }
  async authorize(actor, capability = CAP.use) { return this.service.principal(actor.ownerId, actor.tokenId, capability); }
  async negotiate(shared = false) {
    if (!config().media) throw problem('batch_media_disabled', 503);
    const caps = await this.gateway.capabilities();
    if (!caps.enabled || caps.protocol !== 'durable-local-ai' || caps.version !== 1 || !caps.features?.immutable_inputs
      || (shared && !caps.features.shared_library_import)) throw problem('gateway_inputs_unavailable', 503);
    return caps;
  }
  async prepare(actor, key, expectedSha256, source = { kind: 'upload' }) {
    await this.authorize(actor); await this.service.initialize();
    if (typeof key !== 'string' || !ID.test(key) || !HASH.test(expectedSha256 || '')) throw problem('input_key_and_sha256_required', 400);
    const requestDigest = digest({ expectedSha256, source });
    let record = await this.db.Input.findOne({ ownerId: actor.ownerId, key }).lean();
    if (record && record.requestDigest !== requestDigest) throw problem('idempotency_conflict', 409);
    if (!record) {
      if (!config().media) throw problem('batch_media_disabled', 503);
      const free = (set, max) => { for (let i = 0; i < max; i++) if (!set.has(i)) return i; return -1; };
      for (let tries = 0; tries < 12 && !record; tries++) {
        const slots = await this.db.Input.find({}).select('slot ownerSlot ownerId').limit(1025).lean();
        const slot = free(new Set(slots.map(r => r.slot)), 1024);
        const ownerSlot = free(new Set(slots.filter(r => r.ownerId === actor.ownerId).map(r => r.ownerSlot)), 128);
        if (slot < 0 || ownerSlot < 0) throw problem('retained_input_record_quota', 507);
        try {
          record = (await this.db.Input.create({ _id: `in_${randomUUID().replaceAll('-', '')}`, ownerId: actor.ownerId, tokenId: actor.tokenId,
            key, requestDigest, expectedSha256, source, slot, ownerSlot })).toObject();
        } catch (e) {
          // Read after any uncertain DB reply; only the original preparation may win.
          record = await this.db.Input.findOne({ ownerId: actor.ownerId, key }).lean();
          if (record && record.requestDigest !== requestDigest) throw problem('idempotency_conflict', 409);
          if (!record && e.code !== 11000) throw e;
        }
      }
      if (!record) throw problem('input_preparation_busy', 503);
    }
    await this.reserve(record);
    return record;
  }
  async reserve(record) {
    const bounds = limits();
    try { await this.db.InputQuota.updateOne({ _id: 'inputs' }, { $setOnInsert: { allocations: [] } }, { upsert: true }); }
    catch (e) { if (e.code !== 11000) throw e; }
    const existing = await this.db.InputQuota.exists({ _id: 'inputs', 'allocations.id': record._id });
    if (existing) return;
    const ownerBytes = { $sum: { $map: { input: { $filter: { input: '$allocations', as: 'a', cond: { $eq: ['$$a.ownerId', record.ownerId] } } }, as: 'a', in: '$$a.bytes' } } };
    const update = await this.db.InputQuota.updateOne({ _id: 'inputs', 'allocations.id': { $ne: record._id },
      $expr: { $and: [{ $lte: [{ $add: [{ $sum: '$allocations.bytes' }, RESERVATION] }, bounds.total] }, { $lte: [{ $add: [ownerBytes, RESERVATION] }, bounds.owner] }] } },
    { $push: { allocations: { id: record._id, ownerId: record.ownerId, bytes: RESERVATION } } });
    if (!update.matchedCount && !await this.db.InputQuota.exists({ _id: 'inputs', 'allocations.id': record._id })) throw problem('retained_input_bytes_quota', 507);
  }
  async settle(record) {
    await this.db.InputQuota.updateOne({ _id: 'inputs', 'allocations.id': record._id }, { $set: { 'allocations.$.bytes': record.descriptor.bytes + OVERHEAD } });
  }
  async lookup(actor, id, key, { verifyBytes = true } = {}) {
    await this.authorize(actor);
    if (id && !storage.validId(id)) throw problem('not_found', 404);
    if (key && (typeof key !== 'string' || !ID.test(key))) throw problem('invalid_key', 400);
    const record = await this.db.Input.findOne({ ownerId: actor.ownerId, ...(key ? { key } : { _id: id }) }).lean();
    if (!record) throw problem('not_found', 404);
    if (record.state === 'ready' && verifyBytes) await storage.read(record._id, record.descriptor);
    return record;
  }
  async withWriter(record, fn) {
    const holder = randomUUID();
    const previous = await this.db.Input.findOne({ _id: record._id, ownerId: record.ownerId }).lean();
    if (!previous) throw problem('not_found', 404);
    if (previous.state === 'ready') return fn(previous);
    if (previous.writer?.holder && !await previousCoordinatorTerminated(previous.writer)) throw problem('input_preparation_busy', 503);
    const writer = { holder, ...await ownerIdentity() };
    let locked;
    try {
      locked = await this.db.Input.findOneAndUpdate({ _id: record._id, ownerId: record.ownerId, writer: previous.writer || null }, { $set: { writer } }, { returnDocument: 'after' }).lean();
    } catch (error) {
      // A lost lock-write acknowledgement is not permission to create another
      // writer. Recover only this exact durable holder, otherwise remain fenced.
      locked = await this.db.Input.findOne({ _id: record._id, ownerId: record.ownerId, 'writer.holder': holder }).lean();
      if (!locked) throw error;
    }
    if (!locked) throw problem('input_preparation_busy', 503);
    try { return await fn(locked); }
    finally { await this.db.Input.updateOne({ _id: record._id, 'writer.holder': holder }, { $unset: { writer: 1 } }); }
  }
  async accept(actor, record, bytes) {
    await this.authorize(actor);
    if (record.ownerId !== actor.ownerId) throw problem('not_found', 404);
    if (!(record.source?.kind === 'shared-library' && !record.source.import.expected_sha256) && storage.hash(bytes) !== record.expectedSha256) throw problem('input_digest_mismatch', 409);
    return this.withWriter(record, async current => {
      if (current.state === 'ready') { await storage.read(current._id, current.descriptor); await this.settle(current); return current; }
      if (!config().media) throw problem('batch_media_disabled', 503);
      await this.reserve(current); await storage.assertSpace();
      const info = await storage.validateRaster(bytes);
      await storage.publish(current._id, bytes, info);
      // After a lost DB acknowledgement, exact retry verifies the published file.
      const ready = await this.db.Input.findOneAndUpdate({ _id: current._id, 'writer.holder': current.writer.holder },
        { $set: { state: 'ready', descriptor: info } }, { returnDocument: 'after' }).lean();
      if (!ready) throw problem('input_preparation_fenced', 503);
      await this.settle(ready);
      return ready;
    });
  }
  async capture(actor, key, bytes, source) {
    const release = require('./inputWork').acquire();
    try {
      const record = await this.prepare(actor, key, storage.hash(bytes), source);
      return await this.accept(actor, record, bytes);
    } finally { release(); }
  }
  async importShared(actor, key, raw) {
    const release = require('./inputWork').acquire();
    try { return await this.importSnapshot(actor, key, raw); } finally { release(); }
  }
  async importSnapshot(actor, key, raw) {
    await this.authorize(actor, CAP.importShared);
    const parsed = importSchema.safeParse(raw);
    if (!parsed.success) throw problem('invalid_library_source');
    const body = { schema_version: 2, ...parsed.data };
    const record = await this.prepare(actor, key, body.expected_sha256 || '0'.repeat(64), { kind: 'shared-library', import: body });
    if (record.state === 'ready') { await storage.read(record._id, record.descriptor); return record; }
    if (!config().media) throw problem('batch_media_disabled', 503);
    let receipt;
    try { receipt = await this.gateway.input(record._id); } catch (e) { if (e.status !== 404) throw e; }
    if (!receipt) { await this.negotiate(true); receipt = await this.gateway.importInput(record._id, body); }
    checkReceipt(receipt);
    // Ignore URL in receipt: only the fixed-origin, constructed content route is used.
    if (receipt.artifact_id !== record._id || receipt.schema_version !== 2 || (body.expected_sha256 && receipt.sha256 !== record.expectedSha256)
      || !Number.isInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > storage.MAX_BYTES) throw problem('input_receipt_mismatch', 503);
    const response = await this.gateway.inputContent(record._id);
    const bytes = Buffer.from(response.data);
    const info = await storage.validateRaster(bytes);
    verifyReceipt({ ...record, descriptor: info }, receipt);
    await this.authorize(actor, CAP.importShared);
    const ready = await this.accept(actor, record, bytes);
    await this.db.Input.updateOne({ _id: record._id }, { $set: { gatewayReceipt: receipt } });
    return ready;
  }
  async resolve(actor, reference, options) {
    const record = await this.lookup(actor, reference.artifact_id, null, options);
    if (record.source?.conversationId) await this.service.sourceAccess({ ...actor, source: { conversationId: record.source.conversationId } });
    if (record.state !== 'ready' || record.descriptor.sha256 !== reference.sha256) throw problem('input_not_ready_or_revision_mismatch', 409);
    return record;
  }
  async stage(job) {
    const actor = { ownerId: job.ownerId, tokenId: job.tokenId };
    const references = job.type === 'comfy.workflow' ? Object.values(job.request.bindings) : job.request.messages.flatMap(m => m.images || []);
    for (const ref of new Map(references.map(r => [r.artifact_id, r])).values()) {
      const record = await this.resolve(actor, ref);
      const bytes = await storage.read(record._id, record.descriptor);
      let receipt;
      try { receipt = await this.gateway.input(record._id); } catch (e) { if (e.status !== 404) throw e; }
      if (!receipt) receipt = await this.gateway.putInput(record._id, bytes);
      verifyReceipt(record, receipt);
      await this.db.Input.updateOne({ _id: record._id, ownerId: job.ownerId }, { $set: { gatewayReceipt: receipt } });
    }
  }
}
module.exports = { Inputs, descriptor, verifyReceipt, importSchema, limits, RESERVATION, OVERHEAD };
