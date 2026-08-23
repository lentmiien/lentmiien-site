const { seedMissingToolManagerEntries } = require('../../services/toolManagerStartupService');

describe('Tool Manager startup seeding', () => {
  test('logs newly inserted defaults', async () => {
    const summary = {
      matchedCount: 7,
      upsertedCount: 3,
      names: ['one', 'two', 'three'],
    };
    const toolManagerService = {
      seedMissingDefaultTools: jest.fn().mockResolvedValue(summary),
    };
    const log = {
      notice: jest.fn().mockResolvedValue(),
      error: jest.fn().mockResolvedValue(),
    };

    await expect(seedMissingToolManagerEntries({ toolManagerService, log })).resolves.toBe(summary);
    expect(toolManagerService.seedMissingDefaultTools).toHaveBeenCalledWith({ actor: 'startup' });
    expect(log.notice).toHaveBeenCalledWith(
      'Seeded missing Tool Manager entries at startup',
      expect.objectContaining({ category: 'tool_manager' })
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  test('reports startup seed failures without causing an unhandled rejection', async () => {
    const toolManagerService = {
      seedMissingDefaultTools: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const log = {
      notice: jest.fn().mockResolvedValue(),
      error: jest.fn().mockResolvedValue(),
    };

    await expect(seedMissingToolManagerEntries({ toolManagerService, log })).resolves.toMatchObject({
      upsertedCount: 0,
      error: 'database unavailable',
    });
    expect(log.error).toHaveBeenCalledWith(
      'Failed to seed missing Tool Manager entries at startup',
      {
        category: 'tool_manager',
        metadata: { error: 'database unavailable' },
      }
    );
  });
});
