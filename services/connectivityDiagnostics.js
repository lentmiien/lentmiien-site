const mongoose = require('mongoose');
const { performance } = require('perf_hooks');
const { probeLocalHealth, safeErrorCode } = require('./connectivityProbe');

async function probeDatabase(config, { connection = mongoose.connection, now = () => performance.now() } = {}) {
  const started = now();
  const timeoutMs = Math.min(config.timeoutMs, 2000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let outcome = 'ok';
  let errorCode = null;
  try {
    if (connection.readyState !== 1 || !connection.db) {
      outcome = 'unavailable';
      errorCode = 'DB_NOT_READY';
    } else {
      // Driver CSOT includes server selection/pool checkout; signal cancels outstanding work.
      const result = await connection.db.command({ ping: 1, maxTimeMS: timeoutMs }, {
        timeoutMS: timeoutMs, signal: controller.signal,
      });
      if (result?.ok !== 1) { outcome = 'unexpected_response'; errorCode = 'DB_PING_FAILED'; }
    }
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === 'MongoOperationTimeoutError' || error?.code === 50;
    outcome = timedOut ? 'timeout' : 'connection_error';
    errorCode = timedOut ? 'DEADLINE_EXCEEDED' : safeErrorCode(error);
  } finally { clearTimeout(timer); }
  const latencyMs = Math.max(0, Math.round((now() - started) * 100) / 100);
  return { name: 'database', outcome, errorCode, latencyMs, timings: { totalMs: latencyMs },
    failurePhase: outcome === 'ok' ? null : 'database',
    slow: latencyMs >= config.slowMs, degraded: outcome !== 'ok' || latencyMs >= config.slowMs };
}

function runDiagnostics(config, port) {
  return Promise.all([probeLocalHealth(port, config), probeDatabase(config)]);
}

module.exports = { probeDatabase, runDiagnostics };
