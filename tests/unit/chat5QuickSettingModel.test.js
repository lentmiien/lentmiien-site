const mongoose = require('mongoose');

const Chat5QuickSetting = require('../../models/chat5_quick_setting');

describe('Chat5QuickSetting model', () => {
  afterAll(async () => {
    await mongoose.disconnect();
  });

  test('keeps ignored overrides absent and explicit empty arrays present', async () => {
    const setting = new Chat5QuickSetting({
      user: 'test-user',
      name: 'Clear optional values',
      overrides: {
        tags: [],
        tools: [],
        members: [],
      },
    });

    await setting.validate();
    const plain = setting.toObject();

    expect(plain.overrides).toEqual({
      tags: [],
      tools: [],
      members: [],
    });
    expect(plain.overrides).not.toHaveProperty('category');
    expect(plain.overrides).not.toHaveProperty('model');
  });

  test('accepts all current reasoning, mode, and verbosity values', async () => {
    const settings = [
      ...['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((reasoning) => ({ reasoning })),
      ...['standard', 'pro'].map((mode) => ({ mode })),
      ...['low', 'medium', 'high'].map((verbosity) => ({ verbosity })),
    ];

    for (const overrides of settings) {
      const setting = new Chat5QuickSetting({
        user: 'test-user',
        name: JSON.stringify(overrides),
        overrides,
      });
      await expect(setting.validate()).resolves.toBeUndefined();
    }
  });

  test('rejects invalid enumerated values and non-positive max messages', async () => {
    const setting = new Chat5QuickSetting({
      user: 'test-user',
      name: 'Invalid',
      overrides: {
        reasoning: 'extreme',
        mode: 'turbo',
        verbosity: 'huge',
        maxMessages: 0,
      },
    });

    await expect(setting.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });
});
