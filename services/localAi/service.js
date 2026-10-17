const { randomUUID, randomBytes, createHash } = require('crypto');
const models = require('../../models/local_ai');
const User = require('../../models/useraccount');
const Role = require('../../models/role');
const Conversation = require('../../models/conversation5');
const Message = require('../../models/chat5');
const Template = require('../../models/chat5_template');
const ModelCard = require('../../models/ai_model_card');
const { hasCapabilities } = require('../../utils/authorization');
const { sliceMessagesFromConfiguredStart } = require('../../utils/chat5MessageSelection');
const { CAP, BUNDLES, problem, digest, parseSubmission, textRequest, affinity, safeReplacement, windowAt } = require('./policy');
const { Gateway, config } = require('./gateway');
const logger = require('../../utils/logger');
const admission = require('./admission');
const { Inputs } = require('./inputs');
const { prepareGenerationContext } = require('../../utils/chat5GenerationContext');
const { errorDiagnostic } = require('./diagnostics');
const CHAT_BUNDLES = { admin: ['chat.conversation.read', 'chat.conversation.write'], family: [], user: [] };
const tokenHash = secret => createHash('sha256').update(secret).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
function publicJob(job, control = null) {
  return { id: job._id, type: job.source?.conversationId ? 'chat5.response' : job.type, state: job.state,
    reason: job.reason || (job.state === 'queued' ? control?.reason : null) || null, next_attempt_at: job.state === 'queued' && control?.nextAttemptAt && +control.nextAttemptAt > +job.nextAttemptAt ? control.nextAttemptAt : job.nextAttemptAt, created_at: job.createdAt,
    conversation_id: job.source?.conversationId || null, run_id: job.runId,
    attempts: job.attempts.map(a => ({ id: a.id, run_id: a.runId, status: a.remote?.status || 'upload_pending',
      cleanup: a.remote?.cleanup, termination_proven: a.remote?.termination_proven })),
    published: job.published, acknowledged: job.acknowledged,
    can_cancel: !job.runId && job.attempts.length === 0 && ['queued', 'needs_review'].includes(job.state),
    can_retry: !job.runId && job.attempts.length < 5 && ['failed', 'needs_review'].includes(job.state) && safeReplacement(job.attempts.at(-1)?.remote),
    url: `/local-ai/queue/${job._id}`, result_url: `/local-ai/api/v1/jobs/${job._id}/result` };
}
class LocalAiService {
  constructor({ db = models, gateway = new Gateway() } = {}) { this.db = db; this.gateway = gateway; this.inputs = new Inputs(this); }
  async initialize() {
    if (!this.initializing) this.initializing = admission.initializeIndexes(this.db).catch(error => {
      this.initializing = null;
      logger.error('Local AI admission indexes unavailable; initialization will retry before acceptance', { category: 'local_ai', metadata: { code: 'initialization_failed', ...errorDiagnostic(error, 'initialize') } });
      throw error;
    });
    await this.initializing;
  }
  async reconcileCapacity() { await admission.reconcileCapacity(this.db); }
  async principal(ownerId, tokenId, capability = CAP.use) {
    if (!/^[a-f\d]{24}$/i.test(String(ownerId || ''))) throw problem('unauthorized', 401);
    const user = await User.findById(ownerId).select('_id name type_user').lean();
    if (!user || !await hasCapabilities(user, [capability], { roleModel: Role, roleCapabilityBundles: BUNDLES })) throw problem('forbidden', 403);
    if (tokenId) {
      const token = await this.db.Token.findOne({ _id: tokenId, ownerId, revokedAt: null, expiresAt: { $gt: new Date() }, capabilities: capability }).lean();
      if (!token) throw problem('unauthorized', 401);
    }
    return user;
  }
  async authenticate(secret) {
    if (typeof secret !== 'string' || !/^lai_[A-Za-z0-9_-]{43}$/.test(secret)) throw problem('unauthorized', 401);
    const token = await this.db.Token.findOne({ hash: tokenHash(secret), revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
    if (!token) throw problem('unauthorized', 401);
    const user = await this.principal(token.ownerId, token._id);
    return { ownerId: String(user._id), tokenId: token._id, user };
  }
  async issueToken(ownerId, label, days = 30, capabilities = [CAP.use]) {
    await this.principal(ownerId);
    if (!Number.isInteger(days) || days < 1 || days > 365 || typeof label !== 'string' || label.length > 80) throw problem('invalid_token_request');
    if (!Array.isArray(capabilities) || !capabilities.includes(CAP.use) || capabilities.some(c => ![CAP.use, CAP.importShared].includes(c))) throw problem('invalid_token_capabilities');
    for (const capability of capabilities) await this.principal(ownerId, null, capability);
    const secret = `lai_${randomBytes(32).toString('base64url')}`;
    const token = await this.db.Token.create({ _id: randomUUID(), hash: tokenHash(secret), ownerId, label,
      capabilities, expiresAt: new Date(Date.now() + days * 86400000) });
    return { id: token._id, secret, expiresAt: token.expiresAt };
  }
  async sourceAccess(job) {
    const user = await this.principal(job.ownerId, job.tokenId);
    if (job.source?.conversationId) {
      if (!await hasCapabilities(user, ['chat.conversation.read', 'chat.conversation.write'], { roleModel: Role, roleCapabilityBundles: CHAT_BUNDLES })) throw problem('source_access_revoked', 403);
      const conv = await Conversation.findOne({ _id: job.source.conversationId, members: user.name }).lean();
      if (!conv) throw problem('source_access_revoked', 403);
      if (await Template.exists({ conversationId: String(conv._id) })) throw problem('shared_template_batch_unsupported', 403);
      return { user, conv };
    }
    return { user };
  }
  async validateModel(request) {
    const catalog = await this.gateway.catalog();
    const model = catalog?.models?.find(m => m.id === request.model && m.provider === 'ollama');
    if (!model || typeof model.upstream_model !== 'string') throw problem('local_ollama_catalog_model_required');
    const limits = model.limits;
    if (!limits || !Number.isInteger(limits.max_output_tokens) || !Number.isInteger(limits.max_context_tokens)
      || !Number.isInteger(limits.max_prompt_chars)) throw problem('catalog_limits_unavailable', 503);
    if (request.max_tokens > limits.max_output_tokens || (request.context_tokens && request.context_tokens > limits.max_context_tokens)
      || request.messages.reduce((n, m) => n + Array.from(m.content).length, 0) > limits.max_prompt_chars) throw problem('catalog_limit_exceeded');
    return plain(model);
  }
  async validateImages(request, actor, catalog) {
    const references = request.messages.flatMap(m => m.images || []);
    if (!references.length) return false;
    const caps = await this.inputs.negotiate();
    if (!caps.operation_schema_versions?.includes(2) || !caps.features?.ollama_image_refs || !caps.schema2?.run_manifest_required
      || !caps.schema2.supported_types?.includes('llm.chat')) throw problem('gateway_vision_unavailable', 503);
    const policy = caps.schema2;
    if (![policy.max_images, policy.max_image_bytes, policy.max_input_bytes, policy.max_pixels, policy.max_edge].every(v => Number.isSafeInteger(v) && v > 0)) throw problem('gateway_media_limits_unavailable', 503);
    const limits = catalog.limits;
    if (catalog.provider !== 'ollama' || catalog.allow_images !== true) throw problem('model_not_vision');
    if (![limits.max_images, limits.max_image_bytes].every(v => Number.isSafeInteger(v) && v > 0)) throw problem('catalog_limits_unavailable', 503);
    if (references.length > Math.min(3, limits.max_images, policy.max_images)) throw problem('image_catalog_budget', 413);
    let total = 0, estimate = 0;
    for (const ref of references) {
      const record = await this.inputs.resolve(actor, ref);
      const image = record.descriptor;
      if (image.bytes > policy.max_input_bytes || image.width * image.height > policy.max_pixels || Math.max(image.width, image.height) > policy.max_edge) throw problem('gateway_image_limits_exceeded', 413);
      total += image.bytes;
      estimate += 3 * Math.ceil(record.descriptor.bytes / 3);
    }
    if (references.length > Math.min(3, limits.max_images, policy.max_images) || Math.max(total, estimate) > Math.min(6000000, limits.max_image_bytes, policy.max_image_bytes)) throw problem('image_catalog_budget', 413);
    // Gateway expands refs into bare base64 only in memory. Bound that complete
    // expansion conservatively as well as Site's much smaller persisted JSON.
    if (Buffer.byteLength(JSON.stringify(request)) + Math.ceil(estimate * 4 / 3) > 9 * 1024 * 1024) throw problem('image_wire_budget', 413);
    return true;
  }
  catalogPolicy(catalog) {
    return { id: catalog.id, provider: catalog.provider, upstream_model: catalog.upstream_model,
      allow_images: catalog.allow_images, limits: catalog.limits, keep_alive: catalog.keep_alive };
  }
  async validateFrozen(job) {
    await this.sourceAccess(job);
    if (job.type === 'llm.chat') {
      const current = await this.validateModel(job.request);
      if (job.schemaVersion === 2) {
        if (digest(this.catalogPolicy(current)) !== digest(this.catalogPolicy(job.source.catalog))) throw problem('frozen_model_policy_changed', 409);
        await this.validateImages(job.request, { ownerId: job.ownerId, tokenId: job.tokenId }, current);
      }
      if (current.provider !== job.source.catalog?.provider || current.upstream_model !== job.source.catalog?.upstream_model) throw problem('frozen_model_mapping_changed', 409);
    }
  }
  async freeze(input, actor) {
    if (input.type !== 'chat5.response') {
      const catalog = input.type === 'llm.chat' ? await this.validateModel(input.request) : undefined;
      const media = catalog && await this.validateImages(input.request, actor, catalog);
      return { ...(media ? { schemaVersion: 2 } : {}), type: input.type, request: input.request, source: { catalog } };
    }
    const { conv } = await this.sourceAccess({ ownerId: actor.ownerId, tokenId: actor.tokenId, source: { conversationId: input.conversation_id } });
    const settings = input.settings || plain(conv.metadata);
    if ((settings.tools || []).length) throw problem('batch_tools_unsupported');
    if (settings.reasoning !== 'none' || settings.mode !== 'standard' || settings.verbosity !== 'medium' || settings.outputFormat !== 'text') throw problem('batch_requires_reasoning_none_standard_mode_medium_verbosity_text_format');
    const card = await ModelCard.findOne({ api_model: settings.model, provider: 'Local', model_type: 'chat' }).lean();
    if (!card) throw problem('local_model_required');
    const ids = sliceMessagesFromConfiguredStart(conv.messages, conv);
    if (ids.length > 10000) throw problem('history_too_large_use_start_message');
    const docs = await Message.find({ _id: { $in: ids } }).lean();
    const byId = new Map(docs.map(d => [String(d._id), d]));
    const selected = ids.map(id => byId.get(String(id)));
    if (selected.some(m => !m)) throw problem('source_history_missing');
    const { messages, selectedIds } = await prepareGenerationContext({ conversation: conv, settings, selected, prompt: input.prompt,
      resolveImage: async message => {
        // Authority is the immutable source association, never a mutable message field.
        const record = await this.db.Input.findOne({ ownerId: actor.ownerId, state: 'ready',
          'source.kind': 'chat5-upload', 'source.conversationId': String(conv._id), 'source.messageId': String(message._id),
          'source.author': message.user_id, 'source.filename': message.content.image }).lean();
        if (!record) throw problem('batch_image_source_requires_reupload');
        return { artifact_id: record._id, sha256: record.descriptor.sha256 };
      } });
    const catalog = await this.gateway.catalog();
    const model = catalog?.models?.find(m => m.id === settings.model && m.provider === 'ollama');
    if (!model) throw problem('local_ollama_catalog_model_required');
    const request = { model: settings.model, messages, max_tokens: Math.min(8192, card.max_out_tokens, model.limits?.max_output_tokens || 0), think: false };
    if (!textRequest.safeParse(request).success) throw problem('batch_context_out_of_bounds');
    await this.validateModel(request);
    const media = await this.validateImages(request, actor, model);
    return { ...(media ? { schemaVersion: 2 } : {}), type: 'llm.chat', request, source: { conversationId: String(conv._id), settings, messageIds: selectedIds, prompt: input.prompt, catalog: plain(model) } };
  }
  async submit(actor, key, raw) {
    await this.initialize();
    await this.principal(actor.ownerId, actor.tokenId);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw problem('idempotency_key_required', 400);
    const input = parseSubmission(raw);
    const hash = digest(input);
    const existing = await this.db.Job.findOne({ ownerId: actor.ownerId, key }).lean();
    if (existing) {
      if (existing.digest !== hash) throw problem('idempotency_conflict', 409);
      return existing;
    }
    if (!config().enabled || !this.gateway.configured()) throw problem('batch_submission_disabled', 503);
    const frozen = await this.freeze(input, actor);
    if (Buffer.byteLength(JSON.stringify(frozen)) > 512 * 1024) throw problem('frozen_context_too_large', 413);
    const id = randomUUID();
    const projection = frozen.source.conversationId ? { promptId: digest(`${id}:prompt`).slice(0, 24), responseId: digest(`${id}:response`).slice(0, 24) } : undefined;
    const replay = async () => {
      const job = await this.db.Job.findOne({ ownerId: actor.ownerId, key }).lean();
      if (job && job.digest !== hash) throw problem('idempotency_conflict', 409);
      return job;
    };
    const job = await admission.admit(this.db, actor.ownerId, async slots => {
      const created = await this.db.Job.create({ _id: id, ownerId: actor.ownerId, tokenId: actor.tokenId, key, digest: hash,
        ...frozen, projection, ...slots, affinity: frozen.schemaVersion === 2 ? `vision:${digest([this.catalogPolicy(frozen.source.catalog), Object.fromEntries(Object.entries(frozen.request).filter(([k]) => k !== 'messages'))])}` : frozen.source.catalog ? `llm:${frozen.source.catalog.upstream_model}` : affinity(frozen.type, frozen.request),
        nextAttemptAt: windowAt().inside ? new Date() : windowAt().next });
      return created.toObject();
    }, replay);
    // The acceptance document is authoritative; projection failure cannot reject it.
    await this.project(job).catch(() => logger.warning('Local AI Chat5 projection pending repair', { category: 'local_ai', metadata: { jobId: job._id } }));
    return job;
  }
  async project(job) {
    if (!job.source?.conversationId) return;
    const { user } = await this.sourceAccess(job);
    const { promptId, responseId } = job.projection;
    const ids = [];
    if (job.source.prompt) {
      await Message.updateOne({ _id: promptId }, { $setOnInsert: { user_id: user.name, category: 'local-ai-batch', tags: [], contentType: 'text', content: { text: job.source.prompt }, embeddingRequested: false, localBatchJobId: job._id } }, { upsert: true, writeConcern: { w: 'majority', j: true } });
      ids.push(promptId);
    }
    const complete = job.result?.text && job.state === 'succeeded';
    const text = complete ? job.result.text : `Local AI batch ${job.state}. Independent frozen snapshot. [View job](/local-ai/queue/${job._id})`;
    try {
      await Message.updateOne({ _id: responseId, $or: [{ localBatchVersion: { $lte: job.version } }, { localBatchVersion: { $exists: false } }] },
        { $set: { user_id: 'bot', category: 'local-ai-batch', tags: [], contentType: 'text', content: { text }, hideFromBot: !complete, embeddingRequested: false, localBatchJobId: job._id, localBatchVersion: job.version } }, { upsert: true, writeConcern: { w: 'majority', j: true } });
    } catch (error) {
      // A newer publication won the deterministic ID. Never overwrite it with an old queued projection.
      if (error.code !== 11000) throw error;
    }
    ids.push(responseId);
    const updated = await Conversation.updateOne({ _id: job.source.conversationId, members: user.name }, { $addToSet: { messages: { $each: ids } } }, { writeConcern: { w: 'majority', j: true } });
    if (!updated.matchedCount) throw problem('source_access_revoked', 403);
    // No emission to legacy rooms: members see this through authorized page/history reloads.
  }
  async get(actor, id) {
    await this.principal(actor.ownerId, actor.tokenId);
    const job = await this.db.Job.findOne({ _id: id, ownerId: actor.ownerId }).lean();
    if (!job) throw problem('not_found', 404);
    await this.sourceAccess({ ...job, tokenId: actor.tokenId });
    return job;
  }
  async cancel(actor, id) {
    await this.initialize();
    const job = await this.get(actor, id);
    if (job.state === 'cancelled') return admission.releaseAfterAcceptance(this.db, job);
    if (job.attempts.length) throw problem('already_claimed_stop_entire_run_via_admin', 409);
    const updated = await this.db.Job.findOneAndUpdate({ _id: id, ownerId: actor.ownerId, state: { $in: ['queued', 'needs_review'] }, 'attempts.0': { $exists: false }, runId: null, version: job.version }, { $set: { state: 'cancelled', reason: 'cancelled_before_export' }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!updated) throw problem('already_claimed_stop_entire_run_via_admin', 409);
    await this.project(updated).catch(() => logger.warning('Local AI cancellation projection pending repair', { category: 'local_ai', metadata: { jobId: id } }));
    return admission.releaseAfterAcceptance(this.db, updated);
  }
  async retry(actor, id) {
    await this.initialize();
    // Repair first, so the version read below includes any recovered release.
    await this.reconcileCapacity();
    const job = await this.get(actor, id);
    const latest = job.attempts.at(-1);
    if (job.runId || job.attempts.length >= 5 || !['failed', 'needs_review'].includes(job.state) || !safeReplacement(latest?.remote)
      || !await admission.detachedFromRun(this.db, job)) throw problem('replacement_not_safe', 409);
    const write = async slots => {
      const updated = await this.db.Job.findOneAndUpdate({ _id: id, ownerId: actor.ownerId, version: job.version, runId: null }, {
        $set: { ...slots, state: 'queued', reason: 'explicit_retry', nextAttemptAt: windowAt().inside ? new Date() : windowAt().next },
        $unset: { admissionReleasedAt: 1 }, $inc: { version: 1 },
      }, { returnDocument: 'after' });
      if (!updated) throw problem('job_changed', 409);
      return updated;
    };
    if (typeof job.slot === 'number') return write({});
    // Both slots and dispatchability change in the SAME journaled document write.
    return admission.admit(this.db, actor.ownerId, write, async () => {
      const current = await this.db.Job.findById(id).select('version').lean();
      if (current?.version !== job.version) throw problem('job_changed', 409);
      return null;
    });
  }
}
module.exports = { LocalAiService, publicJob, tokenHash, CHAT_BUNDLES };
