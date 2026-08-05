const path = require('path');
const pug = require('pug');

function renderModelCards(overrides = {}) {
  const model = {
    _id: 'model-1',
    model_name: 'Local Qwen',
    provider: 'Local',
    api_model: 'qwen-local',
    input_1m_token_cost: 0,
    output_1m_token_cost: 0,
    model_type: 'chat',
    in_modalities: ['text', 'image'],
    out_modalities: ['text'],
    max_tokens: 32768,
    max_out_tokens: 8192,
    added_date: new Date('2026-08-01T00:00:00.000Z'),
    deprecation_date_input: '',
    deprecation_date_has_passed: false,
    deprecation_status: 'active',
    batch_use: true,
    context_type: 'system',
  };
  const editingModel = Object.prototype.hasOwnProperty.call(overrides, 'editingModel')
    ? overrides.editingModel
    : model;

  return pug.renderFile(path.join(process.cwd(), 'views', 'ai_model_cards.pug'), {
    models: [model],
    formDefaults: editingModel || {
      model_name: '',
      provider: '',
      api_model: '',
      input_1m_token_cost: '',
      output_1m_token_cost: '',
      model_type: 'chat',
      in_modalities: [],
      out_modalities: [],
      max_tokens: '',
      max_out_tokens: '',
      deprecation_date_input: '',
      batch_use: false,
      context_type: 'none',
    },
    editingModel,
    providerOptions: ['OpenAI', 'Local'],
    modelTypes: ['chat', 'embedding', 'image', 'audio', 'realtime', 'video'],
    modalities: ['text', 'image', 'audio', 'video', 'vector'],
    contextTypes: ['none', 'system', 'developer'],
    filterOptions: {
      providers: ['Local'],
      types: ['chat'],
      inputModalities: ['image', 'text'],
      outputModalities: ['text'],
    },
    pageError: '',
    pageSuccess: '',
    ...overrides,
  });
}

describe('AI model cards management page', () => {
  test('renders immediate filters and row-level token editing', () => {
    const html = renderModelCards({ editingModel: null });

    expect(html).toContain('id="ai-model-filter-search"');
    expect(html).toContain('id="ai-model-filter-provider"');
    expect(html).toContain('id="ai-model-filter-local"');
    expect(html).toContain('data-model-provider="Local"');
    expect(html).toContain('action="/chat5/ai_model_cards/model-1/tokens"');
    expect(html).toContain('name="max_tokens" value="32768"');
    expect(html).toContain('name="max_out_tokens" value="8192"');
    expect(html).toContain('src="/js/ai_model_cards.js"');
  });

  test('renders a full prefilled edit form for the selected card', () => {
    const html = renderModelCards();

    expect(html).toContain('Edit Local Qwen');
    expect(html).toContain('action="/chat5/ai_model_cards/model-1"');
    expect(html).toContain('class="form-control" id="model_name" type="text" name="model_name" required value="Local Qwen"');
    expect(html).toContain('<option value="Local" selected>Local</option>');
    expect(html).toContain('<option value="image" selected>image</option>');
    expect(html).toContain('Update model');
    expect(html).toContain('data-model-edit-cancel>Cancel edit</a>');
  });
});
