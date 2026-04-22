const {
  extractPromptKeywords,
  buildPromptFilter,
  resolveRequestedSize,
  normalizeGenerationForm,
  buildStoredFileName,
} = require('../../services/gptImageService');

describe('gptImageService', () => {
  test('extractPromptKeywords normalizes and deduplicates prompt words', () => {
    expect(extractPromptKeywords('Orange scarf, orange CAT in 4K!')).toEqual([
      'orange',
      'scarf',
      'cat',
      'in',
      '4k',
    ]);
  });

  test('buildPromptFilter uses keyword matching when terms are present', () => {
    expect(buildPromptFilter('Orange scarf cat')).toEqual({
      keyword: 'Orange scarf cat',
      match: {
        promptKeywords: {
          $all: ['orange', 'scarf', 'cat'],
        },
      },
      terms: ['orange', 'scarf', 'cat'],
    });
  });

  test('buildPromptFilter falls back to a prompt regex when no keywords can be extracted', () => {
    expect(buildPromptFilter('!')).toEqual({
      keyword: '!',
      match: {
        prompt: {
          $regex: '!',
          $options: 'i',
        },
      },
      terms: [],
    });
  });

  test('resolveRequestedSize accepts valid custom GPT Image 2 sizes', () => {
    expect(resolveRequestedSize({
      sizeMode: 'custom',
      customWidth: '2048',
      customHeight: '1152',
    })).toEqual({
      ok: true,
      sizeMode: 'custom',
      sizePreset: '1024x1024',
      customWidth: 2048,
      customHeight: 1152,
      requestedSize: '2048x1152',
    });
  });

  test('resolveRequestedSize rejects custom sizes that violate GPT Image 2 rules', () => {
    expect(resolveRequestedSize({
      sizeMode: 'custom',
      customWidth: '2050',
      customHeight: '1152',
    })).toEqual({
      ok: false,
      sizeMode: 'custom',
      sizePreset: '1024x1024',
      customWidth: 2050,
      customHeight: 1152,
      message: 'Custom sizes must use width and height values divisible by 16.',
    });
  });

  test('normalizeGenerationForm returns OpenAI-ready defaults for png output', () => {
    expect(normalizeGenerationForm({
      prompt: 'A marmot reading a map',
    })).toEqual({
      ok: true,
      formValues: {
        prompt: 'A marmot reading a map',
        n: 1,
        quality: 'medium',
        sizeMode: 'preset',
        sizePreset: '1024x1024',
        customWidth: 1024,
        customHeight: 1024,
        background: 'auto',
        outputFormat: 'png',
        outputCompression: 100,
        moderation: 'auto',
      },
      requestOptions: {
        prompt: 'A marmot reading a map',
        n: 1,
        quality: 'medium',
        requestedSize: '1024x1024',
        background: 'auto',
        outputFormat: 'png',
        outputCompression: null,
        moderation: 'auto',
      },
    });
  });

  test('buildStoredFileName keeps the expected extension and adds a sanitized prefix', () => {
    const fileName = buildStoredFileName('GPT Image2 Output', 'Blue fox portrait', '.webp');
    expect(fileName.startsWith('gpt-image2-output-blue-fox-portrait-')).toBe(true);
    expect(fileName.endsWith('.webp')).toBe(true);
  });
});
