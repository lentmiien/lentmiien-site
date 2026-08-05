const { parseOptionalDateOnly } = require('../utils/dateOnly');

const MODEL_TYPES = ['chat', 'embedding', 'image', 'audio', 'realtime', 'video'];
const MODALITIES = ['text', 'image', 'audio', 'video', 'vector'];
const CONTEXT_TYPES = ['none', 'system', 'developer'];
const MODEL_CARDS_PATH = '/chat5/ai_model_cards';

class AIModelCardInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIModelCardInputError';
  }
}

function parseRequiredString(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new AIModelCardInputError(`${label} is required.`);
  }
  return normalized;
}

function parseNonNegativeNumber(value, label) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new AIModelCardInputError(`${label} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AIModelCardInputError(`${label} must be zero or greater.`);
  }
  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AIModelCardInputError(`${label} must be a positive whole number.`);
  }
  return parsed;
}

function parseEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    throw new AIModelCardInputError(`Select a valid ${label}.`);
  }
  return value;
}

function parseEnumList(value, allowedValues, label) {
  const values = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  const normalized = [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
  if (normalized.length === 0 || normalized.some((entry) => !allowedValues.includes(entry))) {
    throw new AIModelCardInputError(`Select at least one valid ${label}.`);
  }
  return normalized;
}

function parseTokenLimits(body = {}) {
  return {
    max_tokens: parsePositiveInteger(body.max_tokens, 'Max total tokens'),
    max_out_tokens: parsePositiveInteger(body.max_out_tokens, 'Max output tokens'),
  };
}

function parseModelCardInput(body = {}) {
  let deprecationDate;
  try {
    deprecationDate = parseOptionalDateOnly(body.deprecation_date);
  } catch (error) {
    throw new AIModelCardInputError('Enter a valid scheduled deprecation date.');
  }

  return {
    model_name: parseRequiredString(body.model_name, 'Model name'),
    provider: parseRequiredString(body.provider, 'Provider'),
    api_model: parseRequiredString(body.api_model, 'API model'),
    input_1m_token_cost: parseNonNegativeNumber(body.input_1m_token_cost, 'Input token cost'),
    output_1m_token_cost: parseNonNegativeNumber(body.output_1m_token_cost, 'Output token cost'),
    model_type: parseEnum(body.model_type, MODEL_TYPES, 'model type'),
    in_modalities: parseEnumList(body.in_modalities, MODALITIES, 'input modality'),
    out_modalities: parseEnumList(body.out_modalities, MODALITIES, 'output modality'),
    ...parseTokenLimits(body),
    deprecation_date: deprecationDate,
    batch_use: body.batch_use === true || ['on', 'true', '1'].includes(body.batch_use),
    context_type: parseEnum(body.context_type || 'none', CONTEXT_TYPES, 'context type'),
  };
}

function buildModelCardsRedirect(returnTo, { error = '', saved = '', clearEdit = false } = {}) {
  const base = new URL(MODEL_CARDS_PATH, 'http://localhost');
  let target = new URL(base.href);

  if (typeof returnTo === 'string' && returnTo.trim()) {
    try {
      const candidate = new URL(returnTo, base);
      if (candidate.origin === base.origin && candidate.pathname === MODEL_CARDS_PATH) {
        target = candidate;
      }
    } catch (error) {
      // Keep the known-safe default target.
    }
  }

  target.hash = '';
  target.searchParams.delete('error');
  target.searchParams.delete('saved');
  if (clearEdit) target.searchParams.delete('edit');
  if (error) target.searchParams.set('error', error);
  if (saved) target.searchParams.set('saved', saved);

  return `${target.pathname}${target.search}`;
}

module.exports = {
  AIModelCardInputError,
  CONTEXT_TYPES,
  MODEL_TYPES,
  MODALITIES,
  buildModelCardsRedirect,
  parseModelCardInput,
  parseTokenLimits,
};
