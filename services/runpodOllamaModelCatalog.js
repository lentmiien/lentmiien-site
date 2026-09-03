'use strict';

const QWEN38_27B_MODEL = 'qwen3.8:27b';
const QWEN38_27B_NATIVE_CONTEXT_TOKENS = 262_144;
const QWEN38_27B_CONTEXT_TOKEN_OPTIONS = Object.freeze([
  32_768,
  65_536,
  98_304,
  131_072,
  196_608,
  229_376,
  QWEN38_27B_NATIVE_CONTEXT_TOKENS,
]);

const QWEN38_27B_CONTEXT_PROFILES = Object.freeze([
  Object.freeze({
    vramLabel: '24 GB',
    recommendedContextTokens: 65_536,
    practicalCeilingTokens: 98_304,
    note: 'Comfortable f16 KV-cache target; the upper tier leaves little room for other GPU work.',
  }),
  Object.freeze({
    vramLabel: '32 GB',
    recommendedContextTokens: 196_608,
    practicalCeilingTokens: 229_376,
    note: '196K was live-tested at about 27.9 GiB projected VRAM with roughly 4.2 GiB nominal headroom.',
  }),
  Object.freeze({
    vramLabel: '48 GB',
    recommendedContextTokens: QWEN38_27B_NATIVE_CONTEXT_TOKENS,
    practicalCeilingTokens: QWEN38_27B_NATIVE_CONTEXT_TOKENS,
    note: 'Comfortably reaches the model\'s full native context with the default high-quality f16 KV cache.',
  }),
  Object.freeze({
    vramLabel: '80+ GB',
    recommendedContextTokens: QWEN38_27B_NATIVE_CONTEXT_TOKENS,
    practicalCeilingTokens: QWEN38_27B_NATIVE_CONTEXT_TOKENS,
    note: 'The native limit remains 256K; extra VRAM is better used for concurrency or higher-precision weights.',
  }),
]);

function isQwen38Model(value) {
  return typeof value === 'string'
    && value.trim().toLowerCase() === QWEN38_27B_MODEL;
}

function qwen38ContextRecommendationForVram(value) {
  const vramGb = Number(value);
  if (!Number.isFinite(vramGb) || vramGb < 24) return 32_768;
  if (vramGb < 32) return 65_536;
  if (vramGb < 48) return 196_608;
  return QWEN38_27B_NATIVE_CONTEXT_TOKENS;
}

function ollamaContextFromEnv(env = {}) {
  const raw = env instanceof Map
    ? env.get('OLLAMA_CONTEXT_LENGTH')
    : env?.OLLAMA_CONTEXT_LENGTH;
  const contextTokens = Number(raw);
  return Number.isSafeInteger(contextTokens)
    && contextTokens >= 2_048
    && contextTokens <= QWEN38_27B_NATIVE_CONTEXT_TOKENS
    ? contextTokens
    : null;
}

module.exports = {
  QWEN38_27B_CONTEXT_PROFILES,
  QWEN38_27B_CONTEXT_TOKEN_OPTIONS,
  QWEN38_27B_MODEL,
  QWEN38_27B_NATIVE_CONTEXT_TOKENS,
  isQwen38Model,
  ollamaContextFromEnv,
  qwen38ContextRecommendationForVram,
};
