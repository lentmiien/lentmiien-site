jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const { CodexQueueWorker } = require('../../services/codexQueueWorker');
const CodexTurn = require('../../models/codex_turn');
const CodexSession = require('../../models/codex_session');
const CodexWorkspaceLock = require('../../models/codex_workspace_lock');
const codexToolService = require('../../services/codexToolService');
const logger = require('../../utils/logger');

describe('Codex queue worker GPU reservation lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  function createWorker(provider = 'ollama') {
    const reservation = {
      getStatus: jest.fn().mockReturnValue({ held: true, service: provider }),
      release: jest.fn().mockResolvedValue({ released: true }),
    };
    const worker = new CodexQueueWorker({ runner: {}, [`${provider}Reservation`]: reservation });
    return { reservation, worker };
  }

  test.each(['ollama', 'vllm'])('holds %s until its last turn completes', async (provider) => {
    const { worker, reservation } = createWorker(provider);
    const exists = jest.spyOn(CodexTurn, 'exists').mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({ _id: 'turn-2' }),
    }).mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });

    await expect(worker.releaseGpuReservationIfIdle(provider, { excludeTurnId: 'turn-1' })).resolves.toBe(false);
    expect(exists).toHaveBeenCalledWith({
      modelProvider: provider, status: { $in: ['queued', 'running'] }, _id: { $ne: 'turn-1' },
    });
    expect(reservation.release).not.toHaveBeenCalled();
    await expect(worker.releaseGpuReservationIfIdle(provider)).resolves.toBe(true);
    expect(reservation.release).toHaveBeenCalledTimes(1);
  });

  test('hands the GPU to vLLM only after the active Ollama turn finishes', async () => {
    const { worker, reservation } = createWorker();
    worker.activeTurns.set('running-turn', { modelProvider: 'ollama' });
    await expect(worker.canClaimGpuProvider('vllm')).resolves.toBe(false);
    expect(reservation.release).not.toHaveBeenCalled();

    worker.activeTurns.clear();
    jest.spyOn(CodexTurn, 'exists').mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(worker.canClaimGpuProvider('vllm')).resolves.toBe(true);
    expect(CodexTurn.exists).toHaveBeenCalledWith({ modelProvider: 'ollama', status: 'running' });
    expect(reservation.release).toHaveBeenCalledTimes(1);
  });

  test('does not duplicate the release notice for a coalesced caller', async () => {
    const { worker, reservation } = createWorker();
    jest.spyOn(CodexTurn, 'exists').mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    reservation.release.mockResolvedValue({ released: true, initiated: false });
    await expect(worker.releaseGpuReservationIfIdle('ollama')).resolves.toBe(true);
    expect(logger.notice).not.toHaveBeenCalled();
  });

  test.each([true, false])('runs the vLLM worker only with a confirmed reservation (granted=%s)', async granted => {
    const turn = { _id: 't', sessionId: 's', modelProvider: 'vllm' };
    const trace = [];
    const vllmReservation = {
      reserve: async () => {
        trace.push('reserve');
        if (!granted) throw new Error('Gateway unavailable');
        return { service: 'vllm', idleTimeoutSec: 1800 };
      },
      getStatus: () => ({ held: granted }),
      release: async () => { trace.push('release'); return { released: true }; },
    };
    const runner = { runTurn: async () => { trace.push('run'); return { status: 'succeeded' }; } };
    const worker = new CodexQueueWorker({ runner, vllmReservation });
    const query = value => ({ lean() { return this; }, exec: jest.fn().mockResolvedValue(value) });
    jest.spyOn(CodexSession, 'findById').mockReturnValue(query({}));
    jest.spyOn(CodexWorkspaceLock, 'updateOne').mockReturnValue(query({ matchedCount: 1 }));
    jest.spyOn(CodexTurn, 'exists').mockReturnValue(query(null));
    jest.spyOn(CodexTurn, 'updateOne').mockReturnValue(query({ matchedCount: 1 }));
    jest.spyOn(CodexTurn, 'findByIdAndUpdate').mockReturnValue(query({ ...turn }));
    jest.spyOn(codexToolService, 'updateSessionAfterTurn').mockResolvedValue();
    worker.batchActivity = { begin: jest.fn().mockResolvedValue(null), finish: jest.fn().mockResolvedValue() };
    worker.recordEvent = jest.fn().mockResolvedValue();
    worker.failOutstandingAdditionalMessages = jest.fn().mockResolvedValue();
    worker.failQueuedAdditionalMessages = jest.fn().mockResolvedValue();
    worker.releaseLock = jest.fn().mockResolvedValue();

    await worker.runClaimedTurn(turn, {}, {}, {});
    expect(trace).toEqual(granted ? ['reserve', 'run', 'release'] : ['reserve']);
    expect(CodexTurn.findByIdAndUpdate).toHaveBeenCalledWith('t', {
      $set: expect.objectContaining({ status: granted ? 'succeeded' : 'failed' }),
    }, expect.any(Object));
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
