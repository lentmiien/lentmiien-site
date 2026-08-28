'use strict';

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = asFiniteNumber(value);
    if (number !== null) {
      return number;
    }
  }

  return null;
}

function calculateTokensPerSecond(tokenCount, durationMs) {
  const tokens = asFiniteNumber(tokenCount);
  const milliseconds = asFiniteNumber(durationMs);
  if (tokens === null || milliseconds === null || milliseconds <= 0) {
    return null;
  }

  return tokens / (milliseconds / 1000);
}

function normalizeAiGatewayLlmStats(rawEntry) {
  const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
  const ollamaStats = entry.ollama_stats && typeof entry.ollama_stats === 'object'
    ? entry.ollama_stats
    : {};
  const openaiStats = entry.openai_stats && typeof entry.openai_stats === 'object'
    ? entry.openai_stats
    : {};

  const promptTokens = firstFiniteNumber(
    ollamaStats.prompt_eval_count,
    entry.prompt_eval_count,
    openaiStats.prompt_tokens,
  );
  const genTokens = firstFiniteNumber(
    ollamaStats.eval_count,
    entry.eval_count,
    openaiStats.completion_tokens,
  );
  const countedTotalTokens = promptTokens !== null || genTokens !== null
    ? (promptTokens || 0) + (genTokens || 0)
    : null;

  return {
    promptTokens,
    genTokens,
    totalTokens: firstFiniteNumber(
      openaiStats.total_tokens,
      entry.total_tokens,
      countedTotalTokens,
    ),
    promptTokPerSec: firstFiniteNumber(
      ollamaStats.prompt_tok_per_s,
      entry.prompt_tok_per_s,
      calculateTokensPerSecond(openaiStats.prompt_tokens, openaiStats.prompt_time_ms),
    ),
    genTokPerSec: firstFiniteNumber(
      ollamaStats.gen_tok_per_s,
      entry.gen_tok_per_s,
      entry.tokens_per_second,
      openaiStats.tokens_per_second,
      calculateTokensPerSecond(openaiStats.completion_tokens, openaiStats.completion_time_ms),
    ),
  };
}

module.exports = {
  normalizeAiGatewayLlmStats,
};
