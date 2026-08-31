const {
  uploadBatchFile,
  startBatchJob,
  retrieveBatchStatus,
  downloadBatchOutput,
  deleteBatchFile,
  convertResponseBody,
  supportsReasoningModel,
  supportsReasoningMode,
} = require('../utils/OpenAI_API');
const {
  getConfiguredStartMessageId,
  getMessageId,
  sliceMessagesFromConfiguredStart,
} = require('../utils/chat5MessageSelection');
const { AIModelCards, Conversation5Model } = require('../database');
const logger = require('../utils/logger');
const {
  APP_SETTING_KEYS,
  appSettingsService: defaultAppSettingsService,
} = require('./appSettingsService');

const redirect_models = {
  o1: 'o1-2024-12-17',
  'o1-preview': 'o1-preview-2024-09-12',
  'gpt-4o': 'gpt-4o-2024-11-20',
  'o1-mini': 'o1-mini-2024-09-12',
  'o3-mini': 'o3-mini-2025-01-31',
  'gpt-4o-mini': 'gpt-4o-mini-2024-07-18',
  'gpt-4.1': 'gpt-4.1-2025-04-14',
  'gpt-4.1-mini': 'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano': 'gpt-4.1-nano-2025-04-14',
};

const SUMMARY_PROMPT = 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to read the entire conversation.';
const DEFAULT_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const TERMINAL_BATCH_STATUSES = new Set([
  'failed',
  'cancelled',
  'canceled',
  'expired',
]);

const modelCache = new Map();
let loadModelsPromise = null;
let modelCacheLoadedAt = 0;
let modelCacheVersion = 0;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getModelCacheTtlMs() {
  return positiveInteger(process.env.BATCH_MODEL_CACHE_TTL_MS, DEFAULT_MODEL_CACHE_TTL_MS);
}

async function ensureModelsLoaded() {
  const cacheIsFresh = modelCacheLoadedAt > 0
    && Date.now() - modelCacheLoadedAt < getModelCacheTtlMs();
  if (cacheIsFresh) return [...modelCache.values()];

  if (!loadModelsPromise) {
    const loadVersion = modelCacheVersion;
    const promise = AIModelCards.find({ model_type: 'chat', batch_use: true, provider: 'OpenAI' })
      .then((cards) => {
        if (loadVersion !== modelCacheVersion) return [];
        modelCache.clear();
        cards.forEach((card) => {
          modelCache.set(card.api_model, card);
        });
        modelCacheLoadedAt = Date.now();
        return cards;
      })
      .catch((error) => {
        logger.error('Failed to load batch-capable model cards', { error });
        return [...modelCache.values()];
      })
      .finally(() => {
        if (loadModelsPromise === promise) loadModelsPromise = null;
      });
    loadModelsPromise = promise;
  }
  return loadModelsPromise;
}

function invalidateBatchModelCache() {
  modelCacheVersion += 1;
  modelCache.clear();
  modelCacheLoadedAt = 0;
}

function normalizeModelName(model) {
  if (!model) return null;
  if (modelCache.has(model)) return model;
  if (redirect_models[model] && modelCache.has(redirect_models[model])) {
    return redirect_models[model];
  }
  return null;
}

async function resolveConfiguredSummaryModel(
  appSettingsService = defaultAppSettingsService,
  fallbackModel = null,
) {
  await ensureModelsLoaded();
  let configuredModel = null;
  let settingError = null;
  try {
    configuredModel = await appSettingsService.getValue(APP_SETTING_KEYS.CHAT5_BATCH_SUMMARY_MODEL);
  } catch (error) {
    settingError = error;
  }

  const normalizedConfiguredModel = normalizeModelName(configuredModel);
  if (normalizedConfiguredModel) {
    return {
      model: normalizedConfiguredModel,
      configuredModel,
      usedFallback: false,
      settingError: null,
    };
  }

  const normalizedFallbackModel = normalizeModelName(fallbackModel);
  const firstEnabledModel = modelCache.keys().next().value || null;
  const resolvedFallback = normalizedFallbackModel || firstEnabledModel;
  logger.warn('Batch summary model setting is unavailable; using an enabled fallback', {
    category: 'batch',
    metadata: {
      settingKey: APP_SETTING_KEYS.CHAT5_BATCH_SUMMARY_MODEL,
      configuredModel,
      fallbackModel: resolvedFallback,
      reason: settingError?.message || (configuredModel ? 'unsupported_model' : 'missing_setting'),
    },
  });
  return {
    model: resolvedFallback,
    configuredModel,
    usedFallback: true,
    settingError,
  };
}

async function resolveConfiguredDefaultModel(appSettingsService = defaultAppSettingsService) {
  await ensureModelsLoaded();
  let configuredModel = null;
  let settingError = null;
  try {
    configuredModel = await appSettingsService.getValue(APP_SETTING_KEYS.CHAT5_BATCH_DEFAULT_MODEL);
  } catch (error) {
    settingError = error;
  }

  const normalizedConfiguredModel = normalizeModelName(configuredModel);
  if (normalizedConfiguredModel) {
    return {
      model: normalizedConfiguredModel,
      configuredModel,
      settingError: null,
    };
  }

  logger.warning('Batch default model setting is missing or not eligible for OpenAI batch processing', {
    category: 'batch',
    metadata: {
      settingKey: APP_SETTING_KEYS.CHAT5_BATCH_DEFAULT_MODEL,
      configuredModel,
      reason: settingError?.message || (configuredModel ? 'ineligible_model' : 'missing_setting'),
    },
  });
  return {
    model: null,
    configuredModel,
    settingError,
  };
}

async function validateBatchSummaryModelSetting() {
  return resolveConfiguredSummaryModel(defaultAppSettingsService);
}

async function validateBatchDefaultModelSetting() {
  return resolveConfiguredDefaultModel(defaultAppSettingsService);
}

function buildTextSettings(conversation, modelName) {
  const metadata = conversation?.metadata || {};
  if (!metadata.outputFormat) return null;
  const textConfig = { format: { type: metadata.outputFormat } };
  if (typeof modelName === 'string' && modelName.startsWith('gpt-5') && metadata.verbosity) {
    textConfig.verbosity = metadata.verbosity;
  }
  return textConfig;
}

function extractSummaryText(body) {
  if (!body || !Array.isArray(body.output)) return null;
  const parts = [];

  for (const item of body.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.type === 'output_text' && typeof content.text === 'string') {
          parts.push(content.text);
        }
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n').trim();
}

class BatchService {
  constructor(
    BatchPromptDatabase,
    BatchRequestDatabase,
    messageService,
    conversationService,
    appSettingsService = defaultAppSettingsService,
  ) {
    this.BatchPromptDatabase = BatchPromptDatabase;
    this.BatchRequestDatabase = BatchRequestDatabase;
    this.messageService = messageService;
    this.conversationService = conversationService;
    this.appSettingsService = appSettingsService;
  }

  async cleanupPromptPlaceholder(prompt, {
    conversation = undefined,
    reason = 'terminal',
  } = {}) {
    const placeholderId = prompt?.message_id?.toString?.() || prompt?.message_id || null;
    if (!placeholderId) {
      return {
        ok: true,
        status: 'skipped',
        placeholderId: null,
        referenceRemoved: false,
        deletedCount: 0,
        error: null,
      };
    }

    let referenceRemoved = false;
    try {
      const targetConversation = conversation === undefined
        ? await Conversation5Model.findById(prompt.conversation_id)
        : conversation;
      if (targetConversation && Array.isArray(targetConversation.messages)) {
        const remainingMessages = targetConversation.messages.filter(
          messageId => messageId?.toString() !== placeholderId,
        );
        if (remainingMessages.length !== targetConversation.messages.length) {
          targetConversation.messages = remainingMessages;
          targetConversation.updatedAt = new Date();
          await targetConversation.save();
          referenceRemoved = true;
        }
      }

      if (!this.messageService || typeof this.messageService.deleteMessages !== 'function') {
        throw new Error('Chat message deletion service is unavailable.');
      }
      const deletedCount = await this.messageService.deleteMessages([placeholderId], {
        conversationId: prompt.conversation_id || null,
      });
      return {
        ok: true,
        status: 'cleaned',
        placeholderId,
        referenceRemoved,
        deletedCount,
        error: null,
      };
    } catch (error) {
      const errorMessage = error?.message || String(error);
      logger.error('Failed to clean up terminal batch response placeholder', {
        category: 'batch',
        metadata: {
          customId: prompt?.custom_id || null,
          conversationId: prompt?.conversation_id || null,
          placeholderId,
          reason,
          error: errorMessage,
        },
      });
      return {
        ok: false,
        status: 'deferred',
        placeholderId,
        referenceRemoved,
        deletedCount: 0,
        error: errorMessage,
      };
    }
  }

  async discardTerminalPrompt(prompt, options = {}) {
    if (!prompt) {
      return {
        ok: true,
        status: 'missing',
        promptDeleted: false,
      };
    }
    const placeholderCleanup = await this.cleanupPromptPlaceholder(prompt, options);
    if (!placeholderCleanup.ok) {
      return {
        ...placeholderCleanup,
        promptDeleted: false,
      };
    }
    await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
    return {
      ...placeholderCleanup,
      promptDeleted: true,
    };
  }

  async cleanupTerminalRequestPrompts(requestId, { reason = 'terminal_request' } = {}) {
    const prompts = await this.BatchPromptDatabase.find({ request_id: requestId });
    const results = [];
    for (const prompt of prompts) {
      results.push(await this.discardTerminalPrompt(prompt, { reason }));
    }
    return {
      ok: results.every(result => result.ok),
      results,
    };
  }

  async retryTerminalPromptCleanup({ limit = 25 } = {}) {
    const parsedLimit = Number.parseInt(limit, 10);
    const resolvedLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25;
    const retainedPrompts = await this.BatchPromptDatabase.find({
      request_id: { $ne: 'new' },
    });
    const candidates = Array.isArray(retainedPrompts) ? retainedPrompts : [];
    const requestIds = [...new Set(candidates.map(prompt => prompt?.request_id).filter(Boolean))];
    if (requestIds.length === 0) {
      return { attempted: 0, cleaned: 0, deferred: 0 };
    }

    const terminalRequests = await this.BatchRequestDatabase.find({
      id: { $in: requestIds },
      status: { $in: [...TERMINAL_BATCH_STATUSES] },
    });
    const terminalStatusById = new Map(
      (terminalRequests || []).map(request => [request.id, String(request.status).toLowerCase()]),
    );
    let attempted = 0;
    let cleaned = 0;
    let deferred = 0;
    for (const prompt of candidates) {
      if (attempted >= resolvedLimit) break;
      const status = terminalStatusById.get(prompt.request_id);
      if (!status) continue;
      attempted += 1;
      const result = await this.discardTerminalPrompt(prompt, {
        reason: `request_${status}_retry`,
      });
      if (result.ok) {
        cleaned += 1;
      } else {
        deferred += 1;
      }
    }
    return { attempted, cleaned, deferred };
  }

  async getAll() {
    const weekAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
    const prompts = await this.BatchPromptDatabase.find();
    const requests = (await this.BatchRequestDatabase.find({ created_at: { $gt: weekAgo } })).reverse();
    return { prompts, requests };
  }

  async getPromptConversationIds() {
    const conversationIds = [];
    const prompts = await this.BatchPromptDatabase.find({ task_type: 'response' });
    prompts.forEach((prompt) => {
      if (prompt.request_id === 'new' && conversationIds.indexOf(prompt.conversation_id) === -1) {
        conversationIds.push(prompt.conversation_id);
      }
    });
    return conversationIds;
  }

  async addPromptToBatch(...args) {
    let options = null;
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      options = args[0];
    } else {
      logger.warn('Deprecated addPromptToBatch signature detected; request ignored', { argsCount: args.length });
      if (args.length >= 3) {
        return args[2];
      }
      return null;
    }

    const {
      userId,
      conversationId,
      messageId = null,
      model = null,
      title = '(no title)',
      taskType = 'response',
    } = options;

    await ensureModelsLoaded();
    let normalizedModel = normalizeModelName(model);
    if (!normalizedModel) {
      const configuredDefault = await resolveConfiguredDefaultModel(this.appSettingsService);
      if (!configuredDefault.model) {
        logger.error('Unable to queue batch prompt because neither the selected model nor the configured default is eligible', {
          category: 'batch',
          metadata: {
            selectedModel: model,
            configuredModel: configuredDefault.configuredModel,
            settingKey: APP_SETTING_KEYS.CHAT5_BATCH_DEFAULT_MODEL,
            conversationId,
            taskType,
          },
        });
        return null;
      }

      normalizedModel = configuredDefault.model;
      logger.warning('Selected model is not eligible for OpenAI batch processing; using the configured default', {
        category: 'batch',
        metadata: {
          selectedModel: model,
          fallbackModel: normalizedModel,
          settingKey: APP_SETTING_KEYS.CHAT5_BATCH_DEFAULT_MODEL,
          conversationId,
          taskType,
        },
      });
    }

    if (taskType === 'response' && !messageId) {
      logger.warn('Cannot queue batch response without placeholder message', { conversationId, userId });
      return null;
    }

    if (taskType === 'summary') {
      const existing = await this.BatchPromptDatabase.find({
        conversation_id: conversationId,
        task_type: 'summary',
        request_id: 'new',
      });
      if (existing.length > 0) {
        return conversationId;
      }
    }

    const customId = `prompt-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
    const entry = new this.BatchPromptDatabase({
      title,
      custom_id: customId,
      conversation_id: conversationId,
      request_id: 'new',
      user_id: userId,
      message_id: messageId,
      model: normalizedModel,
      task_type: taskType,
    });
    await entry.save();
    return conversationId;
  }

  async triggerBatchRequest() {
    await ensureModelsLoaded();
    const newPrompts = await this.BatchPromptDatabase.find({ request_id: 'new' });
    if (!newPrompts.length) {
      return { ids: [], requests: [] };
    }

    const requestsByModel = new Map();
    const processedIds = [];
    const savedRequests = [];

    for (const prompt of newPrompts) {
      const normalizedModel = normalizeModelName(prompt.model);
      if (!normalizedModel) {
        logger.warn('Dropping batch prompt with unknown model', { model: prompt.model, custom_id: prompt.custom_id });
        await this.discardTerminalPrompt(prompt, { reason: 'unknown_model' });
        continue;
      }

      const snapshot = await this._loadConversationSnapshot(prompt);
      if (!snapshot) {
        await this.discardTerminalPrompt(prompt, { reason: 'conversation_snapshot_unavailable' });
        continue;
      }

      const modelCard = modelCache.get(normalizedModel);
      const input = await this._buildInputFromSnapshot({
        prompt,
        conversation: snapshot.conversation,
        messages: snapshot.messages,
        modelCard,
      });

      if (!input || input.length === 0) {
        logger.warn('Skipping batch prompt with empty input', { custom_id: prompt.custom_id });
        await this.discardTerminalPrompt(prompt, {
          conversation: snapshot.conversation,
          reason: 'empty_input',
        });
        continue;
      }

      const body = {
        model: normalizedModel,
        input,
      };

      // Tools are intentionally omitted because the OpenAI batches API does not support tool invocations.

      const textSettings = buildTextSettings(snapshot.conversation, normalizedModel);
      if (textSettings) {
        body.text = textSettings;
      }

      if (snapshot.conversation.metadata?.reasoning && supportsReasoningModel(normalizedModel)) {
        body.reasoning = { effort: snapshot.conversation.metadata.reasoning, summary: 'detailed' };
        if (supportsReasoningMode(normalizedModel)) {
          body.reasoning.mode = snapshot.conversation.metadata.mode === 'pro' ? 'pro' : 'standard';
        }
      }

      const requestEntry = {
        custom_id: prompt.custom_id,
        method: 'POST',
        url: '/v1/responses',
        body,
      };

      if (!requestsByModel.has(normalizedModel)) {
        requestsByModel.set(normalizedModel, []);
      }

      requestsByModel.get(normalizedModel).push({ prompt, request: requestEntry });
    }

    for (const [modelName, entries] of requestsByModel.entries()) {
      if (!entries.length) continue;

      const payload = entries.map((entry) => JSON.stringify(entry.request)).join('\n');
      if (!payload.trim()) continue;

      const file = await uploadBatchFile(payload);
      if (!file || !file.id) {
        logger.error('Failed to upload batch payload to OpenAI', { model: modelName });
        continue;
      }

      const batch = await startBatchJob({ fileId: file.id, endpoint: '/v1/responses' });
      if (!batch || !batch.id) {
        logger.error('Failed to start OpenAI batch job', { model: modelName });
        await deleteBatchFile(file.id);
        continue;
      }

      const requestDoc = new this.BatchRequestDatabase({
        id: batch.id,
        input_file_id: file.id,
        provider: 'OpenAI',
        status: batch.status,
        output_file_id: batch.output_file_id ?? 'null',
        error_file_id: batch.error_file_id ?? 'null',
        created_at: batch.created_at ? new Date(batch.created_at * 1000) : new Date(),
        completed_at: batch.expires_at ? new Date(batch.expires_at * 1000) : new Date(),
        request_counts_total: batch.request_counts?.total ?? entries.length,
        request_counts_completed: batch.request_counts?.completed ?? 0,
        request_counts_failed: batch.request_counts?.failed ?? 0,
      });

      await requestDoc.save();
      savedRequests.push(requestDoc);

      const customIds = entries.map((entry) => entry.prompt.custom_id);
      processedIds.push(...customIds);
      await this.BatchPromptDatabase.updateMany({ custom_id: { $in: customIds } }, { request_id: batch.id });
    }

    return { ids: processedIds, requests: savedRequests };
  }

  async checkBatchStatus(batchId) {
    const batch = await this.BatchRequestDatabase.findOne({ id: batchId });
    if (!batch) return null;

    const latestStatus = await retrieveBatchStatus(batchId);
    if (!latestStatus) return batch;

    batch.status = latestStatus.status ?? batch.status;
    batch.output_file_id = latestStatus.output_file_id ?? batch.output_file_id ?? 'null';
    batch.error_file_id = latestStatus.error_file_id ?? batch.error_file_id ?? 'null';

    if (latestStatus.completed_at) {
      batch.completed_at = new Date(latestStatus.completed_at * 1000);
    } else if (latestStatus.expires_at) {
      batch.completed_at = new Date(latestStatus.expires_at * 1000);
    }

    if (latestStatus.request_counts) {
      batch.request_counts_total = latestStatus.request_counts.total ?? batch.request_counts_total;
      batch.request_counts_completed = latestStatus.request_counts.completed ?? batch.request_counts_completed;
      batch.request_counts_failed = latestStatus.request_counts.failed ?? batch.request_counts_failed;
    }

    await batch.save();
    if (TERMINAL_BATCH_STATUSES.has(String(batch.status || '').toLowerCase())) {
      await this.cleanupTerminalRequestPrompts(batch.id, {
        reason: `request_${String(batch.status).toLowerCase()}`,
      });
    }
    return batch;
  }

  async processBatchResponses() {
    const completedRequests = await this.BatchRequestDatabase.find({ status: 'completed' });
    if (!completedRequests.length) {
      return { requests: [], prompts: [], conversations: [] };
    }

    const processedRequestIds = [];
    const processedPromptIds = [];
    const conversationUpdates = [];

    for (const request of completedRequests) {
      if (!request.output_file_id || request.output_file_id === 'null') continue;

      const outputData = await downloadBatchOutput(request.output_file_id);
      if (!Array.isArray(outputData)) continue;
      let placeholderCleanupFailed = false;
      const outputCustomIds = new Set(
        outputData.map(record => record?.custom_id).filter(Boolean),
      );

      for (const record of outputData) {
        const prompt = await this.BatchPromptDatabase.findOne({ custom_id: record.custom_id });
        if (!prompt) continue;

        const responseBody = record?.response?.body;
        if (!responseBody) {
          logger.warn('Batch record missing response body', { custom_id: record.custom_id });
          const discardResult = await this.discardTerminalPrompt(prompt, {
            reason: 'missing_response_body',
          });
          if (discardResult.ok) {
            processedPromptIds.push(prompt.custom_id);
          } else {
            placeholderCleanupFailed = true;
          }
          continue;
        }

        if (prompt.task_type === 'summary') {
          const summary = extractSummaryText(responseBody);
          if (summary) {
            await this.conversationService.updateConversationDetails(prompt.conversation_id, { summary });
          }
          const discardResult = await this.discardTerminalPrompt(prompt, {
            reason: 'summary_processed',
          });
          if (discardResult.ok) {
            processedPromptIds.push(prompt.custom_id);
          } else {
            placeholderCleanupFailed = true;
          }
          continue;
        }

        const conversation = await Conversation5Model.findById(prompt.conversation_id);
        if (!conversation) {
          const discardResult = await this.discardTerminalPrompt(prompt, {
            conversation: null,
            reason: 'conversation_missing',
          });
          if (discardResult.ok) {
            processedPromptIds.push(prompt.custom_id);
          } else {
            placeholderCleanupFailed = true;
          }
          continue;
        }

        if (prompt.message_id) {
          const placeholderCleanup = await this.cleanupPromptPlaceholder(prompt, {
            conversation,
            reason: 'response_processed',
          });
          if (!placeholderCleanup.ok) {
            placeholderCleanupFailed = true;
            continue;
          }
        }

        const convertedOutputs = await convertResponseBody(responseBody);
        const newMessages = await this.messageService.processConvertedOutputs(conversation, convertedOutputs);

        const savedMessages = [];
        for (const msg of newMessages) {
          if (msg && !msg.error && msg._id) {
            conversation.messages.push(msg._id.toString());
            savedMessages.push(msg);
          }
        }

        conversation.updatedAt = new Date();
        await conversation.save();

        await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
        processedPromptIds.push(prompt.custom_id);

        if (savedMessages.length > 0) {
          conversationUpdates.push({
            conversationId: conversation._id.toString(),
            messages: savedMessages.map((msg) => (typeof msg.toObject === 'function' ? msg.toObject() : msg)),
            placeholderId: prompt.message_id,
            members: Array.isArray(conversation.members) ? [...conversation.members] : [],
            title: conversation.title,
          });
        }

        const summaryModel = await resolveConfiguredSummaryModel(this.appSettingsService, prompt.model);
        if (summaryModel.model) {
          await this.addPromptToBatch({
            userId: prompt.user_id,
            conversationId: prompt.conversation_id,
            model: summaryModel.model,
            title: prompt.title || conversation.title || '(no title)',
            taskType: 'summary',
          });
        } else {
          logger.warn('Unable to queue automatic batch summary because no batch model is enabled', {
            category: 'batch',
            metadata: {
              conversationId: prompt.conversation_id,
              settingKey: APP_SETTING_KEYS.CHAT5_BATCH_SUMMARY_MODEL,
            },
          });
        }
      }

      const promptsMissingOutput = await this.BatchPromptDatabase.find({ request_id: request.id });
      if (Array.isArray(promptsMissingOutput)) {
        for (const prompt of promptsMissingOutput) {
          if (outputCustomIds.has(prompt.custom_id)) continue;
          logger.warn('Completed batch request omitted a queued prompt response', {
            request_id: request.id,
            custom_id: prompt.custom_id,
          });
          const discardResult = await this.discardTerminalPrompt(prompt, {
            reason: 'missing_response_record',
          });
          if (discardResult.ok) {
            processedPromptIds.push(prompt.custom_id);
          } else {
            placeholderCleanupFailed = true;
          }
        }
      }

      if (placeholderCleanupFailed) {
        logger.warning('Deferred completed batch request finalization because placeholder cleanup failed', {
          category: 'batch',
          metadata: { requestId: request.id },
        });
        continue;
      }

      request.status = 'DONE';
      await request.save();
      await deleteBatchFile(request.input_file_id);
      if (request.output_file_id && request.output_file_id !== 'null') {
        await deleteBatchFile(request.output_file_id);
      }
      processedRequestIds.push(request.id);
    }

    return {
      requests: processedRequestIds,
      prompts: processedPromptIds,
      conversations: conversationUpdates,
    };
  }

  async deletePromptById(id) {
    const prompt = await this.BatchPromptDatabase.findOne({ custom_id: id });
    if (!prompt) return;
    return this.discardTerminalPrompt(prompt, { reason: 'manual_delete' });
  }

  async _loadConversationSnapshot(prompt) {
    try {
      const conversation = await Conversation5Model.findById(prompt.conversation_id);
      if (!conversation) {
        logger.warn('Conversation not found for batch prompt', {
          conversation_id: prompt.conversation_id,
          custom_id: prompt.custom_id,
        });
        return null;
      }
      const messages = await this.messageService.loadMessagesInNewFormat(conversation.messages, true);
      return { conversation, messages };
    } catch (error) {
      logger.error('Failed to load conversation for batch prompt', {
        error,
        conversation_id: prompt.conversation_id,
        custom_id: prompt.custom_id,
      });
      return null;
    }
  }

  async _buildInputFromSnapshot({ prompt, conversation, messages, modelCard }) {
    const supportsImages = Array.isArray(modelCard?.in_modalities) && modelCard.in_modalities.includes('image');
    const contextPrompt = conversation.metadata?.contextPrompt || '';
    const contextRole = modelCard?.context_type || 'none';

    const input = [];
    if (contextRole !== 'none' && contextPrompt.trim().length > 0) {
      input.push({
        role: contextRole,
        content: [{ type: 'input_text', text: contextPrompt }],
      });
    }

    let messagesFromConfiguredStart = messages;
    if (prompt.task_type === 'response') {
      const placeholderIndex = prompt.message_id
        ? messages.findIndex((message) => getMessageId(message) === prompt.message_id)
        : -1;
      const messagesBeforePlaceholder = placeholderIndex >= 0
        ? messages.slice(0, placeholderIndex)
        : messages;
      const configuredStartMessageId = getConfiguredStartMessageId(conversation);
      const configuredStartIndex = configuredStartMessageId
        ? messages.findIndex((message) => getMessageId(message) === configuredStartMessageId)
        : -1;

      messagesFromConfiguredStart = placeholderIndex >= 0
        && configuredStartIndex >= placeholderIndex
        ? []
        : sliceMessagesFromConfiguredStart(messagesBeforePlaceholder, conversation);
    }

    for (const message of messagesFromConfiguredStart) {
      if (prompt.message_id && message._id.toString() === prompt.message_id) break;
      if (message.hideFromBot) continue;

      const role = typeof message.user_id === 'string' && message.user_id.toLowerCase() === 'bot' ? 'assistant' : 'user';
      const contentItems = await this._convertMessageToContent({ message, role, supportsImages });

      if (!contentItems.length) continue;

      const previous = input[input.length - 1];
      if (previous && previous.role === role) {
        previous.content.push(...contentItems);
      } else {
        input.push({ role, content: contentItems });
      }
    }

    if (prompt.task_type === 'summary') {
      input.push({
        role: 'user',
        content: [{ type: 'input_text', text: SUMMARY_PROMPT }],
      });
    }

    return input;
  }

  async _convertMessageToContent({ message, role, supportsImages }) {
    const items = [];
    const content = message?.content || {};

    switch (message.contentType) {
      case 'text':
        if (typeof content.text === 'string' && content.text.trim().length > 0) {
          items.push({
            type: role === 'user' ? 'input_text' : 'output_text',
            text: content.text,
          });
        }
        break;
      case 'image':
        if (role === 'user' && supportsImages && content.image) {
          try {
            const b64 = this.conversationService.loadImageToBase64(content.image);
            items.push({
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${b64}`,
            });
          } catch (error) {
            logger.error('Failed to encode image for batch request', { error, image: content.image });
          }
          if (content.revisedPrompt) {
            items.push({ type: 'input_text', text: content.revisedPrompt });
          }
        } else if (content.revisedPrompt) {
          items.push({
            type: role === 'user' ? 'input_text' : 'output_text',
            text: `Image: ${content.revisedPrompt}`,
          });
        }
        break;
      case 'tool':
        if (content.toolOutput) {
          items.push({
            type: role === 'user' ? 'input_text' : 'output_text',
            text: content.toolOutput,
          });
        }
        break;
      case 'reasoning':
        if (content.text) {
          items.push({
            type: role === 'user' ? 'input_text' : 'output_text',
            text: content.text,
          });
        }
        break;
      case 'audio':
        if (content.transcript) {
          items.push({
            type: role === 'user' ? 'input_text' : 'output_text',
            text: content.transcript,
          });
        }
        break;
      default:
        if (content.text) {
          items.push({
            type: role === 'user' ? 'input_text' : 'output_text',
            text: content.text,
          });
        }
        break;
    }

    return items;
  }
}

module.exports = BatchService;
module.exports.ensureModelsLoaded = ensureModelsLoaded;
module.exports.invalidateBatchModelCache = invalidateBatchModelCache;
module.exports.resolveConfiguredDefaultModel = resolveConfiguredDefaultModel;
module.exports.resolveConfiguredSummaryModel = resolveConfiguredSummaryModel;
module.exports.validateBatchDefaultModelSetting = validateBatchDefaultModelSetting;
module.exports.validateBatchSummaryModelSetting = validateBatchSummaryModelSetting;
