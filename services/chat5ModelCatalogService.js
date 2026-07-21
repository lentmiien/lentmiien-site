const { AIModelCards } = require('../database');
const openai = require('../utils/ChatGPT');

let cachedModels = [];

async function listAvailableChatModels() {
  if (cachedModels.length > 0) return cachedModels;

  const models = await AIModelCards.find();
  const availableOpenAI = new Set(openai.GetOpenAIModels().map((entry) => entry.model));
  cachedModels = models.filter((model) => (
    (model.provider === 'OpenAI' && availableOpenAI.has(model.api_model))
    || model.provider === 'Local'
  ) && model.model_type === 'chat');
  return cachedModels;
}

function invalidateChatModelCache() {
  cachedModels = [];
}

module.exports = {
  invalidateChatModelCache,
  listAvailableChatModels,
};
