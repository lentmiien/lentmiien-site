const crypto = require('crypto');

const HumanToolRequest = require('../models/human_tool_request');
const PendingRequests = require('../models/pending_requests');
const Role = require('../models/role');
const Useraccount = require('../models/useraccount');
const logger = require('../utils/logger');
const { PUSHOVER_PRIORITIES, sendPushoverNotification } = require('../utils/pushover');
const {
  CHAT_TOOL_CAPABILITIES,
  CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/chatToolAuthorizationPolicy');
const {
  createHttpError,
  resolveAuthorizedToolPrincipal,
} = require('./toolExecutionPrincipalService');

const MAX_TEXT_CHARS = 20000;
const DEFAULT_WAIT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MAX_PENDING_PER_USER = 10;
const RECOVERY_WAKE_DELAY_MS = 60 * 1000;
const VALID_VARIANTS = new Set(['codex', 'general']);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function getRuntimeConfig(env = process.env) {
  return {
    waitTimeoutMs: positiveInteger(
      env.HUMAN_TOOL_RESPONSE_TIMEOUT_MS,
      DEFAULT_WAIT_TIMEOUT_MS,
      60 * 1000,
      2 * 24 * 60 * 60 * 1000
    ),
    pollIntervalMs: positiveInteger(
      env.HUMAN_TOOL_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      250,
      10000
    ),
    retentionDays: positiveInteger(
      env.HUMAN_TOOL_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      1,
      3650
    ),
    maxPendingPerUser: positiveInteger(
      env.HUMAN_TOOL_MAX_PENDING_PER_USER,
      DEFAULT_MAX_PENDING_PER_USER,
      1,
      100
    ),
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeText(value, label) {
  if (typeof value !== 'string') {
    throw createHttpError(400, `${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw createHttpError(400, `${label} is required.`);
  }
  if (normalized.includes('\0')) {
    throw createHttpError(400, `${label} contains an unsupported character.`);
  }
  if (normalized.length > MAX_TEXT_CHARS) {
    throw createHttpError(400, `${label} is too long. Maximum length is ${MAX_TEXT_CHARS} characters.`);
  }
  return normalized;
}

function normalizePromptArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw createHttpError(400, 'Tool arguments must be an object.');
  }
  if (Object.keys(args).some((key) => key !== 'prompt')) {
    throw createHttpError(400, 'This tool accepts only the prompt field.');
  }
  return normalizeText(args.prompt, 'Prompt');
}

function normalizeVariant(value) {
  const variant = String(value || '').trim().toLowerCase();
  if (!VALID_VARIANTS.has(variant)) {
    throw createHttpError(500, 'The human-request tool is not configured correctly.');
  }
  return variant;
}

function stringId(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function buildInvocationIdentity(context = {}, toolName = '') {
  const conversationId = stringId(context.conversationId, 160);
  const responseId = stringId(context.responseId, 240);
  const toolCallId = stringId(context.callId || context.toolCallId, 240);
  const stableCallId = responseId || toolCallId;
  const nonce = stableCallId || crypto.randomUUID();
  return {
    conversationId,
    responseId,
    toolCallId,
    originKey: sha256(['human-tool', toolName, conversationId, responseId, toolCallId, nonce].join('\n')),
  };
}

function requestUrl(requestId) {
  return `/admin/ask-lennart#request-${encodeURIComponent(requestId)}`;
}

function toToolResult(request) {
  const id = String(request?._id || '');
  if (request?.status === 'responded') {
    return {
      status: 'responded',
      request_id: id,
      response: request.response || '',
      responded_at: request.respondedAt || null,
      request_url: requestUrl(id),
    };
  }
  return {
    status: 'timed_out',
    request_id: id,
    response: '',
    message: 'Lennart did not respond before the human-request wait limit expired.',
    request_url: requestUrl(id),
  };
}

function queryResult(query) {
  let current = query;
  if (current && typeof current.lean === 'function') current = current.lean();
  if (current && typeof current.exec === 'function') return current.exec();
  return current;
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, milliseconds);
    handle.unref?.();
  });
}

function retentionDeadline(now, retentionDays) {
  return new Date(now.getTime() + (retentionDays * 24 * 60 * 60 * 1000));
}

class HumanToolRequestService {
  constructor({
    requestModel = HumanToolRequest,
    pendingModel = PendingRequests,
    roleModel = Role,
    userModel = Useraccount,
    appLogger = logger,
    notificationSender = sendPushoverNotification,
    sleep = sleepFor,
    now = () => new Date(),
    env = process.env,
  } = {}) {
    this.requestModel = requestModel;
    this.pendingModel = pendingModel;
    this.roleModel = roleModel;
    this.userModel = userModel;
    this.logger = appLogger;
    this.notificationSender = notificationSender;
    this.publicAppBaseUrl = env.PUBLIC_APP_BASE_URL || 'https://my.lentmiien.com';
    this.sleep = sleep;
    this.now = now;
    this.config = getRuntimeConfig(env);
  }

  async authorize(context, capability) {
    return resolveAuthorizedToolPrincipal(context, capability, {
      userModel: this.userModel,
      roleModel: this.roleModel,
      roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
      appLogger: this.logger,
    });
  }

  async findByOriginKey(originKey) {
    return queryResult(this.requestModel.findOne({ originKey }));
  }

  async createOrFindRequest({ prompt, variant, toolName, identity, principal }) {
    let existing = await this.findByOriginKey(identity.originKey);
    const requestHash = sha256([toolName, variant, prompt].join('\n'));
    if (existing) {
      if (String(existing.createdBy?.id || '') !== String(principal._id || '')) {
        throw createHttpError(409, 'The durable human request belongs to a different principal.');
      }
      if (existing.requestHash !== requestHash) {
        throw createHttpError(409, 'This tool call was already recorded with different arguments.');
      }
      return existing;
    }

    const pendingCount = await this.requestModel.countDocuments({
      status: 'pending',
      'createdBy.id': principal._id,
    }).exec();
    if (pendingCount >= this.config.maxPendingPerUser) {
      throw createHttpError(
        429,
        `At most ${this.config.maxPendingPerUser} human requests can be pending at once.`
      );
    }

    const createdAt = this.now();
    const deleteAfter = retentionDeadline(
      new Date(createdAt.getTime() + this.config.waitTimeoutMs),
      this.config.retentionDays
    );
    const update = {
      $setOnInsert: {
        originKey: identity.originKey,
        requestHash,
        toolName,
        variant,
        prompt,
        status: 'pending',
        conversationId: identity.conversationId,
        responseId: identity.responseId,
        toolCallId: identity.toolCallId,
        createdBy: { id: principal._id, name: principal.name },
        lastWaitHeartbeatAt: createdAt,
        deleteAfter,
      },
    };

    let inserted = false;
    try {
      const result = await queryResult(this.requestModel.findOneAndUpdate(
        { originKey: identity.originKey },
        update,
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
          runValidators: true,
          includeResultMetadata: true,
        }
      ));
      existing = result?.value;
      // Only the winning insert notifies, including when concurrent calls race.
      inserted = result?.lastErrorObject?.updatedExisting === false;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      existing = await this.findByOriginKey(identity.originKey);
    }
    if (!existing) {
      throw createHttpError(500, 'The human request could not be stored.');
    }
    if (String(existing.createdBy?.id || '') !== String(principal._id || '')) {
      throw createHttpError(409, 'The durable human request belongs to a different principal.');
    }
    if (existing.requestHash !== requestHash) {
      throw createHttpError(409, 'This tool call was already recorded with different arguments.');
    }
    if (inserted && existing.status === 'pending') {
      await this.notifyNewRequest(existing);
    }
    return existing;
  }

  async notifyNewRequest(request) {
    try {
      const baseUrl = new URL(this.publicAppBaseUrl);
      if (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
        throw new Error('Invalid public application URL');
      }
      const url = new URL(requestUrl(request._id), baseUrl.origin).href;
      const requestType = request.variant === 'codex' ? 'Codex workflow' : 'General';
      await this.notificationSender({
        title: 'New Ask Lennart request',
        message: `${requestType} request is pending your response. Open Ask Lennart to review and respond: ${url}`,
        priority: PUSHOVER_PRIORITIES.HIGH,
      });
    } catch (error) {
      try {
        await this.logger.warning('Saved a human tool request but could not send its Pushover notification', {
          category: 'human_tool_request',
          metadata: {
            requestId: String(request._id),
            errorName: error?.name || 'Error',
          },
        });
      } catch {
        // Even a logging failure must not interrupt the saved request's durable wait.
      }
    }
  }

  async markResponseAsHumanWait(responseId) {
    if (!responseId || !this.pendingModel || typeof this.pendingModel.updateOne !== 'function') return;
    await this.pendingModel.updateOne(
      { response_id: responseId, recoveryState: 'pending' },
      { $set: { recoveryState: 'tool_wait' } }
    );
  }

  async execute(args, context = {}, variantInput = 'general') {
    const variant = normalizeVariant(variantInput);
    const prompt = normalizePromptArguments(args);
    const principal = await this.authorize(context, CHAT_TOOL_CAPABILITIES.humanRequestCreate);
    const toolName = stringId(context.toolName, 64)
      || (variant === 'codex' ? 'ask_lennart_for_codex' : 'ask_lennart');
    const identity = buildInvocationIdentity(context, toolName);
    let request = await this.createOrFindRequest({
      prompt,
      variant,
      toolName,
      identity,
      principal,
    });

    if (request.status !== 'pending') {
      return toToolResult(request);
    }

    await this.markResponseAsHumanWait(request.responseId);
    const createdAt = request.createdAt instanceof Date
      ? request.createdAt
      : new Date(request.createdAt || this.now());
    const deadline = createdAt.getTime() + this.config.waitTimeoutMs;

    while (this.now().getTime() < deadline) {
      request = await queryResult(this.requestModel.findById(request._id));
      if (!request) {
        throw createHttpError(410, 'The human request is no longer available.');
      }
      if (request.status !== 'pending') {
        return toToolResult(request);
      }

      await this.requestModel.updateOne(
        { _id: request._id, status: 'pending' },
        { $set: { lastWaitHeartbeatAt: this.now() } }
      ).exec();
      await this.sleep(Math.min(this.config.pollIntervalMs, Math.max(1, deadline - this.now().getTime())));
    }

    const requestId = request._id;
    const timedOutAt = this.now();
    request = await queryResult(this.requestModel.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      { $set: {
        status: 'timed_out',
        timedOutAt,
        deleteAfter: retentionDeadline(timedOutAt, this.config.retentionDays),
      } },
      { new: true }
    ));
    if (!request) {
      request = await queryResult(this.requestModel.findById(requestId));
    }
    return toToolResult(request || { _id: '', status: 'timed_out' });
  }

  async listForAdmin(context = {}, { recentLimit = 50 } = {}) {
    await this.authorize(context, CHAT_TOOL_CAPABILITIES.humanRequestManage);
    const limit = Math.max(1, Math.min(Number.parseInt(recentLimit, 10) || 50, 100));
    const [pending, recent] = await Promise.all([
      queryResult(this.requestModel.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(100)),
      queryResult(this.requestModel.find({ status: { $ne: 'pending' } }).sort({ updatedAt: -1 }).limit(limit)),
    ]);
    return { pending, recent };
  }

  async respond(requestIdInput, responseInput, context = {}) {
    const principal = await this.authorize(context, CHAT_TOOL_CAPABILITIES.humanRequestManage);
    const requestId = stringId(requestIdInput, 80);
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw createHttpError(404, 'Pending request not found.');
    }
    const response = normalizeText(responseInput, 'Response');
    const respondedAt = this.now();
    const request = await queryResult(this.requestModel.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      {
        $set: {
          response,
          status: 'responded',
          respondedBy: { id: principal._id, name: principal.name },
          respondedAt,
          deleteAfter: retentionDeadline(respondedAt, this.config.retentionDays),
        },
      },
      { new: true, runValidators: true }
    ));
    if (!request) {
      throw createHttpError(404, 'Pending request not found.');
    }

    if (request.responseId && this.pendingModel && typeof this.pendingModel.updateOne === 'function') {
      try {
        await this.pendingModel.updateOne(
          { response_id: request.responseId, recoveryState: 'tool_wait' },
          {
            $set: {
              recoveryState: 'pending',
              processingStartedAt: null,
              nextCheckAt: new Date(respondedAt.getTime() + RECOVERY_WAKE_DELAY_MS),
            },
          }
        );
      } catch (error) {
        await this.logger.warning('Saved a human tool response but could not wake the waiting chat immediately', {
          category: 'human_tool_request',
          metadata: {
            requestId,
            errorName: error?.name || 'Error',
          },
        });
      }
    }
    return request;
  }

  async recoverInterruptedResponses() {
    const timedOutAt = this.now();
    const expiration = await this.requestModel.updateMany(
      {
        status: 'pending',
        createdAt: { $lte: new Date(timedOutAt.getTime() - this.config.waitTimeoutMs) },
      },
      {
        $set: {
          status: 'timed_out',
          timedOutAt,
          deleteAfter: retentionDeadline(timedOutAt, this.config.retentionDays),
        },
      }
    );
    const requestQuery = this.requestModel.find({
      status: { $in: ['responded', 'timed_out'] },
      responseId: { $nin: ['', null] },
    }).sort({ updatedAt: -1 }).select({ responseId: 1 }).limit(500);
    const requests = await queryResult(requestQuery);
    const responseIds = Array.from(new Set(
      (requests || []).map((request) => request.responseId).filter(Boolean)
    ));
    if (!responseIds.length) {
      return {
        expiredCount: expiration?.modifiedCount || 0,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }
    const pendingResponseIds = await queryResult(this.requestModel.distinct('responseId', {
      status: 'pending',
      responseId: { $in: responseIds },
    }));
    const stillWaiting = new Set(pendingResponseIds || []);
    const recoverableResponseIds = responseIds.filter((responseId) => !stillWaiting.has(responseId));
    if (!recoverableResponseIds.length) {
      return {
        expiredCount: expiration?.modifiedCount || 0,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }
    const result = await this.pendingModel.updateMany(
      {
        response_id: { $in: recoverableResponseIds },
        recoveryState: 'tool_wait',
      },
      {
        $set: {
          recoveryState: 'pending',
          processingStartedAt: null,
          nextCheckAt: this.now(),
        },
      }
    );
    return {
      expiredCount: expiration?.modifiedCount || 0,
      matchedCount: result?.matchedCount || 0,
      modifiedCount: result?.modifiedCount || 0,
    };
  }
}

HumanToolRequestService.MAX_TEXT_CHARS = MAX_TEXT_CHARS;
HumanToolRequestService.buildInvocationIdentity = buildInvocationIdentity;
HumanToolRequestService.getRuntimeConfig = getRuntimeConfig;
HumanToolRequestService.normalizePromptArguments = normalizePromptArguments;
HumanToolRequestService.toToolResult = toToolResult;

module.exports = HumanToolRequestService;
