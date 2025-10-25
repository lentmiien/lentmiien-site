const {
  uploadBatchFile,
  startBatchJob,
  retrieveBatchStatus,
  downloadBatchOutput,
  deleteBatchFile,
  convertResponseBody,
} = require('../utils/OpenAI_API');
const { AIModelCards, Conversation5Model, Chat5Model } = require('../database');
const logger = require('../utils/logger');

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

const reasoningModels = [
  'o3-pro-2025-06-10',
  'o3-2025-04-16',
  'o4-mini-2025-04-16',
  'gpt-5-2025-08-07',
  'gpt-5-mini-2025-08-07',
  'gpt-5-nano-2025-08-07',
];

const TOOL_MAP = {
  image_generation: { type: 'image_generation' },
  web_search_preview: { type: 'web_search_preview' },
};

const SUMMARY_PROMPT = 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to read the entire conversation.';

const modelCache = new Map();
let loadModelsPromise = null;

async function ensureModelsLoaded() {
  if (!loadModelsPromise) {
    loadModelsPromise = AIModelCards.find({ model_type: 'chat', batch_use: true, provider: 'OpenAI' })
      .then((cards) => {
        modelCache.clear();
        cards.forEach((card) => {
          modelCache.set(card.api_model, card);
        });
        return cards;
      })
      .catch((error) => {
        logger.error('Failed to load batch-capable model cards', { error });
        modelCache.clear();
      });
  }
  await loadModelsPromise;
}

function normalizeModelName(model) {
  if (!model) return null;
  if (modelCache.has(model)) return model;
  if (redirect_models[model] && modelCache.has(redirect_models[model])) {
    return redirect_models[model];
  }
  return null;
}

function mapTools(toolNames) {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return [];
  const mapped = [];
  for (const tool of toolNames) {
    if (TOOL_MAP[tool]) {
      mapped.push(TOOL_MAP[tool]);
    }
  }
  return mapped;
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
  constructor(BatchPromptDatabase, BatchRequestDatabase, messageService, conversationService) {
    this.BatchPromptDatabase = BatchPromptDatabase;
    this.BatchRequestDatabase = BatchRequestDatabase;
    this.messageService = messageService;
    this.conversationService = conversationService;
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
      model = 'gpt-4.1-2025-04-14',
      title = '(no title)',
      taskType = 'response',
    } = options;

    await ensureModelsLoaded();
    const normalizedModel = normalizeModelName(model);
    if (!normalizedModel) {
      logger.warn('Skipping batch prompt due to unsupported model', { model });
      return null;
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
        await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
        continue;
      }

      const snapshot = await this._loadConversationSnapshot(prompt);
      if (!snapshot) {
        await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
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
        await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
        continue;
      }

      const body = {
        model: normalizedModel,
        input,
      };

      const tools = mapTools(snapshot.conversation.metadata?.tools || []);
      if (tools.length > 0) {
        body.tools = tools;
      }

      const textSettings = buildTextSettings(snapshot.conversation, normalizedModel);
      if (textSettings) {
        body.text = textSettings;
      }

      if (snapshot.conversation.metadata?.reasoning && reasoningModels.includes(normalizedModel)) {
        body.reasoning = { effort: snapshot.conversation.metadata.reasoning, summary: 'detailed' };
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

      for (const record of outputData) {
        const prompt = await this.BatchPromptDatabase.findOne({ custom_id: record.custom_id });
        if (!prompt) continue;

        const responseBody = record?.response?.body;
        if (!responseBody) {
          logger.warn('Batch record missing response body', { custom_id: record.custom_id });
          await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
          processedPromptIds.push(prompt.custom_id);
          continue;
        }

        if (prompt.task_type === 'summary') {
          const summary = extractSummaryText(responseBody);
          if (summary) {
            await this.conversationService.updateConversationDetails(prompt.conversation_id, { summary });
          }
          await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
          processedPromptIds.push(prompt.custom_id);
          continue;
        }

        const conversation = await Conversation5Model.findById(prompt.conversation_id);
        if (!conversation) {
          await this.BatchPromptDatabase.deleteOne({ custom_id: prompt.custom_id });
          processedPromptIds.push(prompt.custom_id);
          continue;
        }

        if (prompt.message_id) {
          conversation.messages = conversation.messages.filter((id) => id !== prompt.message_id);
          await Chat5Model.deleteOne({ _id: prompt.message_id }).catch(() => {});
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

        await this.addPromptToBatch({
          userId: prompt.user_id,
          conversationId: prompt.conversation_id,
          model: 'gpt-4.1-nano-2025-04-14',
          title: prompt.title || conversation.title || '(no title)',
          taskType: 'summary',
        });
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

    if (prompt.message_id) {
      await Chat5Model.deleteOne({ _id: prompt.message_id }).catch(() => {});
      const conversation = await Conversation5Model.findById(prompt.conversation_id);
      if (conversation) {
        conversation.messages = conversation.messages.filter((msgId) => msgId !== prompt.message_id);
        conversation.updatedAt = new Date();
        await conversation.save();
      }
    }

    await this.BatchPromptDatabase.deleteOne({ custom_id: id });
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

    for (const message of messages) {
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
