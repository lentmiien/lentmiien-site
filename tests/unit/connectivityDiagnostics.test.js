const express = require('express');
const { probeLocalHealth } = require('../../services/connectivityProbe');
const { probeDatabase } = require('../../services/connectivityDiagnostics');
const { getConnectivityConfig } = require('../../utils/connectivityConfig');
const { createDatabaseHealthHandler } = require('../../middleware/databaseReadiness');
const config = getConnectivityConfig({});

test('local probe calls fixed unauthenticated readiness route before app auth and performs no DB query', async () => {
  const app = express();
  const connection = { readyState: 1 };
  app.get('/apphealth', createDatabaseHealthHandler({ mongooseLib: { connection } }));
  app.use((_req, res) => res.sendStatus(401));
  let server;
  try {
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const success = await probeLocalHealth(port, config);
    expect(success).toMatchObject({ name: 'localHealth', outcome: 'ok', httpReachable: true,
      timings: { dnsMs: null, tlsMs: null } });
    connection.readyState = 0;
    expect(await probeLocalHealth(port, config)).toMatchObject({ outcome: 'http_status', statusCode: 503 });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test.each([null, 0, 65536, '8080', 'https://secret.example'])('invalid listener %s cannot trigger HTTP', async (port) => {
  const request = jest.fn();
  expect(await probeLocalHealth(port, config, { request })).toMatchObject({ outcome: 'unavailable', errorCode: 'NO_LISTENER' });
  expect(request).not.toHaveBeenCalled();
});

test('DB ping is a real bounded command and separately records duration and failures', async () => {
  let time = 0;
  const command = jest.fn(async () => { time = 15; return { ok: 1 }; });
  const connection = { readyState: 1, db: { command } };
  expect(await probeDatabase(config, { connection, now: () => time })).toMatchObject({ name: 'database', outcome: 'ok', latencyMs: 15 });
  expect(command).toHaveBeenCalledWith({ ping: 1, maxTimeMS: 2000 }, { timeoutMS: 2000, signal: expect.any(AbortSignal) });
  command.mockRejectedValueOnce(Object.assign(new Error('mongodb://private'), { name: 'MongoOperationTimeoutError' }));
  expect(await probeDatabase(config, { connection })).toMatchObject({ outcome: 'timeout', errorCode: 'DEADLINE_EXCEEDED', failurePhase: 'database' });
  command.mockRejectedValueOnce(new Error('mongodb://private'));
  const failure = await probeDatabase(config, { connection });
  expect(failure).toMatchObject({ outcome: 'connection_error', errorCode: 'OTHER' });
  expect(JSON.stringify(failure)).not.toContain('private');
  command.mockResolvedValueOnce({ ok: 0 });
  expect(await probeDatabase(config, { connection })).toMatchObject({ outcome: 'unexpected_response' });
});

test('DB deadline signals cancellation; unavailable DB never queues a command', async () => {
  jest.useFakeTimers();
  try {
    const command = jest.fn((_command, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const connection = { readyState: 1, db: { command } };
    const pending = probeDatabase(config, { connection });
    await jest.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ outcome: 'timeout' });
    expect(jest.getTimerCount()).toBe(0);
    connection.readyState = 0;
    expect(await probeDatabase(config, { connection })).toMatchObject({ outcome: 'unavailable', errorCode: 'DB_NOT_READY' });
    expect(command).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
