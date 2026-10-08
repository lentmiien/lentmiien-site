const fs = require('fs');
const vm = require('vm');
const pug = require('pug');
let JSDOM, dom, intervals;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => dom?.window.close());
function snapshot() {
  return { fetchedAt: new Date().toISOString(), complete: true, status: 'Gateway reports healthy', sources: [], context: ['Scheduler running does not mean GPU busy.'], services: [{ id: 'voicevox', availability: 'Responsive', tone: 'normal', state: 'running', model: 'Unknown', owner: 'None observed', policy: 'CPU', guidance: 'voicevox', evidence: [] }] };
}
function setup(data = snapshot()) {
  const html = pug.renderFile('views/admin_ai_gateway.pug', {
    dashboard: { monitoring: data, errors: {}, gpu: {}, requests: { totals: {}, routes: [] }, waiters: {}, logs: [], containers: [], checkpoints: [] },
    loggedIn: true, admin: true, permissions: [], htmlPaths: [], bookmarks: [],
  });
  dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://site.invalid/admin/ai-gateway' });
  intervals = new Map();
  dom.window.setInterval = (fn, delay) => { intervals.set(delay, fn); return delay; };
  dom.window.clearInterval = id => intervals.delete(id);
  dom.window.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => snapshot() });
  vm.runInContext(fs.readFileSync('public/js/aiGatewayMonitoring.js', 'utf8'), dom.getInternalVMContext());
  return dom.window.document;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('page renders service status without D3 and recovery links open the fixed runbook', () => {
  const d = setup();
  expect(d.getElementById('serviceMonitoringCards').textContent).toContain('Responsive');
  expect(d.getElementById('serviceMonitoringStatus').textContent).toContain('Observed:');
  expect(d.querySelector('.gateway-runbook').open).toBe(false);
  d.querySelector('#serviceMonitoringCards a').click();
  expect(d.querySelector('.gateway-runbook').open).toBe(true);
  expect(d.getElementById('voicevox-recovery').textContent).toContain('docker compose start voicevox_engine');
  expect(dom.window.fetch).not.toHaveBeenCalled();
});
test('HTML/script payloads remain text in JSON, cards, evidence and links', () => {
  const data = snapshot();
  const payload = '</script><img src=x onerror="window.pwned=true">';
  Object.assign(data.services[0], { id: payload, availability: payload, evidence: [payload], guidance: payload, tone: payload });
  data.context = [payload];
  const d = setup(data);
  expect(d.getElementById('serviceMonitoringCards').textContent).toContain(payload);
  expect(d.querySelector('#serviceMonitoringCards img')).toBeNull();
  expect(d.querySelector('#serviceMonitoringContext img')).toBeNull();
  expect(d.querySelector('#serviceMonitoringCards a').getAttribute('href')).toBe('#recovery-monitoring');
  expect(dom.window.pwned).toBeUndefined();
});
test.each(['network', 'http', 'malformed', 'stale'])('%s refresh removes old healthy cards', async failure => {
  const d = setup();
  if (failure === 'network') dom.window.fetch.mockRejectedValue(new Error('SECRET'));
  if (failure === 'http') dom.window.fetch.mockResolvedValue({ ok: false });
  if (failure === 'malformed') dom.window.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  if (failure === 'stale') dom.window.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), fetchedAt: '2000-01-01T00:00:00Z' }) });
  d.getElementById('refreshServiceMonitoring').click(); await flush();
  expect(d.getElementById('serviceMonitoringCards').textContent).toBe('');
  expect(d.getElementById('serviceMonitoringStatus').textContent).toContain('unknown');
  expect(d.getElementById('serviceMonitoringStatus').textContent).not.toContain('SECRET');
});
test('expiry, hidden-tab polling pause, resume, single-flight and pagehide cleanup', async () => {
  const d = setup({ ...snapshot(), fetchedAt: new Date(Date.now() - 59900).toISOString() });
  dom.window.Date.now = () => Date.now() + 2000;
  intervals.get(1000)();
  expect(d.getElementById('serviceMonitoringStatus').textContent).toContain('stale');
  Object.defineProperty(d, 'hidden', { configurable: true, value: true });
  await intervals.get(30000)(); expect(dom.window.fetch).not.toHaveBeenCalled();
  dom.window.fetch.mockImplementation(() => new Promise(() => {}));
  Object.defineProperty(d, 'hidden', { configurable: true, value: false });
  d.dispatchEvent(new dom.window.Event('visibilitychange'));
  intervals.get(30000)();
  expect(dom.window.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = dom.window.fetch.mock.calls[0];
  expect(url).toBe('/admin/ai-gateway/monitoring');
  expect(options.method).toBeUndefined();
  expect(options.cache).toBe('no-store');
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(options.signal.aborted).toBe(true);
  expect(intervals.size).toBe(0);
});
test('copy uses fixed text and never sends any mutation', async () => {
  const d = setup();
  const writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText } });
  d.querySelector('[data-copy-command="voicevox-recovery"]').click(); await flush();
  expect(writeText).toHaveBeenCalledWith(d.getElementById('voicevox-recovery').textContent.trim());
  expect(dom.window.fetch).not.toHaveBeenCalled();
});

test('returning from back-forward cache expires old observations and resumes refresh', async () => {
  const d = setup();
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  expect(intervals.size).toBe(0);
  const event = new dom.window.Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  dom.window.dispatchEvent(event); await flush();
  expect(intervals.size).toBe(2);
  expect(dom.window.fetch).toHaveBeenCalledTimes(1);
  expect(d.getElementById('serviceMonitoringCards').textContent).toContain('Responsive');
});
