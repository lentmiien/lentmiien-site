const {
  extractPromptKeywords,
  buildPromptFilter,
  resolveRequestedSize,
  normalizeGenerationForm,
  normalizeToolImageArguments,
  buildToolImageRequest,
  buildStoredFileName,
  extractUnknownParameterName,
  executeWithUnknownParameterRetry,
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

  test('normalizeToolImageArguments converts tool-call options to the image form shape', () => {
    expect(normalizeToolImageArguments({
      prompt: 'A small robot chef',
      n: 2,
      size: '2048x1152',
      output_format: 'webp',
      output_compression: 82,
    })).toEqual({
      prompt: 'A small robot chef',
      n: 2,
      quality: undefined,
      background: undefined,
      outputFormat: 'webp',
      outputCompression: 82,
      moderation: undefined,
      sizeMode: 'preset',
      sizePreset: '2048x1152',
    });
  });

  test('buildToolImageRequest normalizes selected gallery image ids', () => {
    expect(buildToolImageRequest({
      prompt: 'A reference edit',
      selected_image_ids: ['abc', 'abc', 'def'],
    })).toMatchObject({
      selectedImageIds: ['abc', 'def'],
      rawOptions: {
        prompt: 'A reference edit',
      },
    });
  });

  test('buildStoredFileName keeps the expected extension and adds a sanitized prefix', () => {
    const fileName = buildStoredFileName('GPT Image2 Output', 'Blue fox portrait', '.webp');
    expect(fileName.startsWith('gpt-image2-output-blue-fox-portrait-')).toBe(true);
    expect(fileName.endsWith('.webp')).toBe(true);
  });

  test('extractUnknownParameterName parses OpenAI unknown-parameter errors', () => {
    expect(extractUnknownParameterName(new Error("400 Unknown parameter: 'quality'."))).toBe('quality');
    expect(extractUnknownParameterName(new Error('Something else failed'))).toBe(null);
  });

  test('executeWithUnknownParameterRetry retries after removing unsupported optional edit parameters', async () => {
    const executor = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error("400 Unknown parameter: 'quality'."), { status: 400 }))
      .mockRejectedValueOnce(Object.assign(new Error("400 Unknown parameter: 'background'."), { status: 400 }))
      .mockResolvedValueOnce({ ok: true });

    const result = await executeWithUnknownParameterRetry({
      model: 'gpt-image-2',
      prompt: 'Edit this image',
      quality: 'medium',
      background: 'auto',
      size: '1024x1024',
    }, executor);

    expect(executor).toHaveBeenNthCalledWith(1, {
      model: 'gpt-image-2',
      prompt: 'Edit this image',
      quality: 'medium',
      background: 'auto',
      size: '1024x1024',
    });
    expect(executor).toHaveBeenNthCalledWith(2, {
      model: 'gpt-image-2',
      prompt: 'Edit this image',
      background: 'auto',
      size: '1024x1024',
    });
    expect(executor).toHaveBeenNthCalledWith(3, {
      model: 'gpt-image-2',
      prompt: 'Edit this image',
      size: '1024x1024',
    });
    expect(result).toEqual({
      response: { ok: true },
      request: {
        model: 'gpt-image-2',
        prompt: 'Edit this image',
        size: '1024x1024',
      },
      removedParameters: ['quality', 'background'],
    });
  });

  test('executeWithUnknownParameterRetry rethrows non-retryable errors', async () => {
    const executor = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error("400 Unknown parameter: 'prompt'."), { status: 400 }));

    await expect(executeWithUnknownParameterRetry({
      model: 'gpt-image-2',
      prompt: 'Edit this image',
    }, executor)).rejects.toThrow("400 Unknown parameter: 'prompt'.");
  });
});
