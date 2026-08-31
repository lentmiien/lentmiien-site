const Chat5Model = require('../../models/chat5');

function buildMessage(text) {
  return new Chat5Model({
    user_id: 'user-1',
    category: 'chat',
    tags: [],
    contentType: 'text',
    content: { text },
  });
}

describe('Chat5 embedding source state', () => {
  test('marks new text as pending in the same document validation', async () => {
    const message = buildMessage('Embed me');

    await message.validate();

    expect(message.embeddingStatus).toBe('pending');
  });

  test('marks blank text as disabled', async () => {
    const message = buildMessage('   ');

    await message.validate();

    expect(message.embeddingStatus).toBe('disabled');
    expect(message.embeddingContentHash).toBeNull();
  });

  test('keeps an explicitly excluded text placeholder out of the embedding queue', async () => {
    const message = buildMessage('Pending response');
    message.embeddingRequested = false;

    await message.validate();

    expect(message.embeddingRequested).toBe(false);
    expect(message.embeddingStatus).toBe('disabled');
    expect(message.embeddingContentHash).toBeNull();
  });

  test('marks a previously embedded message for deletion when embedding is disabled', async () => {
    const message = buildMessage('Stored text');
    message.$isNew = false;
    message.embeddingStatus = 'completed';
    message.embeddingContentHash = 'stored-hash';
    message.embeddingRequested = false;
    message.markModified('embeddingRequested');

    await message.validate();

    expect(message.embeddingStatus).toBe('delete_pending');
    expect(message.embeddingContentHash).toBeNull();
  });

  test('marks an edited completed message pending again', async () => {
    const message = buildMessage('Old text');
    message.$isNew = false;
    message.embeddingStatus = 'completed';
    message.embeddingContentHash = 'old-hash';
    message.content.text = 'New text';
    message.markModified('content.text');

    await message.validate();

    expect(message.embeddingStatus).toBe('pending');
    expect(message.embeddingContentHash).toBeNull();
  });
});
