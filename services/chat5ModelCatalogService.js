const { AIModelCards } = require('../database');
const openai = require('../utils/ChatGPT');
const { hasDatePassed } = require('../utils/dateOnly');

let cachedModels = null;

async function listAvailableChatModels() {
  if (cachedModels === null) {
    const models = await AIModelCards.find();
    const availableOpenAI = new Set(openai.GetOpenAIModels().map((entry) => entry.model));
    cachedModels = models.filter((model) => (
      (model.provider === 'OpenAI' && availableOpenAI.has(model.api_model))
      || model.provider === 'Local'
    ) && model.model_type === 'chat');
  }

  return cachedModels.filter((model) => !hasDatePassed(model.deprecation_date));
}

function invalidateChatModelCache() {
  cachedModels = null;
}

module.exports = {
  invalidateChatModelCache,
  listAvailableChatModels,
};
