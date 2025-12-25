const logger = require('../utils/logger');

const MINUTES_TO_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BEHAVIOR = Object.freeze({
  maxMessagesPerDay: 3,
  minCooldownMinutes: 60,
  triggers: {
    always: false,
    manual: true,
    minUserMessages: 0,
    minAssistantMessages: 0,
  },
  postApproach: 'append',
  personalityId: null,
  responseTypeId: null,
});

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') return value === 1;
  return fallback;
}

function clampNonNegative(value, fallback = 0) {
  const parsed = toInt(value, fallback);
  if (Number.isNaN(parsed)) return fallback;
  return parsed < 0 ? 0 : parsed;
}

class Agent5Service {
  constructor({
    agentModel,
    behaviorModel,
    conversationModel,
    chatModel,
    personalityModel,
    responseTypeModel,
    conversationService = null,
    messageService = null,
  }) {
    this.agentModel = agentModel;
    this.behaviorModel = behaviorModel;
    this.conversationModel = conversationModel;
    this.chatModel = chatModel;
    this.personalityModel = personalityModel;
    this.responseTypeModel = responseTypeModel;
    this.conversationService = conversationService;
    this.messageService = messageService;
    this._defaultBehavior = { ...DEFAULT_BEHAVIOR };
  }

  getDefaultBehaviorTemplate() {
    return { ...this._defaultBehavior };
  }

  normalizeAgentName(name) {
    if (typeof name !== 'string') return '';
    const trimmed = name.trim();
    if (trimmed.length === 0) return '';
    const base = trimmed.replace(/^agent_/i, '').replace(/^AGENT_/i, '');
    return `AGENT_${base}`;
  }

  normalizeBehavior(input = {}, fallback = DEFAULT_BEHAVIOR) {
    const base = fallback || DEFAULT_BEHAVIOR;
    const triggers = input.triggers || input;
    const normalized = {
      maxMessagesPerDay: clampNonNegative(input.maxMessagesPerDay, base.maxMessagesPerDay),
      minCooldownMinutes: clampNonNegative(input.minCooldownMinutes, base.minCooldownMinutes),
      triggers: {
        always: parseBool(triggers.always ?? triggers.trigger_always, base.triggers?.always ?? false),
        manual: parseBool(triggers.manual ?? triggers.trigger_manual, base.triggers?.manual ?? true),
        minUserMessages: clampNonNegative(triggers.minUserMessages ?? triggers.trigger_minUserMessages, base.triggers?.minUserMessages ?? 0),
        minAssistantMessages: clampNonNegative(triggers.minAssistantMessages ?? triggers.trigger_minAssistantMessages, base.triggers?.minAssistantMessages ?? 0),
      },
      postApproach: ['append', 'append_and_request'].includes(input.postApproach)
        ? input.postApproach
        : (base.postApproach || DEFAULT_BEHAVIOR.postApproach),
      personalityId: input.personalityId || base.personalityId || null,
      responseTypeId: input.responseTypeId || base.responseTypeId || null,
    };
    return normalized;
  }

  async validateBehaviorReferences(behavior) {
    if (!behavior) {
      throw new Error('Behavior is required');
    }
    if (!behavior.personalityId) {
      throw new Error('Personality is required for agent behavior');
    }
    if (!behavior.responseTypeId) {
      throw new Error('Response type is required for agent behavior');
    }
    const [personaExists, responseTypeExists] = await Promise.all([
      this.personalityModel.findById(behavior.personalityId),
      this.responseTypeModel.findById(behavior.responseTypeId),
    ]);
    if (!personaExists) {
      throw new Error('Personality not found');
    }
    if (!responseTypeExists) {
      throw new Error('Response type not found');
    }
  }

  async createAgent({ name, checkIntervalMinutes, behavior, isActive = true }) {
    const normalizedName = this.normalizeAgentName(name);
    if (!normalizedName) {
      throw new Error('Agent name is required');
    }
    const normalizedBehavior = this.normalizeBehavior(behavior, DEFAULT_BEHAVIOR);
    await this.validateBehaviorReferences(normalizedBehavior);
    const interval = Math.max(1, clampNonNegative(checkIntervalMinutes, 30));

    const agent = new this.agentModel({
      name: normalizedName,
      checkIntervalMinutes: interval,
      isActive: parseBool(isActive, true),
      defaultBehavior: normalizedBehavior,
    });
    await agent.save();
    return agent;
  }

  async saveConversationBehavior({ agentId, conversationId, behavior, isActive = true }) {
    const agent = await this.agentModel.findById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const normalizedBehavior = this.normalizeBehavior(behavior, agent.defaultBehavior || DEFAULT_BEHAVIOR);
    await this.validateBehaviorReferences(normalizedBehavior);

    const payload = {
      agentId: agent._id,
      conversationId: conversation._id,
      behavior: normalizedBehavior,
      isActive: parseBool(isActive, true),
    };

    const updated = await this.behaviorModel.findOneAndUpdate(
      { agentId: agent._id, conversationId: conversation._id },
      payload,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return updated;
  }

  async getEffectiveBehavior(agent, conversationId) {
    const base = this.normalizeBehavior(agent.defaultBehavior, DEFAULT_BEHAVIOR);
    const override = await this.behaviorModel.findOne({ agentId: agent._id, conversationId });
    if (override && override.isActive !== false) {
      return this.normalizeBehavior(override.behavior, base);
    }
    return base;
  }

  async listAgents() {
    return this.agentModel.find().sort({ name: 1 });
  }

  async listBehaviors(limit = 50) {
    return this.behaviorModel.find().sort({ updatedAt: -1 }).limit(limit);
  }

  async evaluateConversation({ agent, conversation, behavior }) {
    const now = new Date();
    const dayThreshold = new Date(now.getTime() - DAY_MS);
    const messageIds = Array.isArray(conversation.messages)
      ? conversation.messages.map((id) => (id ? id.toString() : null)).filter(Boolean)
      : [];

    if (messageIds.length === 0) {
      return { shouldPost: false, reason: 'no-messages' };
    }

    const dailyCount = await this.chatModel.countDocuments({
      _id: { $in: messageIds },
      user_id: agent.name,
      timestamp: { $gte: dayThreshold },
    });
    const maxPerDay = Number.isFinite(behavior.maxMessagesPerDay)
      ? behavior.maxMessagesPerDay
      : DEFAULT_BEHAVIOR.maxMessagesPerDay;
    if (maxPerDay <= 0) {
      return { shouldPost: false, reason: 'max-per-day', stats: { dailyCount } };
    }
    if (dailyCount >= maxPerDay) {
      return { shouldPost: false, reason: 'max-per-day', stats: { dailyCount } };
    }

    const lastAgentMessage = await this.chatModel.findOne({
      _id: { $in: messageIds },
      user_id: agent.name,
    }).sort({ timestamp: -1 }).lean();

    if (lastAgentMessage && behavior.minCooldownMinutes > 0) {
      const diff = now.getTime() - new Date(lastAgentMessage.timestamp).getTime();
      if (diff < behavior.minCooldownMinutes * MINUTES_TO_MS) {
        return {
          shouldPost: false,
          reason: 'cooldown',
          lastAgentMessageAt: lastAgentMessage.timestamp,
          stats: { dailyCount },
        };
      }
    }

    const sinceDate = lastAgentMessage ? new Date(lastAgentMessage.timestamp) : dayThreshold;
    const messagesSince = await this.chatModel.find({
      _id: { $in: messageIds },
      timestamp: { $gt: sinceDate },
    }).sort({ timestamp: 1 }).lean();

    let userCount = 0;
    let assistantCount = 0;
    let mentionFound = false;
    const mentionNeedle = `@${agent.name}`.toLowerCase();

    for (const msg of messagesSince) {
      const userId = msg.user_id || '';
      if (userId === agent.name) continue;
      if (userId === 'bot') {
        assistantCount++;
      } else {
        const isAgentUser = typeof userId === 'string' && userId.startsWith('AGENT_');
        if (!isAgentUser) userCount++;
      }

      if (!mentionFound && msg.content) {
        const texts = [];
        if (typeof msg.content.text === 'string') texts.push(msg.content.text);
        if (typeof msg.content.transcript === 'string') texts.push(msg.content.transcript);
        if (typeof msg.content.revisedPrompt === 'string') texts.push(msg.content.revisedPrompt);
        mentionFound = texts.some((t) => t && t.toLowerCase().includes(mentionNeedle));
      }
    }

    const triggers = [];
    if (behavior.triggers.always) triggers.push(true);
    if (behavior.triggers.manual && mentionFound) triggers.push(true);
    if (behavior.triggers.minUserMessages > 0 && userCount >= behavior.triggers.minUserMessages) triggers.push(true);
    if (behavior.triggers.minAssistantMessages > 0 && assistantCount >= behavior.triggers.minAssistantMessages) triggers.push(true);

    const shouldPost = triggers.length > 0 && triggers.some(Boolean);

    return {
      shouldPost,
      reason: shouldPost ? 'triggered' : 'no-trigger',
      lastAgentMessageAt: lastAgentMessage ? lastAgentMessage.timestamp : null,
      stats: {
        userCount,
        assistantCount,
        mentionFound,
        dailyCount,
      },
    };
  }

  async postAgentMessage({ agent, conversation, behavior, reason }) {
    if (!this.conversationService || !this.messageService) {
      throw new Error('Conversation service is not configured for agent posting');
    }

    const [personality, responseType] = await Promise.all([
      this.personalityModel.findById(behavior.personalityId),
      this.responseTypeModel.findById(behavior.responseTypeId),
    ]);

    if (!personality || !responseType) {
      throw new Error('Personality or response type not found');
    }

    const prompt = await this.conversationService.draftPromptForConversation({
      conversationId: conversation._id.toString(),
      personality: { name: personality.name, instructions: personality.instructions },
      responseType: { label: responseType.label, instructions: responseType.instructions },
      notes: '',
      userName: agent.name,
    });

    const { userMessage, aiMessages = [] } = await this.conversationService.postToConversationNew({
      conversationId: conversation._id.toString(),
      userId: agent.name,
      messageContent: {
        text: prompt,
        image: null,
        audio: null,
        tts: null,
        transcript: null,
        revisedPrompt: null,
        imageQuality: null,
        toolOutput: null,
      },
      messageType: 'text',
      generateAI: behavior.postApproach === 'append_and_request',
    });

    const messageId = userMessage && userMessage._id ? userMessage._id.toString() : null;
    const aiMessageIds = aiMessages.map((m) => (m && m._id ? m._id.toString() : null)).filter(Boolean);

    logger.notice('Agent5 posted message', {
      category: 'agent5',
      metadata: {
        agent: agent.name,
        conversationId: conversation._id.toString(),
        approach: behavior.postApproach,
        reason,
        messageId,
        aiMessageIds,
      },
    });

    return { userMessage, aiMessages };
  }

  async runAgent(agent) {
    if (!this.conversationModel) {
      throw new Error('Conversation model missing');
    }
    const threshold = new Date(Date.now() - DAY_MS);
    const conversations = await this.conversationModel.find({
      members: agent.name,
      updatedAt: { $gte: threshold },
    });

    for (const conversation of conversations) {
      try {
        const behavior = await this.getEffectiveBehavior(agent, conversation._id);
        const evaluation = await this.evaluateConversation({ agent, conversation, behavior });
        if (!evaluation.shouldPost) {
          logger.debug('Agent5 skipped conversation', {
            category: 'agent5',
            metadata: {
              agent: agent.name,
              conversationId: conversation._id.toString(),
              reason: evaluation.reason,
            },
          });
          continue;
        }
        await this.postAgentMessage({
          agent,
          conversation,
          behavior,
          reason: evaluation.reason,
        });
      } catch (error) {
        logger.error('Agent5 failed processing conversation', {
          category: 'agent5',
          metadata: {
            agent: agent.name,
            conversationId: conversation && conversation._id ? conversation._id.toString() : null,
            error: error.message,
          },
        });
      }
    }
  }

  async runDueAgents(runState = new Map()) {
    const agents = await this.agentModel.find({ isActive: true });
    const now = Date.now();
    for (const agent of agents) {
      const key = agent._id.toString();
      const intervalMs = Math.max(1, clampNonNegative(agent.checkIntervalMinutes, 30)) * MINUTES_TO_MS;
      const lastRun = runState.get(key) || (agent.lastRunAt ? agent.lastRunAt.getTime() : 0);
      if (lastRun && now - lastRun < intervalMs) continue;

      try {
        await this.runAgent(agent);
        agent.lastRunAt = new Date();
        await agent.save();
      } catch (error) {
        logger.error('Agent5 execution failed', {
          category: 'agent5',
          metadata: { agent: agent.name, error: error.message },
        });
      } finally {
        runState.set(key, now);
      }
    }
  }
}

module.exports = Agent5Service;
