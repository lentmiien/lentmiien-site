const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pug = require('pug');
const { aggregateConnectivity } = require('../../services/connectivityAnalytics');
const { getConnectivityConfig } = require('../../utils/connectivityConfig');

// Minimal DOM for executing the real browser script, with no browser dependency or network.
class TestNode {
  constructor(tag = '', text = '') { this.tag = tag; this.text = text; this.children = []; this.attributes = {}; this.events = {}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, fn) { this.events[key] = fn; }
  focus() { this.focused = true; }
  all(predicate) { return this.children.flatMap((child) => [ ...(predicate(child) ? [child] : []), ...child.all(predicate)]); }
  querySelectorAll(selector) { return this.all((node) => node.attributes['data-row'] === selector.match(/"(\d+)"/)[1]); }
}
const config = getConnectivityConfig({ CONNECTIVITY_PUBLIC_ORIGIN: 'https://example.com' });
const since = new Date('2026-09-06T00:00:00Z');
const until = new Date(+since + 3600000);
const row = (seconds, probe) => ({ sampledAt: new Date(+since + seconds * 1000), signature: config.signature,
  monitorVersion: '2', slowMs: 1500, probes: [{ name: 'publicApp', outcome: 'ok', ...probe }] });
const aggregate = (rows) => aggregateConnectivity(rows, config, { since, until });

async function dashboard(data) {
  const html = pug.renderFile(path.join(__dirname, '../../views/connectivity_dashboard.pug'), { gtag: false, permissions: [] });
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], new TestNode()]));
  nodes['connectivity-window'].value = '24';
  const fetch = jest.fn(async () => ({ ok: true, json: async () => data }));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/js/connectivityDashboard.js'), 'utf8'), {
    Node: TestNode, document: { getElementById: (id) => nodes[id], createElement: (tag) => new TestNode(tag),
      createElementNS: (_ns, tag) => new TestNode(tag), createTextNode: (text) => new TestNode('', text) },
    fetch, AbortController, setTimeout, clearTimeout, Intl, Date,
  });
  await new Promise(setImmediate);
  return { nodes, fetch, html };
}

test('renders DNS and post-DNS with independent gaps, true zeros, counts and aligned keyboard details', async () => {
  const data = aggregate([row(1, { latencyMs: 1100, timings: { dnsMs: 1000, totalMs: 1100 } }),
    row(16, { latencyMs: 500, timings: { dnsMs: 100 } }),
    row(31, { latencyMs: 0, timings: { dnsMs: 0, totalMs: 0 } })]);
  const { nodes, fetch, html } = await dashboard(data);
  expect(html).toContain('DNS vs post-DNS latency');
  expect(html).toContain('must not be added together');
  expect(html).toContain('not a completed phase');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/admin/connectivity/analytics?hours=24');
  expect(nodes['connectivity-message'].textContent).toContain('Updated');
  const svg = nodes['dns-chart'].children[0];
  const paths = svg.all((node) => node.tag === 'path');
  expect(paths).toHaveLength(6);
  const dnsPath = paths.filter((node) => node.attributes.class === 'timing-dnsMs')[2].attributes.d;
  const postPath = paths.filter((node) => node.attributes.class === 'timing-postDnsMs')[2].attributes.d;
  expect(dnsPath.match(/M/g)).toHaveLength(1);
  expect(dnsPath.match(/L/g)).toHaveLength(2);
  expect(postPath.match(/M/g)).toHaveLength(2);
  expect(postPath).not.toContain('L');
  expect(svg.all((node) => node.tag === 'circle')).toHaveLength(5);
  const card = nodes['probe-cards'].children[2];
  expect(card.textContent).toContain('DNS p50 / p95');
  expect(card.textContent).toContain('100 ms / 1000 ms · n=3');
  expect(card.textContent).toContain('0 ms / 100 ms · n=2');
  expect(card.textContent).toContain('Connection and response breakdown');
  const cells = nodes.timeline.all((node) => node.tag === 'rect' && node.attributes['data-row'] === '2');
  cells[0].events.keydown({ key: 'Enter', preventDefault: jest.fn() });
  expect(nodes['timeline-selection'].textContent).toContain('success DNS p95 1000 ms (n=1), post-DNS p95 100 ms (n=1)');
  cells[0].events.keydown({ key: 'ArrowRight', preventDefault: jest.fn() });
  expect(cells[1].focused).toBe(true);
  cells[1].events.click();
  expect(nodes['timeline-selection'].textContent).toContain('post-DNS p95 Unknown (n=0)');
});

test('legacy and failed samples show unknown phases or explicit timeout time, never success chart points', async () => {
  const { nodes } = await dashboard(aggregate([
    row(1, { latencyMs: 5000, outcome: 'timeout' }),
    row(16, { latencyMs: 5000, outcome: 'timeout', failurePhase: 'tls', timings: { dnsMs: 1900, tcpMs: 1910, totalMs: 5000 } }),
    row(31, { latencyMs: 400 }),
  ]));
  expect(nodes['dns-chart'].all((node) => node.tag === 'circle')).toHaveLength(0);
  expect(nodes['probe-cards'].children[2].textContent).toContain('Unknown / Unknown · n=0');
  const history = nodes.history.textContent;
  expect(history).toContain('Timeout phase: Unknown; elapsed since phase boundary: Unknown');
  expect(history).toContain('Timeout phase: tls; elapsed since phase boundary: 3090 ms');
  expect(history).toContain('failed attempt, excluded from success statistics');
  expect(history).toContain('Cumulative milestones from start: DNS 1900 ms / TCP 1910 ms / TLS Unknown');
  expect(history).not.toMatch(/NaN|undefined/);
});

test('empty state, range refresh, history pagination and failed refresh retain existing behavior', async () => {
  const { nodes, fetch } = await dashboard(aggregate(Array.from({ length: 31 }, (_, i) => row(i * 30, { latencyMs: 10 }))));
  expect(nodes['history-caption'].textContent).toContain('1–30 of 31');
  nodes['history-next'].events.click();
  expect(nodes['history-caption'].textContent).toContain('31–31 of 31');
  nodes['connectivity-window'].value = '6';
  fetch.mockResolvedValueOnce({ ok: true, json: async () => aggregate([]) });
  await nodes['connectivity-window'].events.change();
  expect(fetch.mock.calls.at(-1)[0]).toBe('/admin/connectivity/analytics?hours=6');
  expect(nodes.history.textContent).toContain('No stored observations');
  expect(nodes['dns-chart'].all((node) => node.tag === 'circle')).toHaveLength(0);
  fetch.mockResolvedValueOnce({ ok: false, status: 403 });
  await nodes['connectivity-refresh'].events.click();
  expect(nodes['connectivity-message'].textContent).toContain('Access denied or session expired');
  expect(nodes['connectivity-message'].textContent).toContain('Previous results remain displayed');
});
