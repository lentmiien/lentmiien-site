/* Opt-in, loopback-only, actual Gateway ASGI + manager + scheduler; hardware is fake.
 * Never load Site dotenv, production lifespan, Docker sockets or GPU devices.
 */
const { spawn } = require('child_process');
const net = require('net');
const { boundedJson } = require('../../services/taric/transport');
const { createGatewaySessions } = require('../../services/taric/gatewaySessions');
const { createWarmSessions } = require('../../services/taric/warmSession');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
const helper = process.env.TARIC_GATEWAY_CONTRACT_HELPER;
const python = process.env.TARIC_GATEWAY_CONTRACT_PYTHON;
const run = helper && python ? describe : describe.skip;
run('actual Python Gateway cleanup contract (test-only hardware)', () => {
  test.each(['unused-residents', 'delayed-cleanup', 'cleanup-retry'])('%s retains exclusive ownership until verified reclaim', async scenario => {
    const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const child = spawn(python, [helper, '--test-only', '--host', '127.0.0.1', '--port', String(port), '--scenario', scenario, '--lifetime-sec', '45'], {
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', b => { output = (output + b).slice(-8192); }); child.stderr.on('data', b => { output = (output + b).slice(-8192); });
    const calls = [];
    const gateway = async (path, options = {}) => {
      const result = await boundedJson(new URL(`http://127.0.0.1:${port}${path}`), options);
      calls.push({ method: options.method || 'GET', path, result }); return result;
    };
    // The isolated helper deliberately does not expose /openapi.json. Discovery is
    // covered separately; every session response here comes from actual Python.
    const capabilities = { preflight: async () => ({ protocol: 'owned-v1', digest: 'a'.repeat(64), observedAt: new Date().toISOString() }) };
    const warm = createWarmSessions(createGatewaySessions(gateway, { capabilities, delayMs: 100 }));
    try {
      const deadline = Date.now() + 10000;
      while (!output.includes('Application startup complete.') && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      expect(output).toContain('Application startup complete.');
      const handle = await warm.open({ correlationId: 'a'.repeat(32) });
      expect(JSON.stringify(handle)).not.toMatch(/owner_token|ownerToken/);
      const first = await warm.close(handle);
      if (scenario === 'cleanup-retry') {
        expect(first).toEqual({ idle: false, reason: 'BACKEND_RECLAIM_FAILED' });
        expect(warm.lookup(handle.id)).toBe(handle);
        await expect(warm.open({ correlationId: 'b'.repeat(32) })).rejects.toThrow('CLEANUP_PENDING');
        expect(await warm.close(handle)).toEqual({ idle: true });
      } else expect(first).toEqual({ idle: true });
      expect(await warm.close(handle)).toEqual({ idle: true });
      expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
      expect(calls.every(c => !c.path.endsWith('/generate'))).toBe(true);
      const final = calls.at(-1).result;
      expect(final.reclaim_verified).toBe(true);
      if (scenario === 'unused-residents') expect(final.reclaim_basis).toBe('no_work_container_inactive');
      if (scenario === 'delayed-cleanup') {
        expect(calls.find(c => c.method === 'DELETE').result.reclaim_verified).toBe(false);
        expect(calls.filter(c => c.method === 'GET' && !c.result.reclaim_verified).length).toBeGreaterThan(6);
        expect(final.reclaim_basis).toBe('runtime_stopped_vram_verified');
      }
    } finally {
      if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    }
  }, 30000);
});
