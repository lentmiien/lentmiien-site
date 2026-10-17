// Synthetic session transport for the retained v1/v2 media/result integration
// suites. Exact protocol behavior is covered separately by the pinned ASGI tests.
function fixture(now, readiness = () => ({ healthy: true, idle_proven: true })) {
  let sessions = new Map();
  const capability = () => ({ server_now: now().toISOString(), gateway_epoch: 'fixture_epoch', session_capability_version: 1,
    sessions: { same_coordinator_resume: true, resume_preserves_deadlines: true } });
  const annotate = body => ({ ...body, ...capability(), features: { ...body.features, exclusive_batch_sessions: true } });
  const error = (code, status = 409) => { throw Object.assign(new Error(code), { code, status, httpStatus: status, gatewayResponse: true }); };
  function request(method, path, body, headers = {}) {
    const [, , , id, action = 'acquire'] = path.split('/');
    let s = sessions.get(id);
    if (method === 'GET') { if (!s) return error('not_found', 404); if (+now() >= +new Date(s.hard_deadline)) s.state = 'released'; }
    else if (action === 'acquire') {
      const r = readiness();
      if (!r.healthy || !r.idle_proven || r.idle === false) return error('batch_session_acquisition_deferred', 503);
      if (!s) { s = { id, mode: body.mode, generation: 1, state: 'held', hard_deadline: body.not_after, lease_deadline: new Date(+now() + 120000).toISOString() }; sessions.set(id, s); }
    } else {
      if (!s) return error('not_found', 404);
      if (action === 'renew') s.lease_deadline = new Date(+now() + 120000).toISOString();
      if (action === 'recover') s.generation++;
      if (action === 'resume') s.state = 'held';
      if (action === 'close' || action === 'stop') s.state = 'released';
    }
    return { ...s, server_now: now().toISOString(), gateway_epoch: 'fixture_epoch', cleanup: 'verified', dispatch_allowed: s.state === 'held',
      hard_remaining_seconds: (+new Date(s.hard_deadline) - +now()) / 1000, lease_remaining_seconds: 120 };
  }
  return { annotate, request, reset: () => { sessions = new Map(); } };
}
function installHttp(app, now, readiness, runs = () => new Map()) {
  const session = fixture(now, readiness);
  app.use((req, res, next) => {
    if (req.path === '/batch/capabilities') { const json = res.json.bind(res); res.json = body => json(session.annotate(body)); }
    if (!req.path.startsWith('/batch/sessions/')) return next();
    try {
      const result = session.request(req.method, req.path, req.body, req.headers);
      if (req.method === 'POST' && req.path.endsWith('/stop')) {
        for (const run of runs().values()) if (run.session_id === result.id && !['drained', 'stopped', 'expired'].includes(run.status)) {
          run.status = 'stopped'; run.stop_mode = req.body.mode;
          for (const op of run.operations) if (op.status === 'queued') Object.assign(op, { status: 'deferred', termination_proven: true, cleanup: 'verified' });
        }
      }
      res.json(result);
    }
    catch (error) { res.status(error.status).json({ detail: { code: error.code } }); }
  });
  return session;
}
function installObject(gateway, now) {
  const session = fixture(now), caps = gateway.capabilities, request = gateway.request;
  const timed = body => Object.defineProperty(body, '_timing', { value: { received: gateway.monotonic(), rtt: 0 } });
  gateway.capabilities = async () => timed(session.annotate(await caps()));
  gateway.request = async (method, path, body, ...rest) => path.startsWith('/batch/sessions/') ? timed(session.request(method, path, body, rest.at(-1))) : request(method, path, body, ...rest);
  return session;
}
module.exports = { installHttp, installObject };
