const { normalizeAiGatewayLlmStats } = require('../../utils/aiGatewayLogStats');

describe('AI Gateway LLM log statistics', () => {
  test('normalizes OpenAI-compatible token counts and throughput', () => {
    const stats = normalizeAiGatewayLlmStats({
      openai_stats: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        tokens_per_second: 15,
        prompt_time_ms: 600,
        completion_time_ms: 2000,
      },
    });

    expect(stats).toEqual({
      promptTokens: 120,
      genTokens: 30,
      totalTokens: 150,
      promptTokPerSec: 200,
      genTokPerSec: 15,
    });
  });

  test('derives generation throughput when an OpenAI-compatible rate is absent', () => {
    const stats = normalizeAiGatewayLlmStats({
      openai_stats: {
        prompt_tokens: 40,
        completion_tokens: 12,
        prompt_time_ms: 0,
        completion_time_ms: 800,
      },
    });

    expect(stats.totalTokens).toBe(52);
    expect(stats.promptTokPerSec).toBeNull();
    expect(stats.genTokPerSec).toBe(15);
  });

  test('keeps Ollama statistics and explicit zero values intact', () => {
    const stats = normalizeAiGatewayLlmStats({
      ollama_stats: {
        prompt_eval_count: 100,
        eval_count: 0,
        prompt_tok_per_s: 250,
        gen_tok_per_s: 0,
      },
    });

    expect(stats).toEqual({
      promptTokens: 100,
      genTokens: 0,
      totalTokens: 100,
      promptTokPerSec: 250,
      genTokPerSec: 0,
    });
  });
});
