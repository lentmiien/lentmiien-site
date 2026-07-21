const { applyOverrides } = require('../../public/js/chat5_quick_settings');

function createInput(value = '') {
  return {
    value,
    dispatchEvent: jest.fn(),
    addEventListener: jest.fn(),
  };
}

function createSelect(values, selectedValues = []) {
  const selected = new Set(selectedValues);
  return {
    value: selectedValues[0] || '',
    options: values.map((value) => ({ value, selected: selected.has(value) })),
    dispatchEvent: jest.fn(),
    addEventListener: jest.fn(),
  };
}

function createDocument(elements) {
  const doc = {
    getElementById: jest.fn((id) => elements[id] || null),
    createElement: jest.fn(() => ({ value: '', textContent: '', dataset: {}, selected: false })),
  };
  Object.values(elements).forEach((element) => {
    element.ownerDocument = doc;
    if (element.options) {
      element.appendChild = (option) => element.options.push(option);
    }
  });
  return doc;
}

describe('Chat5 quick setting client application', () => {
  test('applies specified values, clears explicit empty selections, and preserves ignored fields', () => {
    const elements = {
      category: createInput('Existing category'),
      tags: createInput('old-tag'),
      context: createInput('Existing context'),
      tools: createSelect(['web_search_preview', 'custom_tool'], ['custom_tool']),
      model: createSelect(['gpt-fast', 'gpt-deep'], ['gpt-fast']),
      maxMessages: createInput('999'),
      reasoning: createSelect(['low', 'high', 'max'], ['low']),
      mode: createSelect(['standard', 'pro'], ['standard']),
      verbosity: createSelect(['low', 'medium', 'high'], ['medium']),
      members: createInput('Alice'),
      quickCategory: createInput('Existing category'),
      quickTags: createInput('old-tag'),
    };
    const doc = createDocument(elements);

    const applied = applyOverrides({
      tags: ['new-tag', 'research'],
      context: '',
      tools: [],
      model: 'gpt-deep',
      maxMessages: 25,
      reasoning: 'max',
      mode: 'pro',
      verbosity: 'high',
      members: ['Bob'],
    }, { document: doc, currentUser: 'Alice' });

    expect(elements.category.value).toBe('Existing category');
    expect(elements.tags.value).toBe('new-tag, research');
    expect(elements.quickTags.value).toBe('new-tag, research');
    expect(elements.context.value).toBe('');
    expect(elements.tools.options.every((option) => option.selected === false)).toBe(true);
    expect(elements.model.value).toBe('gpt-deep');
    expect(elements.maxMessages.value).toBe('25');
    expect(elements.reasoning.value).toBe('max');
    expect(elements.mode.value).toBe('pro');
    expect(elements.verbosity.value).toBe('high');
    expect(elements.members.value).toBe('Bob, Alice');
    expect(applied).not.toContain('category');
    expect(applied).toEqual(expect.arrayContaining([
      'tags',
      'context',
      'tools',
      'model',
      'max messages',
      'reasoning effort',
      'reasoning mode',
      'verbosity',
      'members',
    ]));
  });

  test('adds saved model and tool values that are not currently present in the controls', () => {
    const elements = {
      tools: createSelect([], []),
      model: createSelect([], []),
    };
    const doc = createDocument(elements);

    applyOverrides({
      tools: ['retired_tool'],
      model: 'retired-model',
    }, { document: doc, currentUser: 'Alice' });

    expect(elements.tools.options).toEqual([
      expect.objectContaining({ value: 'retired_tool', selected: true }),
    ]);
    expect(elements.model.options).toEqual([
      expect.objectContaining({ value: 'retired-model' }),
    ]);
    expect(elements.model.value).toBe('retired-model');
  });
});
