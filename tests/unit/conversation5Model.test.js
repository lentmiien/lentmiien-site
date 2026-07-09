const mongoose = require('mongoose');

const Conversation5 = require('../../models/conversation5');

describe('Conversation5 model', () => {
  afterAll(async () => {
    await mongoose.disconnect();
  });

  test('defaults lastCleanupAt to the createdAt date for new conversations', async () => {
    const conversation = new Conversation5({
      title: 'NEW',
      category: 'Chat5',
      messages: [],
      members: ['test-user'],
    });

    await conversation.validate();

    expect(conversation.createdAt).toBeInstanceOf(Date);
    expect(conversation.lastCleanupAt).toBeInstanceOf(Date);
    expect(conversation.lastCleanupAt.getTime()).toBe(conversation.createdAt.getTime());
  });

  test('uses an explicit createdAt date when defaulting lastCleanupAt', async () => {
    const createdAt = new Date('2026-01-15T10:30:00.000Z');
    const conversation = new Conversation5({
      title: 'Imported',
      category: 'Chat5',
      messages: [],
      members: ['test-user'],
      createdAt,
    });

    await conversation.validate();

    expect(conversation.createdAt.getTime()).toBe(createdAt.getTime());
    expect(conversation.lastCleanupAt.getTime()).toBe(createdAt.getTime());
  });

  test('allows current chat5 reasoning efforts', async () => {
    for (const reasoning of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      const conversation = new Conversation5({
        title: `Reasoning ${reasoning}`,
        category: 'Chat5',
        messages: [],
        members: ['test-user'],
        metadata: { reasoning },
      });

      await expect(conversation.validate()).resolves.toBeUndefined();
    }
  });
});
