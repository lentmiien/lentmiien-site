const mockRetryTerminalPromptCleanup = jest.fn();

jest.mock('mongoose', () => ({
  connection: { readyState: 1 },
}));
jest.mock('../../services/messageService', () => jest.fn());
jest.mock('../../services/knowledgeService', () => jest.fn());
jest.mock('../../services/conversationService', () => jest.fn());
jest.mock('../../services/batchService', () => jest.fn().mockImplementation(() => ({
  retryTerminalPromptCleanup: mockRetryTerminalPromptCleanup,
  triggerBatchRequest: jest.fn(),
})));
jest.mock('../../database', () => ({
  Chat4Model: {},
  Conversation4Model: {},
  Chat4KnowledgeModel: {},
  FileMetaModel: {},
  BatchPromptModel: { countDocuments: jest.fn().mockResolvedValue(0) },
  BatchRequestModel: {},
}));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
}));
jest.mock('../../services/performanceMetricsService', () => ({
  trackTask: jest.fn((name, task) => task()),
}));

const scheduleDailyBatchTrigger = require('../../schedulers/batchTrigger');

describe('daily batch scheduler terminal cleanup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-31T00:00:00.000Z'));
    mockRetryTerminalPromptCleanup.mockReset();
    mockRetryTerminalPromptCleanup.mockResolvedValue({
      attempted: 0,
      cleaned: 0,
      deferred: 0,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('runs retained terminal prompt cleanup on the minute tick', async () => {
    scheduleDailyBatchTrigger();

    await jest.advanceTimersByTimeAsync(60 * 1000);

    expect(mockRetryTerminalPromptCleanup).toHaveBeenCalledTimes(1);
  });
});
