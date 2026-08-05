const {
  AIModelCardInputError,
  buildModelCardsRedirect,
  parseModelCardInput,
  parseTokenLimits,
} = require('../../services/aiModelCardManagementService');

function validModelBody(overrides = {}) {
  return {
    model_name: ' Local Qwen ',
    provider: ' Local ',
    api_model: ' qwen-local ',
    input_1m_token_cost: '0',
    output_1m_token_cost: '0.25',
    model_type: 'chat',
    in_modalities: ['text', 'image'],
    out_modalities: 'text',
    max_tokens: '32768',
    max_out_tokens: '8192',
    deprecation_date: '',
    batch_use: 'on',
    context_type: 'system',
    ...overrides,
  };
}

describe('AI model card management input parsing', () => {
  test('normalizes a complete model card form', () => {
    expect(parseModelCardInput(validModelBody())).toEqual({
      model_name: 'Local Qwen',
      provider: 'Local',
      api_model: 'qwen-local',
      input_1m_token_cost: 0,
      output_1m_token_cost: 0.25,
      model_type: 'chat',
      in_modalities: ['text', 'image'],
      out_modalities: ['text'],
      max_tokens: 32768,
      max_out_tokens: 8192,
      deprecation_date: null,
      batch_use: true,
      context_type: 'system',
    });
  });

  test('accepts a valid scheduled date and an unchecked batch field', () => {
    const result = parseModelCardInput(validModelBody({
      deprecation_date: '2026-12-31',
      batch_use: undefined,
    }));

    expect(result.deprecation_date.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(result.batch_use).toBe(false);
  });

  test.each([
    [{ max_tokens: '0' }, 'Max total tokens'],
    [{ max_out_tokens: '1.5' }, 'Max output tokens'],
    [{ input_1m_token_cost: '' }, 'Input token cost'],
    [{ in_modalities: [] }, 'input modality'],
    [{ model_type: 'completion' }, 'model type'],
    [{ deprecation_date: '2026-02-30' }, 'scheduled deprecation date'],
  ])('rejects invalid model-card values: %p', (overrides, expectedMessage) => {
    expect(() => parseModelCardInput(validModelBody(overrides)))
      .toThrow(expectedMessage);
  });

  test('parses just the two token limits for inline updates', () => {
    expect(parseTokenLimits({ max_tokens: '131072', max_out_tokens: '16384' })).toEqual({
      max_tokens: 131072,
      max_out_tokens: 16384,
    });
    expect(() => parseTokenLimits({ max_tokens: '-1', max_out_tokens: '10' }))
      .toThrow(AIModelCardInputError);
  });
});

describe('AI model card return URLs', () => {
  test('preserves filters, clears edit mode, and replaces stale result messages', () => {
    const result = buildModelCardsRedirect(
      '/chat5/ai_model_cards?filter_provider=Local&edit=model-1&error=old',
      { saved: 'updated', clearEdit: true },
    );

    expect(result).toBe('/chat5/ai_model_cards?filter_provider=Local&saved=updated');
  });

  test('does not allow redirects away from the model-card list', () => {
    expect(buildModelCardsRedirect('https://example.com/phishing', { saved: 'tokens' }))
      .toBe('/chat5/ai_model_cards?saved=tokens');
    expect(buildModelCardsRedirect('/admin', { error: 'update-failed' }))
      .toBe('/chat5/ai_model_cards?error=update-failed');
  });
});
