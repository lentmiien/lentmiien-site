jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const { CodexQueueWorker } = require('../../services/codexQueueWorker');
const logger = require('../../utils/logger');

describe('Codex queue worker Ollama reservation lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
