const {
  normalizeGroupId,
  normalizeIdArray,
  buildTrainingSelectionKey,
  joinPromptTexts,
  buildTrainingCsv,
} = require('../../utils/trainingDataExport');

describe('training data export helpers', () => {
  test('normalizes group ids for stable dataset names', () => {
    expect(normalizeGroupId(' Support Tone v1! ')).toBe('support-tone-v1');
    expect(normalizeGroupId('Qwen_3.LoRA')).toBe('qwen_3.lora');
  });

  test('deduplicates message ids while preserving first occurrence order', () => {
    expect(normalizeIdArray(['a', 'b', 'a', '', null, 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('builds a stable selection key from conversation and selected messages', () => {
    expect(buildTrainingSelectionKey({
      conversationId: 'conv1',
      promptMessageIds: ['m1', 'm2'],
      outputMessageId: 'm3',
    })).toBe('conv1|m1,m2|m3');
  });

  test('joins prompt message content in selected order', () => {
    const messages = [
      { content: { text: 'First prompt' } },
      { content: { text: 'Second prompt' } },
    ];
    expect(joinPromptTexts(messages)).toBe('First prompt\n\nSecond prompt');
  });

  test('exports system prompt and training pair as qwen-compatible CSV', () => {
    const csv = buildTrainingCsv([{
      system: 'System prompt',
      prompt: 'Prompt with, comma',
      response: 'Target "answer"\nline two',
    }]);

    expect(csv).toBe('system,prompt,response\nSystem prompt,"Prompt with, comma","Target ""answer""\nline two"\n');
  });
});
