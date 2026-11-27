const DEFAULT_BASE_URL = 'http://192.168.0.20:8080';
const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_BASE_URL;
  }
  let normalized = value.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.length > 0 ? normalized : DEFAULT_BASE_URL;
};

module.exports = normalizeBaseUrl(process.env.OLLAMA_BASE_URL || process.env.AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL);
