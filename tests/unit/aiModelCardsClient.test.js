const {
  buildNavigationUrl,
  matchesModelFilters,
  normalizeFilters,
} = require('../../public/js/ai_model_cards');

const localChatModel = {
  search: 'Qwen 3.5 Local qwen3.5-35b-a3b',
  provider: 'Local',
  type: 'chat',
  input: 'text,image',
  output: 'text',
  status: 'active',
  batch: 'yes',
  context: 'system',
};

describe('AI model card client filters', () => {
  test('matches a local model using search terms and combined capability filters', () => {
    expect(matchesModelFilters(localChatModel, {
      search: 'qwen 35b',
      provider: 'Local',
      type: 'chat',
      input: 'image',
      output: 'text',
      status: 'active',
      batch: 'yes',
      context: 'system',
    })).toBe(true);
  });

  test.each([
    { provider: 'OpenAI' },
    { search: 'llama' },
    { input: 'audio' },
    { output: 'image' },
    { status: 'deprecated' },
    { batch: 'no' },
    { context: 'developer' },
  ])('rejects a row when a selected filter does not match: %p', (filters) => {
    expect(matchesModelFilters(localChatModel, filters)).toBe(false);
  });

  test('normalizes filter values without mutating their meaning', () => {
    expect(normalizeFilters({ search: '  QWEN ', provider: ' LOCAL ' })).toEqual({
      search: 'qwen',
      provider: 'local',
      type: '',
      input: '',
      output: '',
      status: '',
      batch: '',
      context: '',
    });
  });

  test('builds edit and cancel links while retaining active filters', () => {
    const root = {
      location: {
        href: 'https://local.test/chat5/ai_model_cards?filter_provider=Local&saved=tokens',
      },
    };

    expect(buildNavigationUrl(root, { editId: 'model-1', hash: '#model-card-form' }))
      .toBe('/chat5/ai_model_cards?filter_provider=Local&edit=model-1#model-card-form');
    expect(buildNavigationUrl(root, { clearEdit: true }))
      .toBe('/chat5/ai_model_cards?filter_provider=Local');
  });
});
