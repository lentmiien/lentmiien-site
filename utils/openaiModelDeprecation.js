const AiModelCard = require('../models/ai_model_card');
const logger = require('./logger');
const { toDateOnlyString, toLocalDateOnlyString } = require('./dateOnly');

const warningTimes = new Map();
const WARNING_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_WARNING_KEYS = 512;

function warnOnce(key, message, metadata, now) {
  const previous = warningTimes.get(key);
  if (previous !== undefined && now - previous < WARNING_INTERVAL_MS) return;
  warningTimes.delete(key);
  if (warningTimes.size >= MAX_WARNING_KEYS) warningTimes.delete(warningTimes.keys().next().value);
  warningTimes.set(key, now);
  logger.warning(message, { category: 'openai_model_deprecation', metadata });
}

function block(message, code, metadata) {
  logger.error(message, { category: 'openai_model_deprecation', metadata });
  const error = new Error(message);
  error.code = code;
  throw error;
}

// Model-card dates are calendar dates, evaluated in the application's local timezone.
// Clamp the three-month horizon (for example, November 30 -> February 28).
function warningHorizon(now) {
  const horizon = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  const lastDay = new Date(horizon.getFullYear(), horizon.getMonth() + 1, 0).getDate();
  horizon.setDate(Math.min(now.getDate(), lastDay));
  return toLocalDateOnlyString(horizon);
}

async function assertOpenAIModelActive(model, operation) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) {
    block('OpenAI request blocked: invalid model identifier', 'OPENAI_MODEL_INVALID', { operation });
  }
  let cards;
  try {
    // Read fresh cards at submission time; edits and date boundaries must not be hidden by a cache.
    cards = await AiModelCard.find({ provider: 'OpenAI', api_model: model }, { deprecation_date: 1 })
      .maxTimeMS(5000).lean();
  } catch (error) {
    block('OpenAI request blocked: unable to check model-card deprecation; restore model-card access',
      'OPENAI_MODEL_CHECK_FAILED', { model, operation });
  }

  const now = new Date();
  const metadata = { model, operation };
  if (cards.length === 0) {
    warnOnce(`missing:${model}`, 'OpenAI model card missing; add a card to track deprecation', metadata, now.getTime());
    return;
  }

  const dates = [];
  for (const card of cards) {
    if (card.deprecation_date === null || card.deprecation_date === undefined) continue;
    const date = toDateOnlyString(card.deprecation_date);
    if (!date) {
      block('OpenAI request blocked: invalid model-card deprecation date; correct the model card',
        'OPENAI_MODEL_CHECK_FAILED', metadata);
    }
    dates.push(date);
  }
  // If duplicate cards exist, use the earliest declared date.
  const deprecationDate = dates.sort()[0];
  if (!deprecationDate) return;
  metadata.deprecationDate = deprecationDate;
  if (deprecationDate <= toLocalDateOnlyString(now)) {
    block('OpenAI request blocked: model is deprecated according to its model card; select an active model',
      'OPENAI_MODEL_DEPRECATED', metadata);
  }
  if (deprecationDate <= warningHorizon(now)) {
    warnOnce(`scheduled:${model}:${deprecationDate}`,
      'OpenAI model is scheduled for deprecation within three months; update callers before the deprecation date',
      metadata, now.getTime());
  }
}

async function assertOpenAIBatchModelsActive(contents, operation) {
  const models = new Set();
  try {
    for (const line of contents.split('\n')) {
      if (line.trim()) models.add(JSON.parse(line).body?.model);
    }
  } catch (error) {
    block('OpenAI batch blocked: unable to read model identifiers from batch input',
      'OPENAI_MODEL_CHECK_FAILED', { operation });
  }
  for (const model of models) await assertOpenAIModelActive(model, operation);
}

module.exports = { assertOpenAIModelActive, assertOpenAIBatchModelsActive };
