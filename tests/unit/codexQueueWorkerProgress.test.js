jest.mock('../../utils/logger', () => ({ error: jest.fn(), notice: jest.fn(), warning: jest.fn() }));
const { CodexQueueWorker } = require('../../services/codexQueueWorker');
const CodexTurn = require('../../models/codex_turn');
const CodexEvent = require('../../models/codex_event');
const CodexSession = require('../../models/codex_session');
const CodexWorkspaceLock = require('../../models/codex_workspace_lock');
const codexToolService = require('../../services/codexToolService');
const logger = require('../../utils/logger');
const query = value => ({ lean() { return this; }, exec: jest.fn().mockResolvedValue(value) });
const turn = { _id: 'turn-1', sessionId: 'session-1', workspaceId: 'workspace-1', modelProvider: 'openai', startedAt: new Date() };

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each(['succeeded', 'failed', 'timed_out', 'cancelled'])('worker publishes heartbeat and omitted execution activity, then persists %s after cap', async terminalStatus => {
  jest.useFakeTimers();
  const saved = {};
  jest.spyOn(CodexSession, 'findById').mockReturnValue(query({}));
  jest.spyOn(CodexTurn, 'updateOne').mockImplementation((_filter, update) => {
    Object.assign(saved, update.$set); return query({ matchedCount: 1 });
  });
  jest.spyOn(CodexTurn, 'findByIdAndUpdate').mockImplementation((_id, update) => {
    Object.assign(saved, update.$set); return query({ ...turn, ...saved });
  });
  jest.spyOn(CodexWorkspaceLock, 'updateOne').mockReturnValue(query({ matchedCount: 1 }));
  jest.spyOn(codexToolService, 'updateSessionAfterTurn').mockResolvedValue();
  let callbacks;
  let finish;
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const runner = { runTurn: jest.fn(args => { callbacks = args; ready(); return new Promise(resolve => { finish = resolve; }); }) };
  const worker = new CodexQueueWorker({ runner });
  worker.getConfig = () => ({ maxEventsPerTurn: 2, maxEventTextChars: 1000, heartbeatMs: 1000, lockTtlMs: 10000, additionalMessagePollMs: 1000 });
  worker.recordEvent = jest.fn().mockResolvedValue();
  worker.deliverPendingAdditionalMessages = jest.fn().mockResolvedValue(false);
  worker.failQueuedAdditionalMessages = jest.fn().mockResolvedValue();
  worker.failOutstandingAdditionalMessages = jest.fn().mockResolvedValue();
  worker.releaseLock = jest.fn().mockResolvedValue();
  worker.batchActivity = { finish: jest.fn().mockResolvedValue() };
  const running = worker.runClaimedTurn(turn, {}, {}, { _id: 'lock-1' });
  await started;
  expect(saved.workerHeartbeatAt).toBeInstanceOf(Date);
  const firstHeartbeat = saved.workerHeartbeatAt;
  for (let i = 0; i < 3; i += 1) await callbacks.onEvent({ eventType: 'item.completed', stream: 'stdout-json' });
  expect(saved.eventStorage.cappedAt).toBeInstanceOf(Date);
  await jest.advanceTimersByTimeAsync(1000);
  await callbacks.onEvent({ eventType: 'item.completed', stream: 'stdout-json' });
  await jest.advanceTimersByTimeAsync(1000);
  expect(saved.workerHeartbeatAt.getTime()).toBeGreaterThan(firstHeartbeat.getTime());
  expect(saved.lastExecutionActivityAt.getTime()).toBeGreaterThan(firstHeartbeat.getTime());
  expect(saved.eventStorage.omittedCount).toBe(2);
  expect(saved.eventCount).toBe(3);
  const healthyHeartbeat = saved.workerHeartbeatAt;
  CodexWorkspaceLock.updateOne.mockReturnValueOnce(query({ matchedCount: 0 }));
  await jest.advanceTimersByTimeAsync(1000);
  expect(saved.workerHeartbeatAt).toBe(healthyHeartbeat);
  expect(logger.warning).toHaveBeenCalledWith('Codex worker heartbeat could not be persisted', {
    category: 'codex_tool', metadata: { turnId: 'turn-1', errorName: 'Error' },
  });
  await jest.advanceTimersByTimeAsync(1000);
  expect(saved.workerHeartbeatAt.getTime()).toBeGreaterThan(healthyHeartbeat.getTime());
  await callbacks.onEvent({ eventType: 'item.completed', stream: 'stdout-json', payload: { item: { type: 'agent_message', text: 'Still making progress' } } });
  finish({ status: terminalStatus, finalResponse: 'Done', durationMs: 2000 });
  await running;
  expect(saved.status).toBe(terminalStatus);
  expect(saved.finalResponse).toBe('Done');
  expect(worker.recordEvent).toHaveBeenLastCalledWith(turn, expect.any(Number), expect.objectContaining({ eventType: `turn.${terminalStatus}` }), 2);
  expect(saved.eventStorage.omittedCount).toBe(4);
  expect(logger.warning).toHaveBeenCalledWith('Codex turn activity storage capped; priority updates continue', expect.any(Object));
  const lastHeartbeat = saved.workerHeartbeatAt;
  await jest.advanceTimersByTimeAsync(5000);
  expect(saved.workerHeartbeatAt).toBe(lastHeartbeat);
});

test('reused slots atomically replace bounded payload and timestamp using the turn and prior sequence', async () => {
  const worker = new CodexQueueWorker({ runner: {} });
  worker.getConfig = () => ({ maxEventTextChars: 1000 });
  jest.spyOn(CodexEvent.collection, 'updateOne').mockResolvedValue({ matchedCount: 1 });
  await worker.recordEvent(turn, 9000, { eventType: 'item.completed', text: 'x'.repeat(2000) }, 2);
  expect(CodexEvent.collection.updateOne).toHaveBeenCalledWith({ turnId: 'turn-1', seq: 2 }, {
    $set: expect.objectContaining({ seq: 9000, createdAt: expect.any(Date), text: expect.stringContaining('[output truncated]') }),
  }, expect.any(Object));
  expect(CodexEvent.collection.updateOne.mock.calls[0][1].$set.text.length).toBeLessThanOrEqual(1000);
});
