const { MODEL_CONTRACTS } = require('./gptImageModels');
const { toDateOnlyString, toLocalDateOnlyString } = require('../utils/dateOnly');

// Deployment diagnostic only. Do not invent pricing/limits or overwrite cards.
async function auditGptImageModelCards({ model = require('../models/ai_model_card'),
  log = require('../utils/logger'), now = new Date() } = {}) {
  const ids = Object.keys(MODEL_CONTRACTS);
  const cards = await model.find({ provider: 'OpenAI', api_model: { $in: ids } })
    .select('api_model model_type in_modalities out_modalities deprecation_date')
    .limit(101).maxTimeMS(5000).lean();
  const issues = [];
  for (const id of ids) {
    const matches = cards.filter(card => card.api_model === id);
    const reasons = new Set();
    if (!matches.length) reasons.add('missing_card');
    if (matches.length > 1) reasons.add('duplicate_cards');
    for (const card of matches) {
      if (card.model_type !== 'image' || !['text', 'image'].every(value => card.in_modalities?.includes(value))
        || !card.out_modalities?.includes('image')) reasons.add('incompatible_modalities');
      if (card.deprecation_date != null) {
        const date = toDateOnlyString(card.deprecation_date);
        if (!date) reasons.add('invalid_deprecation_date');
        else if (date <= toLocalDateOnlyString(now)) reasons.add('deprecated_selectable_model');
      }
    }
    if (reasons.size) issues.push({ model: id, reasons: [...reasons] });
  }
  const truncated = cards.length > 100;
  if (issues.length || truncated) log.warning('GPT Image model-card configuration needs review before deployment', {
    category: 'openai_model_deprecation', metadata: { issues, truncated },
  });
  return { ok: !issues.length && !truncated, issues, truncated };
}

module.exports = { auditGptImageModelCards };
