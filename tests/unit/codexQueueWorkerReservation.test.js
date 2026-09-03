jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const { CodexQueueWorker } = require('../../services/codexQueueWorker');
const CodexTurn = require('../../models/codex_turn');
const codexToolService = require('../../services/codexToolService');
const logger = require('../../utils/logger');

describe('Codex queue worker Ollama reservation lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  function createWorker() {
    const ollamaReservation = {
      getStatus: jest.fn().mockReturnValue({
        held: true,
        service: 'ollama',
        idleTimeoutSec: 21600,
      }),
      release: jest.fn().mockResolvedValue({ released: true }),
      reserve: jest.fn().mockResolvedValue({
        active: true,
        service: 'ollama',
        idleTimeoutSec: 21600,
      }),
    };
    return {
      ollamaReservation,
      worker: new CodexQueueWorker({
        runner: {},
        ollamaReservation,
      }),
    };
  }

  test('keeps the reservation while another Ollama turn is pending', async () => {
    const { worker, ollamaReservation } = createWorker();
    worker.hasPendingOllamaTurns = jest.fn().mockResolvedValue(true);

    await expect(worker.releaseOllamaReservationIfIdle('turn-1')).resolves.toBe(false);

    expect(worker.hasPendingOllamaTurns).toHaveBeenCalledWith('turn-1');
    expect(ollamaReservation.release).not.toHaveBeenCalled();
  });

  test('releases the reservation after the Ollama queue drains', async () => {
    const { worker, ollamaReservation } = createWorker();
    worker.hasPendingOllamaTurns = jest.fn().mockResolvedValue(false);

    await expect(worker.releaseOllamaReservationIfIdle('turn-1')).resolves.toBe(true);

    expect(ollamaReservation.release).toHaveBeenCalledTimes(1);
  });

  test('does not duplicate the release notice for a coalesced caller', async () => {
    const { worker, ollamaReservation } = createWorker();
    worker.hasPendingOllamaTurns = jest.fn().mockResolvedValue(false);
    ollamaReservation.release.mockResolvedValue({ released: true, initiated: false });

    await expect(worker.releaseOllamaReservationIfIdle('turn-1')).resolves.toBe(true);

    expect(logger.notice).not.toHaveBeenCalledWith(
      'Released AI Gateway GPU after Codex Ollama queue drained',
      expect.anything(),
    );
  });

  test('does not claim new work while the database is unavailable', async () => {
    const { worker } = createWorker();
    worker.started = true;
    worker.databaseReady = () => false;
    worker.getConfig = jest.fn().mockReturnValue({ workerEnabled: true });

    await expect(worker.tick()).resolves.toBeUndefined();

    expect(worker.lastTickAt).toBeNull();
    expect(worker.getConfig).toHaveBeenCalledTimes(1);
  });

  test('blocks a Runpod turn if its pod stops before the worker claims it', async () => {
    const { worker } = createWorker();
    const queuedTurn = {
      _id: 'runpod-turn-1',
      workspaceId: 'workspace-1',
      modelProvider: 'runpod-qwen',
    };
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([queuedTurn]),
    };
    jest.spyOn(CodexTurn, 'find').mockReturnValue(query);
    jest.spyOn(codexToolService, 'assertModelProviderAvailable').mockRejectedValue(
      new Error('Qwen (Runpod) is unavailable because its Runpod pod is not running.')
    );
    worker.blockTurn = jest.fn().mockResolvedValue();

    await expect(worker.claimAndRunOne()).resolves.toBe(false);

    expect(codexToolService.assertModelProviderAvailable).toHaveBeenCalledWith('runpod-qwen');
    expect(worker.blockTurn).toHaveBeenCalledWith(
      queuedTurn,
      'Qwen (Runpod) is unavailable because its Runpod pod is not running.'
    );
    expect(logger.warning).toHaveBeenCalledWith(
      'Codex turn blocked because its model provider is unavailable',
      expect.objectContaining({
        category: 'codex_tool',
        metadata: expect.objectContaining({ modelProvider: 'runpod-qwen' }),
      })
    );
  });
});
