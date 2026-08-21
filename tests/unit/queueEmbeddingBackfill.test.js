const {
  backfillExactSources,
  formatResult,
  parseArgs,
} = require('../../scripts/queue-embedding-backfill');

function leanQuery(value) {
  return {
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    }),
  };
}

describe('queue embedding backfill CLI', () => {
  test('defaults to a targeted dry run and deduplicates exact source IDs', () => {
    expect(parseArgs([
      '--inbox-ids=inbox-1,inbox-1,inbox-2',
      '--chat-ids',
      'chat-1',
    ])).toEqual({
      chatIds: ['chat-1'],
      inboxIds: ['inbox-1', 'inbox-2'],
      dryRun: true,
      help: false,
    });
  });

  test('requires exact IDs and an explicit execute flag for writes', () => {
    expect(() => parseArgs([])).toThrow('Provide at least one exact source ID');
    expect(parseArgs(['--inbox-ids=inbox-1', '--execute']).dryRun).toBe(false);
  });

  test('formats counts without exposing source IDs', () => {
    const output = formatResult({
      requested: 3,
      found: 3,
      eligible: 3,
      queued: 3,
      missing: 0,
    }, false);

    expect(output).toContain('Queued: 3');
    expect(output).not.toContain('inbox-');
  });

  test('marks an exact inbox source pending before creating its queue intent', async () => {
    const message = {
      _id: 'inbox-1',
      text: 'Backfill this message',
      threadId: 'thread-1',
    };
    const MessageInboxEntry = {
      findById: jest.fn().mockReturnValue(leanQuery(message)),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const embeddingQueueService = {
      enqueue: jest.fn().mockResolvedValue({ status: 'pending' }),
    };

    const result = await backfillExactSources({
      chatIds: [],
      inboxIds: ['inbox-1'],
      dryRun: false,
    }, {
      database: { MessageInboxEntry },
      embeddingQueueService,
    });

    expect(result).toMatchObject({ found: 1, eligible: 1, queued: 1, missing: 0 });
    expect(MessageInboxEntry.updateOne).toHaveBeenCalledWith(
      { _id: 'inbox-1' },
      { $set: { embeddingRequested: true, embeddingStatus: 'pending' } },
    );
    expect(MessageInboxEntry.updateOne.mock.invocationCallOrder[0])
      .toBeLessThan(embeddingQueueService.enqueue.mock.invocationCallOrder[0]);
  });
});
