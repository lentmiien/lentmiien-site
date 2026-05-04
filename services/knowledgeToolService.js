const KnowledgeService = require('./knowledgeService');

const FIXED_USER_ID = 'Lennart';
const DEFAULT_ORIGIN_CONVERSATION_ID = 'none';
const DEFAULT_ORIGIN_TYPE = 'chat5';
const MAX_SHORT_FIELD_LENGTH = 100;

function createInputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeRequiredLine(value, fieldName) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw createInputError(`${fieldName} is required.`);
  }
  if (normalized.length > MAX_SHORT_FIELD_LENGTH) {
    throw createInputError(`${fieldName} must be ${MAX_SHORT_FIELD_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeContentMarkdown(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createInputError('contentMarkdown is required.');
  }
  return normalized;
}

function toRawStringArray(value = []) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return String(value).split(',');
}

function normalizeTags(value = []) {
  const tags = toRawStringArray(value)
    .map((tag) => String(tag || '').trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean);

  const normalized = [];
  tags.forEach((tag) => {
    if (tag.length > MAX_SHORT_FIELD_LENGTH) {
      throw createInputError(`tag "${tag}" must be ${MAX_SHORT_FIELD_LENGTH} characters or fewer.`);
    }
    if (!normalized.includes(tag)) {
      normalized.push(tag);
    }
  });
  return normalized;
}

function extractImageFilename(value) {
  let candidate = String(value || '').trim();
  if (!candidate) {
    return '';
  }

  try {
    candidate = new URL(candidate).pathname;
  } catch (_error) {
    // Plain filenames are expected most of the time.
  }

  const imagePathMarker = '/img/';
  const imagePathIndex = candidate.lastIndexOf(imagePathMarker);
  if (imagePathIndex >= 0) {
    candidate = candidate.slice(imagePathIndex + imagePathMarker.length);
  }

  if (candidate.includes('/')) {
    candidate = candidate.split('/').filter(Boolean).pop() || '';
  }

  return candidate.trim();
}

function normalizeImages(value = []) {
  const images = toRawStringArray(value)
    .map(extractImageFilename)
    .filter(Boolean);

  const normalized = [];
  images.forEach((image) => {
    if (image.length > MAX_SHORT_FIELD_LENGTH) {
      throw createInputError(`image "${image}" must be ${MAX_SHORT_FIELD_LENGTH} characters or fewer.`);
    }
    if (!normalized.includes(image)) {
      normalized.push(image);
    }
  });
  return normalized;
}

function resolveOriginConversationId(context = {}) {
  const candidate = context.originConversationId
    || context.conversationId
    || context.conversation?._id?.toString?.()
    || context.conversation?.id?.toString?.()
    || DEFAULT_ORIGIN_CONVERSATION_ID;
  const normalized = String(candidate || '').trim();
  if (!normalized || normalized.length > MAX_SHORT_FIELD_LENGTH) {
    return DEFAULT_ORIGIN_CONVERSATION_ID;
  }
  return normalized;
}

class KnowledgeToolService {
  constructor({ knowledgeService = null } = {}) {
    this.knowledgeService = knowledgeService;
  }

  getKnowledgeService() {
    if (!this.knowledgeService) {
      const { Chat4KnowledgeModel } = require('../database');
      this.knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
    }
    return this.knowledgeService;
  }

  async createKnowledge(args = {}, context = {}) {
    const title = normalizeRequiredLine(args.title, 'title');
    const contentMarkdown = normalizeContentMarkdown(args.contentMarkdown);
    const category = normalizeRequiredLine(args.category, 'category');
    const tags = normalizeTags(args.tags);
    const images = normalizeImages(args.images);
    const originConversationId = resolveOriginConversationId(context);

    const knowledgeId = await this.getKnowledgeService().createKnowledge(
      title,
      originConversationId,
      contentMarkdown,
      category,
      tags,
      images,
      FIXED_USER_ID,
      DEFAULT_ORIGIN_TYPE
    );

    return {
      ok: true,
      knowledgeId,
      userId: FIXED_USER_ID,
      originConversationId,
      originType: DEFAULT_ORIGIN_TYPE,
      title,
      category,
      tags,
      images,
      viewPath: `/chat4/viewknowledge/${knowledgeId}`,
    };
  }
}

module.exports = KnowledgeToolService;
