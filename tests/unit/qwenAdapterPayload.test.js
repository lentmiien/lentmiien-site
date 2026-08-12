const {
  buildGenerationPayload,
  buildTrainingPayload,
  normalizeCompareTargets,
  parseBoolean,
} = require('../../utils/qwenAdapterPayload');

describe('Qwen adapter request payloads', () => {
  test('normalizes QLoRA training fields and target modules', () => {
    expect(buildTrainingPayload({
      dataset_id: ' dataset-1 ',
      adapter_name: ' support-v1 ',
      overwrite_adapter: 'on',
      columns: { prompt: 'prompt', response: 'response', system: '' },
      params: {
        num_train_epochs: '1',
        gradient_accumulation_steps: '16',
        max_seq_length: '512',
        target_modules: 'q_proj, k_proj, ,v_proj',
        ignored: 'not-a-number',
      },
    })).toEqual({
      dataset_id: 'dataset-1',
      adapter_name: 'support-v1',
      overwrite_adapter: true,
      columns: { prompt: 'prompt', response: 'response' },
      params: {
        num_train_epochs: 1,
        gradient_accumulation_steps: 16,
        max_seq_length: 512,
        target_modules: ['q_proj', 'k_proj', 'v_proj'],
      },
    });
  });

  test('requires a dataset before training', () => {
    expect(() => buildTrainingPayload({})).toThrow('Choose a dataset');
  });

  test('builds thinking-mode generation requests when sampling is enabled', () => {
    expect(buildGenerationPayload({
      prompt: ' Think carefully. ',
      adapter_name: 'adapter-v1',
      max_new_tokens: '160',
      temperature: '0.7',
      do_sample: true,
      enable_thinking: true,
      response_format: '{"type":"json_object"}',
    }, { supportsThinking: true })).toEqual({
      prompt: 'Think carefully.',
      adapter_name: 'adapter-v1',
      max_new_tokens: 160,
      temperature: 0.7,
      do_sample: true,
      enable_thinking: true,
      response_format: { type: 'json_object' },
    });
  });

  test('rejects greedy thinking requests before sending them to the gateway', () => {
    expect(() => buildGenerationPayload({
      prompt: 'Think carefully.',
      do_sample: false,
      enable_thinking: true,
    }, { supportsThinking: true })).toThrow('Thinking mode requires sampling');
  });

  test('normalizes base and adapter comparison targets and enforces the cap', () => {
    expect(normalizeCompareTargets([
      { adapter_name: null, label: 'Base' },
      { adapter_name: ' adapter-v1 ' },
    ], 2)).toEqual([
      { adapter_name: null, label: 'Base' },
      { adapter_name: 'adapter-v1', label: 'adapter-v1' },
    ]);
    expect(() => normalizeCompareTargets([
      { adapter_name: null },
      { adapter_name: 'one' },
      { adapter_name: 'two' },
    ], 2)).toThrow('Compare up to 2 targets');
  });

  test('parses HTML form booleans consistently', () => {
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('off', true)).toBe(false);
    expect(parseBoolean(undefined, true)).toBe(true);
  });
});
