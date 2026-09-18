const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { fork } = require('child_process');
const { TaricError, gcode } = require('../../utils/taricContracts');
// Fixed-origin, isolated native client. libcurl enforces the WIRE cap while receiving;
// child stdout/IPC limits are additional defenses, never a substitute for that cap.
function fetchImpersonated(code, { spawn = fork, deadlineMs = 15000 } = {}) {
  gcode(code);
  return new Promise((resolve, reject) => {
    const started = Date.now(); let settled = false; let timer;
    const env = {};
    for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
      'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taric-ca-'));
    const caPath = path.join(directory, 'trusted.pem');
    const cleanup = () => {
      try { fs.rmSync(directory, { recursive: true, force: true }); }
      catch (_) { require('../../utils/logger').warning('TARIC temporary public CA bundle cleanup failed', { category: 'taric' }); }
    };
    let child;
    try {
      fs.writeFileSync(caPath, [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])].join('\n'), { mode: 0o600 });
      child = spawn(require.resolve('./amiamiCurlChild'), [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    } catch (_) { cleanup(); reject(new TaricError('FETCH_FAILED')); return; }
    child.once('exit', cleanup);
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); if (child.kill() === false) cleanup();
      if (error) reject(error); else resolve(value);
    };
    const failed = (code, status) => {
      const error = new TaricError(code);
      error.transport = require('../../utils/taricDiagnostics').errorStatus(status);
      finish(error);
    };
    timer = setTimeout(() => failed('FETCH_FAILED', { phase: 'timeout', dispatched: true, terminal: false, durationMs: Date.now() - started }), Math.max(1, deadlineMs - (Date.now() - started)));
    child.on('error', () => failed('FETCH_FAILED'));
    child.on('exit', () => { if (!settled) failed('FETCH_FAILED'); });
    child.on('message', message => {
      if (message?.ok === true && message.data && Buffer.byteLength(JSON.stringify(message.data)) <= 262144) finish(null, message.data);
      else failed(['HTTP_ACCESS_DENIED', 'TLS_CHAIN_UNTRUSTED', 'FETCH_DISABLED'].includes(message?.code) ? message.code : 'FETCH_FAILED', message?.transport);
    });
    child.send({ code, caPath }, error => { if (error) failed('FETCH_FAILED'); });
  });
}
module.exports = { fetchImpersonated };
