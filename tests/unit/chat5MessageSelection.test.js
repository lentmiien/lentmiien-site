const {
  getConfiguredStartMessageId,
  sliceMessagesFromConfiguredStart,
} = require('../../utils/chat5MessageSelection');

const message = (id) => ({ _id: { toString: () => id } });

describe('chat5 message start selection', () => {
  test('keeps the full history when no start message is configured', () => {
    const messages = [message('message-1'), message('message-2')];

    expect(sliceMessagesFromConfiguredStart(messages, { metadata: {} })).toBe(messages);
    expect(sliceMessagesFromConfiguredStart(messages, {})).toBe(messages);
  });

  test('starts inclusively at the configured message', () => {
    const messages = [message('message-1'), message('message-2'), message('message-3')];

    expect(sliceMessagesFromConfiguredStart(messages, {
      metadata: { startMessageId: 'message-2' },
    })).toEqual([messages[1], messages[2]]);
  });

  test('keeps the full history when the configured ID is not present', () => {
    const messages = [message('message-1'), message('message-2')];

    expect(sliceMessagesFromConfiguredStart(messages, {
      metadata: { startMessageId: 'missing-message' },
    })).toBe(messages);
  });

  test('normalizes a manually entered start message ID', () => {
    expect(getConfiguredStartMessageId({
      metadata: { startMessageId: '  message-2  ' },
    })).toBe('message-2');
  });
});
