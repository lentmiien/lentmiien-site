const { CodexTurnEventStore, eventPolicy } = require('../../services/codexTurnEventStore');

const routine = { eventType: 'item.completed', stream: 'stdout-json', payload: { item: { type: 'command_execution', exitCode: 0 } } };
const message = text => ({ eventType: 'item.completed', stream: 'stdout-json', payload: { item: { type: 'agent_message', text } } });
function harness(limit = 3) {
  const records = new Map();
  const write = jest.fn(async (seq, event, replaceSeq) => {
    if (replaceSeq) {
      if (!records.has(replaceSeq)) throw new Error('Missing slot');
      records.delete(replaceSeq);
    }
    records.set(seq, { ...event, seq });
  });
  return { records, write, store: new CodexTurnEventStore({ limit, write }) };
}

test('595 routine telemetry updates use two slots and leave all 2000 activity slots available', async () => {
  const { store, records } = harness(2000);
  for (let i = 0; i < 595; i += 1) {
    await store.store({ eventType: i % 2 ? 'thread.tokenUsage.updated' : 'account.rateLimits.updated', payload: { latest: i } });
  }
  expect(store.lastExecutionActivityAt).toBeNull();
  for (let i = 0; i < 2000; i += 1) await store.store(routine);
  expect(records.size).toBe(2002);
  expect(store.snapshot().eventStorage).toEqual({ limit: 2000, cappedAt: null, omittedCount: 0, coalescedCount: 593 });
  expect([...records.values()].filter(e => e.payload?.latest !== undefined).map(e => e.payload.latest)).toEqual([593, 594]);
});

test('cap keeps messages, failed commands, warnings and completion flowing with increasing cursors', async () => {
  const { store, records } = harness();
  await store.store(message('early update'));
  await store.store(routine);
  await store.store(routine);
  await store.store(routine);
  expect([...records.values()].filter(e => e.eventType === 'events.truncated')).toHaveLength(1);
  const cursor = store.nextSeq - 1;
  await store.store(message('late update'));
  expect([...records.values()].some(e => e.payload?.item?.text === 'early update')).toBe(true);
  const failedCommand = { ...routine, payload: { item: { type: 'command_execution', exit_code: 1 } } };
  await store.store(failedCommand);
  expect([...records.values()].filter(e => e.seq > cursor)).toHaveLength(2);
  await store.store({ eventType: 'turn.succeeded', stream: 'system' });
  expect(records.size).toBe(4);
  expect(store.count).toBe(4);
  expect(store.snapshot().eventStorage.omittedCount).toBe(4);
  expect([...records.values()].map(e => e.eventType)).toContain('turn.succeeded');
  expect([...records.values()].some(e => e.payload?.item?.text === 'late update')).toBe(true);
});

test('priority-only turns roll over indefinitely without stopping updates or increasing storage', async () => {
  const { store, records } = harness();
  for (let i = 0; i < 100; i += 1) await store.store(message(`update ${i}`));
  expect(records.size).toBe(4);
  expect([...records.values()].filter(e => e.payload?.item).map(e => e.payload.item.text)).toEqual(['update 97', 'update 98', 'update 99']);
  expect(store.nextSeq).toBe(102);
  expect(store.snapshot().eventStorage.omittedCount).toBe(97);
});

test('execution activity advances for omitted process events, independently of telemetry and user messages', async () => {
  jest.useFakeTimers();
  try {
    const { store } = harness(1);
    await store.store(routine);
    const previous = store.lastExecutionActivityAt;
    jest.advanceTimersByTime(15000);
    await store.store(routine);
    expect(store.lastExecutionActivityAt.getTime()).toBe(previous.getTime() + 15000);
    const latest = store.lastExecutionActivityAt;
    jest.advanceTimersByTime(15000);
    await store.store({ eventType: 'thread/tokenUsage/updated', stream: 'stdout-json' });
    await store.store({ ...message('user steering'), stream: 'system' });
    expect(store.lastExecutionActivityAt).toBe(latest);
  } finally { jest.useRealTimers(); }
});

test.each([
  { eventType: 'error' },
  { eventType: 'item.completed', severity: 'error' },
  { eventType: 'stderr.line', stream: 'stderr' },
  { payload: { item: { type: 'agentMessage', text: 'update' } } },
  { payload: { payload: { item: { type: 'user_message' } } } },
  { payload: { item: { status: 'failed' } } },
  { payload: { item: { error: 'failure' } } },
  { eventType: 'account.rateLimits.updated', severity: 'warning' },
])('preserves important event shape %j', event => {
  expect(eventPolicy(event)).toEqual({ important: true, telemetry: null });
});

test('failed replacement does not lose the slot or advance the cursor', async () => {
  const { store, write } = harness(1);
  await store.store(routine);
  await store.store(routine); // create cap notice
  const seq = store.nextSeq;
  write.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(store.store(message('retry'))).rejects.toThrow('Storage unavailable');
  expect(store.nextSeq).toBe(seq);
  await store.store(message('retry'));
  expect(write).toHaveBeenLastCalledWith(seq, message('retry'), 1);
});
