const fs = require('node:fs/promises');
const axios = require('axios');
const logger = require('../utils/logger');
const baseURL = require('../utils/llmGatewayBaseUrl');

const isVeniceModel = id => typeof id === 'string' && id.startsWith('venice/');
const chatConfigured = () => Boolean(process.env.VENICE_GATEWAY_CLIENT_TOKEN || process.env.VENICE_GATEWAY_CLIENT_TOKEN_FILE);
let catalogPromise;
let expiresAt = 0;

async function loadCards() {
  try {
    const { data } = await axios.get('/llm/models', {
      baseURL, timeout: 2500, maxRedirects: 0, maxContentLength: 1024 * 1024,
    });
    return data.models.filter(m => m?.provider === 'venice' && isVeniceModel(m.id)).map(m => ({
      api_model: m.id, model_name: m.display_name || m.id, provider: 'Venice', model_type: 'chat',
      in_modalities: m.allow_images === true ? ['text', 'image'] : ['text'], out_modalities: ['text'],
      limits: m.limits,
      max_tokens: m.limits?.max_context_tokens, max_out_tokens: m.limits?.max_output_tokens,
      context_type: 'system', batch_use: false,
    }));
  } catch (error) {
    logger.warning('Unable to discover Venice models on the AI Gateway', {
      category: 'venice_gateway', metadata: { status: error.response?.status, code: error.code },
    });
    return [];
  }
}

function listCards() {
  if (!catalogPromise || Date.now() >= expiresAt) {
    catalogPromise = loadCards();
    expiresAt = Date.now() + 30000;
  }
  return catalogPromise;
}

async function chatCards() {
  return chatConfigured() ? listCards() : [];
}

async function postChat(payload) {
  if (!(await chatCards()).some(card => card.api_model === payload.model)) {
    throw new Error('Selected Venice model is unavailable.');
  }
  let token = process.env.VENICE_GATEWAY_CLIENT_TOKEN;
  try {
    if (!token) token = await fs.readFile(process.env.VENICE_GATEWAY_CLIENT_TOKEN_FILE, 'utf8');
    token = token.trim();
    if (!token) throw new Error();
  } catch {
    logger.error('Configure a readable Venice Gateway client credential', { category: 'venice_gateway' });
    throw new Error('Venice Gateway credential is unavailable.');
  }
  try {
    const response = await axios.post('/llm/chat', payload, {
      baseURL, headers: { Authorization: `Bearer ${token}` }, maxRedirects: 0, timeout: 660000,
      maxBodyLength: 16 * 1024 * 1024, maxContentLength: 4 * 1024 * 1024,
    });
    const text = response.data?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error();
    return text;
  } catch (error) {
    const status = error.response?.status;
    logger.error('Venice Gateway chat request failed', { category: 'venice_gateway', metadata: { status, model: payload.model } });
    throw new Error(`Venice Gateway chat failed${status ? ` (HTTP ${status})` : ''}.`);
  }
}

module.exports = { isVeniceModel, listCards, chatCards, postChat };
