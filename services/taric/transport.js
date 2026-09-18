const https = require('https');
const tls = require('tls');
const http = require('http');
const zlib = require('zlib');
const { Transform, Writable, pipeline } = require('stream');
const { TaricError, fail, gcode, object } = require('../../utils/taricContracts');
const { strictJson, payload, output, hash } = require('../../utils/taricProtocol');
const diagnostics = require('../../utils/taricDiagnostics');
const logger = require('../../utils/logger');
// Private bounded pools; active work uses its own absolute deadline. Idle sockets
// keep a short eviction timeout without imposing it on the next request.
const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 4, maxTotalSockets: 8, maxFreeSockets: 2, timeout: 5000 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 4, maxTotalSockets: 8, maxFreeSockets: 2, timeout: 5000 }),
};
const socketIds = new WeakMap();
let nextSocketId = 0;
let runtimeReported = false;
const { normalizeDetail } = require('../amiamiScraperService');

function boundedJson(url, { method = 'GET', body, headers = {}, deadlineMs = 15000, maxBytes = 262144,
  maxWireBytes = maxBytes, signal, correlationId, onDiagnostic, onEvent, diagnosticContext = {}, successStatuses = [200], tlsOptions = {},
  request = url.protocol === 'https:' ? https.request : http.request } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false; let req; let response; let decoder; let timer; let socket;
    let socketTimeoutObserved = false; let requestTimeoutObserved = false; let requestFinished = false;
    let socketTimeoutStartMs; let abortOrigin; let safeAbortReason; let outboundBytes = 0;
    const socketListeners = [];
    const listen = (event, fn) => { socket.once(event, fn); socketListeners.push([event, fn]); };
    const diagnostic = where => diagnostics.errorStatus({
      ...diagnosticContext,
      phase: where, dispatched, terminal, status: response?.statusCode, wireBytes: wireSize, decodedBytes: size,
      durationMs: Date.now() - started, deadlineMs, correlationId, reusedSocket: req?.reusedSocket === true,
      socketId: socket && socketIds.get(socket), socketTimeoutMs: socket?.timeout, socketTimeoutStartMs,
      requestTimeoutMs: deadlineMs, socketTimeoutObserved, requestTimeoutObserved, requestFinished, outboundBytes,
      abortOrigin, abortTag: abortOrigin ? 'LOCAL_ABORT' : undefined, abortReason: safeAbortReason,
    });
    const emit = (event, value = diagnostic(phase)) => onEvent?.(event, value);
    let dispatched = false; let terminal = false; let wireSize = 0; let size = 0; let phase = 'connect';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      for (const [event, fn] of socketListeners) socket.removeListener(event, fn);
      req?.removeListener('timeout', requestTimeout);
      const valueDiagnostic = error?.transport || diagnostic('http');
      onDiagnostic?.(valueDiagnostic);
      emit(error ? 'failed' : 'complete', valueDiagnostic);
      if (error) { response?.destroy(); decoder?.destroy(); req?.destroy(); reject(error); } else resolve(value);
    };
    const rejectSafe = (where, cause) => {
      if (settled) return;
      const error = new TaricError('PROVIDER_FAILED');
      error.transport = require('../../utils/taricDiagnostics').errorStatus({ ...diagnostic(where), socketCode: cause?.code });
      finish(error);
    };
    const abort = () => {
      safeAbortReason = diagnostics.abortReason(signal?.reason);
      abortOrigin = ['warm_deadline', 'worker_stop', 'lease_lost'].includes(safeAbortReason) ? safeAbortReason : 'caller_signal';
      rejectSafe(abortOrigin === 'warm_deadline' ? 'timeout' : 'clientabort');
    };
    const requestTimeout = () => {
      if (settled || req.socket !== socket) return;
      requestTimeoutObserved = true; emit('request_timeout');
    };
    if (signal?.aborted) return abort();
    let serialized;
    try { serialized = body === undefined ? null : JSON.stringify(body); }
    catch (cause) { return rejectSafe('json', cause); }
    outboundBytes = serialized ? Buffer.byteLength(serialized) : 0;
    signal?.addEventListener('abort', abort, { once: true });
    if (serialized && Buffer.byteLength(serialized) > 16384) return rejectSafe('limit');
    timer = setTimeout(() => { abortOrigin = 'absolute_deadline'; rejectSafe('timeout'); }, deadlineMs);
    emit('start');
    try {
      req = request(url, { agent: agents[url.protocol], ...tlsOptions, timeout: deadlineMs, method, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity',
        ...(serialized ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) } : {}), ...headers } }, res => {
        response = res; phase = 'http';
        if (settled) { res.destroy(); return; }
        // A received HTTP status is a confirmed response, not a lost generation reply.
        terminal = res.statusCode !== 200;
        emit('response_headers');
        if (!successStatuses.includes(res.statusCode)) return rejectSafe('http');
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] || '')) return rejectSafe('envelope');
        const encoding = (res.headers['content-encoding'] || 'identity').trim().toLowerCase();
        if (!['identity', 'gzip', 'deflate', 'br'].includes(encoding)) return rejectSafe('decode');
        if (res.headers['content-length'] && (!/^\d+$/.test(res.headers['content-length']) || Number(res.headers['content-length']) > maxWireBytes)) return rejectSafe('limit');
        const chunks = [];
        const wireLimit = new Transform({ transform(chunk, _encoding, next) {
          wireSize += chunk.length;
          if (wireSize > maxWireBytes) { phase = 'limit'; return next(new Error('Limit')); }
          next(null, chunk);
        } });
        decoder = encoding === 'gzip' ? zlib.createGunzip() : encoding === 'deflate' ? zlib.createInflate()
          : encoding === 'br' ? zlib.createBrotliDecompress() : new Transform({ transform(chunk, _encoding, next) { next(null, chunk); } });
        phase = 'decode';
        const sink = new Writable({ write(chunk, _encoding, next) {
          size += chunk.length;
          if (size > maxBytes) { phase = 'limit'; return next(new Error('Limit')); }
          chunks.push(chunk); next();
        } });
        pipeline(res, wireLimit, decoder, sink, error => {
          if (settled) return;
          if (error) {
            // A truncated response may have lost the remote completion; malformed
            // fully received invalid JSON is terminal; early stream failures stay uncertain.
            if (!res.complete && error.code === 'ERR_STREAM_PREMATURE_CLOSE') terminal = false;
            return rejectSafe(phase, error);
          }
          terminal = true;
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
          catch (error) { return rejectSafe('decode', error); }
          try { finish(null, strictJson(text, 'PROVIDER_FAILED')); }
          catch (error) { rejectSafe('json', error); }
        });
      });
      // Align active inactivity observation with this request, not the pool's idle
      // timeout. Only the absolute timer destroys work; it also bounds DNS/body.
      req.setTimeout?.(deadlineMs);
      req.once('timeout', requestTimeout);
      req.on('socket', assigned => {
        if (settled) return;
        socket = assigned;
        socketTimeoutStartMs = socket.timeout;
        if (!socketIds.has(socket)) socketIds.set(socket, ++nextSocketId);
        listen('timeout', () => { if (!settled && req.socket === socket) { socketTimeoutObserved = true; emit('socket_timeout'); } });
        emit('socket_assigned');
        const connected = () => { dispatched = true; phase = 'http'; };
        if (socket.connecting) {
          listen('lookup', error => { phase = error ? 'dns' : 'connect'; });
          listen(url.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
          if (url.protocol === 'https:') listen('connect', () => { phase = 'tls'; });
        } else if (!socket.encrypted || socket.authorized) connected();
      });
      req.on('finish', () => { if (!settled) { dispatched = true; requestFinished = true; emit('outbound_finished'); } });
      req.on('error', cause => {
        const where = ['ENOTFOUND', 'EAI_AGAIN'].includes(cause.code) ? 'dns'
          : /TLS|CERT|VERIFY/.test(cause.code || '') ? 'tls' : phase;
        rejectSafe(where, cause);
      });
      req.end(serialized || undefined);
    } catch (cause) { rejectSafe(phase, cause); }
  });
}
function createTransport({ json = boundedJson, env = process.env, impersonated = require('./amiamiBounded').fetchImpersonated } = {}) {
  if (!runtimeReported) {
    runtimeReported = true;
    const className = agent => /^[A-Za-z0-9_$]{1,80}$/.test(agent?.constructor?.name || '') ? agent.constructor.name : 'unknown';
    // Fixed package labels only; never log module paths, preload flags or env values.
    const importedApm = ['dd-trace', 'newrelic', 'elastic-apm-node', '@opentelemetry'].filter(name =>
      Object.keys(require.cache).some(file => file.replaceAll('\\', '/').includes(`/node_modules/${name}/`)));
    logger.notice('TARIC transport runtime', { category: 'taric', metadata: {
      nodeVersion: process.version, agentSource: 'taric_private_pool', httpAgentConstructor: className(agents['http:']),
      httpsAgentConstructor: className(agents['https:']), globalHttpAgentConstructor: className(http.globalAgent),
      globalHttpsAgentConstructor: className(https.globalAgent), importedApm,
      timeoutSource: 'per_request_deadline', generationDeadlineMs: 60000, idleAgentTimeoutMs: 5000,
      proxyPolicy: 'explicit_private_agent_no_env_proxy_configuration',
    } });
  }
  // Gateway configuration is immutable for this client, including owned cleanup.
  env = { ...env };
  function gatewayOrigin() {
    let origin;
    try { origin = new URL(env.TARIC_GATEWAY_ORIGIN); } catch (_) { fail('CONFIG_NOT_READY'); }
    const allowed = (env.TARIC_GATEWAY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash || !allowed.includes(origin.origin)) fail('CONFIG_NOT_READY');
    return origin;
  }
  const gateway = (path, options = {}) => {
    const url = new URL(path, gatewayOrigin());
    return json(url, { deadlineMs: 5000, ...options, headers: { ...options.headers,
      ...(env.TARIC_GATEWAY_TOKEN ? { Authorization: `Bearer ${env.TARIC_GATEWAY_TOKEN}` } : {}),
      ...(env.TARIC_GATEWAY_ADMIN_TOKEN ? { 'X-Admin-Token': env.TARIC_GATEWAY_ADMIN_TOKEN } : {}),
    }, ...(path === '/qwen3-lora/generate' ? { onEvent: (event, transport) => {
      const log = event === 'failed' ? 'warning' : 'notice';
      logger[log]('TARIC provider generation transport', { category: 'taric', metadata: {
        stage: 'provider.generate', event, transport: diagnostics.errorStatus(transport),
      } });
    } } : {}) });
  };
  const sessionAdapter = require('./gatewaySessions').createGatewaySessions(gateway, {
    capabilities: require('./gatewayCapabilities').createGatewayCapabilities(gateway, { fingerprint: () => hash({
      origin: env.TARIC_GATEWAY_ORIGIN, allowlist: env.TARIC_GATEWAY_ALLOWED_ORIGINS,
      proxy: env.TARIC_GATEWAY_TOKEN, admin: env.TARIC_GATEWAY_ADMIN_TOKEN,
    }) }),
  });
  async function adapters() {
    // The current Gateway /adapters route falls back to a GPU-acquiring upstream
    // call if its mount is absent. Do not call it as read-only UI metadata.
    fail('METADATA_UNAVAILABLE');
  }
  async function verifyIdentity() {
    // /model is unowned and conflicts with a held session; current metadata also
    // lacks immutable revisions. No caller-supplied attestation can repair that.
    fail('RELEASE_CLOSED');
  }
  async function generate(row, adapter, codes, maxTokens, identity, options = {}) {
    const body = payload(row, adapter, maxTokens);
    if (identity) await verifyIdentity(adapter, identity);
    let envelope;
    try { envelope = await gateway('/qwen3-lora/generate', { method: 'POST', body, deadlineMs: 60000, maxBytes: 16384, signal: options.signal, correlationId: options.correlationId }); }
    catch (cause) {
      const status = require('../../utils/taricDiagnostics').errorStatus(cause.transport);
      const error = new TaricError(status && (!status.dispatched || status.terminal) ? 'PROVIDER_FAILED' : 'INFERENCE_UNCERTAIN');
      error.transport = status;
      throw error;
    }
    if (!require('../../utils/taricProtocol').validEnvelope(envelope, adapter)) {
      try { output({ content: envelope?.content, tool_calls: ['invalid envelope'] }, codes, options.onDiagnostics); }
      catch (error) { error.transport = { phase: 'envelope', dispatched: true, terminal: true }; throw error; }
    }
    const result = output(envelope, codes, options.onDiagnostics);
    if (identity) await verifyIdentity(adapter, identity);
    return result;
  }
  async function fetchFactual(code) {
    gcode(code);
    const url = new URL('https://api.amiami.com/api/v1.0/item');
    url.searchParams.set('gcode', code); url.searchParams.set('lang', 'eng');
    let data;
    try {
      // Per-request trust only for this fixed origin. Never relax hostname/chain checks
      // or mutate Node's global CA set (especially the private Gateway transport).
      const ca = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
      const mode = env.TARIC_AMIAMI_TRANSPORT || 'curl';
      if (!['curl', 'native'].includes(mode)) fail('CONFIG_NOT_READY');
      data = mode === 'curl' ? await impersonated(code) : await json(url, { deadlineMs: 15000, maxBytes: 262144, tlsOptions: { ca, rejectUnauthorized: true }, headers: {
        Accept: 'application/json,text/plain,*/*',
        'X-User-Key': 'amiami_dev', 'Accept-Language': 'en-US,en;q=0.9',
        Referer: `https://www.amiami.com/eng/detail?gcode=${code}`,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      } });
    } catch (cause) {
      const status = require('../../utils/taricDiagnostics').errorStatus(cause.transport);
      const code = ['TLS_CHAIN_UNTRUSTED', 'FETCH_DISABLED'].includes(cause.code) ? cause.code : status?.status === 403 ? 'HTTP_ACCESS_DENIED'
        : status?.phase === 'tls' && ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(status.socketCode) ? 'TLS_CHAIN_UNTRUSTED' : 'FETCH_FAILED';
      const error = new TaricError(code); error.transport = status; throw error;
    }
    try {
      if (data?.RSuccess !== true || !data.item || data.item.gcode !== code) fail('IDENTITY_MISMATCH');
      object(data.item, Object.keys(data.item), 'EVIDENCE_INVALID');
      // Pure shared normalization. Native buffering is capped before body exposure.
      return normalizeDetail(data, { includeRaw: false });
    } catch (error) {
      const safe = error instanceof TaricError ? error : new TaricError('EVIDENCE_INVALID');
      safe.transport = { phase: 'envelope', dispatched: true, terminal: true };
      throw safe;
    }
  }
  return { adapters, verifyIdentity, generate, fetchFactual, sessionAdapter, fingerprint: () => hash({ origin: env.TARIC_GATEWAY_ORIGIN || null, allowlist: env.TARIC_GATEWAY_ALLOWED_ORIGINS || null }), configured: () => { gatewayOrigin(); return true; } };
}
module.exports = { boundedJson, createTransport };
