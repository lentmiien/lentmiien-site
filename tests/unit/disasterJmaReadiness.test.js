jest.mock('../../database', () => ({}));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { DisasterIngestionService } = require('../../services/disasterIngestionService');
const { createLocalSummaryService, buildSummary, key } = require('../../services/disasterLocalSummaryService');
const { PARSER_VERSION, parseJmaAlert } = require('../../utils/disasterJmaParser');
const { VERSION, MAX_PENDING } = require('../../utils/disasterJmaReadiness');
const now = new Date('2026-10-24T22:44:20Z');
const localAt = new Date('2026-10-24T19:58:00Z');
const base = 'https://www.data.jma.go.jp/developer/xml/feed/';
const feedNames = ['eqvol.xml', 'extra.xml', 'eqvol_l.xml', 'extra_l.xml'];
const originalEnv = { ...process.env };

function entry(id = 'local', { at = localAt, product = 'VPWW53', title = '神奈川県気象警報・注意報', ...rest } = {}) {
  return { id: `https://example.test/${id}_${product}.xml`, url: `https://example.test/${id}_${product}.xml`, updatedAt: at, title, ...rest };
}
function detail(e, { clear = false, code = '1410011', infoType = '発表', body = true, reportAt = e.updatedAt || localAt, controlAt = reportAt, status = '通常' } = {}) {
  const kinds = clear ? '<Kind><Name>発表警報・注意報はなし</Name><Code>00</Code></Kind>' :
    '<Kind><Name>強風注意報</Name><Code>15</Code><Status>継続</Status></Kind><Kind><Name>波浪注意報</Name><Code>16</Code><Status>発表</Status></Kind>';
  return `<Report><Control><Title>気象警報・注意報</Title><Status>${status}</Status><DateTime>${controlAt.toISOString()}</DateTime></Control><Head><Title>気象警報・注意報</Title><ReportDateTime>${reportAt.toISOString()}</ReportDateTime><InfoType>${infoType}</InfoType><EventID>kanagawa</EventID><Serial>1</Serial></Head>${body ? `<Body><Warning type="市町村等"><Item><Area><Code>${code}</Code></Area>${kinds}</Item></Warning></Body>` : ''}</Report>`;
}
function atom(entries, updatedAt = now) {
  return `<feed><title>Synthetic JMA</title><updated>${updatedAt.toISOString()}</updated>${entries.map(e =>
    `<entry><id>${e.id}</id><title>${e.title}</title>${e.updatedAt ? `<updated>${new Date(e.updatedAt).toISOString()}</updated>` : ''}<link type="application/xml" href="${e.url}"/></entry>`).join('')}</feed>`;
}
function harness() {
  const alerts = new Map(); const summaries = new Map(); const responses = new Map();
  const summaryModel = {
    updateOne: jest.fn(async (filter, update, opts = {}) => {
      const current = summaries.get(filter._id);
      const matches = !current || (filter.$or ? filter.$or.some(f => f.order?.$lt ? current.order < f.order.$lt : current.order === f.order && current.signature === f.signature) :
        (!filter.order || current.order === filter.order) && (!filter.signature?.$ne || current.signature !== filter.signature.$ne));
      if (!matches) { if (opts.upsert) throw { code: 11000 }; return; }
      const value = structuredClone(current || { _id: filter._id });
      for (const [k, v] of Object.entries(update.$set)) {
        if (k === 'data.coverage') value.data.coverage = v; else value[k] = structuredClone(v);
      }
      summaries.set(filter._id, value);
    }),
    findById: id => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => summaries.get(id) }) }) }),
  };
  const localSummary = createLocalSummaryService({ model: summaryModel, now: () => new Date() });
  const record = data => ({ ...data, _id: data.dedupeKey, save: jest.fn(async () => {}) });
  const model = {
    findOne: jest.fn(({ dedupeKey }) => ({ select: () => ({ lean: async () => alerts.get(dedupeKey) }) })),
    findById: jest.fn(async id => alerts.get(id)),
    create: jest.fn(async data => { const doc = record(data); alerts.set(data.dedupeKey, doc); return doc; }),
    findByIdAndUpdate: jest.fn(async (id, update) => { Object.assign(alerts.get(id), update.$set); return alerts.get(id); }),
  };
  const logger = { warning: jest.fn() };
  const service = new DisasterIngestionService({ models: { DisasterAlert: model }, localSummary, logger });
  service.verifyAlert = jest.fn(async () => {});
  const fetches = [];
  service.fetchText = jest.fn(async url => {
    fetches.push(url);
    const value = responses.get(url);
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error('Missing synthetic response');
    return value;
  });
  const state = { startedAt: new Date('2026-10-01Z'), warningPending: [] };
  function feeds(values = {}) { for (const name of feedNames) responses.set(base + name, atom(values[name] || [])); }
  function add(e, options) { responses.set(e.url, detail(e, options)); }
  function seen(e, options = {}) {
    const doc = record({ ...parseJmaAlert({ xmlText: detail(e), entry: e }), dedupeKey: `jma:${e.url}`, ...options });
    alerts.set(doc.dedupeKey, doc); return doc;
  }
  async function poll() {
    const result = await service.pollJmaFeeds(state);
    jest.setSystemTime(new Date(Date.now() + 1));
    await localSummary.health(result.counters.warningReady, result.counters);
    return result;
  }
  const warnings = () => buildSummary([...summaries.values()], new Date()).warnings;
  feeds();
  return { service, localSummary, alerts, summaries, model, logger, responses, fetches, state, feeds, add, seen, poll, warnings };
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  delete process.env.DISASTER_JMA_FEEDS;
  delete process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN;
});
afterEach(() => { jest.useRealTimers(); process.env = { ...originalEnv }; });

test('7,478 historical deferred entries cannot starve verified local two-advisory state, including a parser upgrade', async () => {
  const h = harness();
  // 7,557 repairs plus one local fetch leave exactly 7,478 deferred at cap 80.
  const historical = Array.from({ length: 7557 }, (_, i) => entry(`history-${i}`, {
    at: new Date('2026-10-22T12:00:00Z'), product: i % 2 ? 'VPWW53' : 'VXSE53', title: 'Historical',
  }));
  for (const e of historical) { h.seen(e, { parserVersion: 'jma-v2' }); h.add(e); }
  const local = entry();
  // Old classification/seen flags are deliberately wrong. Feed metadata, not the
  // old category, must select this entry for refresh.
  h.seen(local, { parserVersion: 'jma-v2', category: 'other', localSummaryVersion: PARSER_VERSION });
  h.add(local);
  h.feeds({ 'eqvol.xml': historical.slice(0, 100), 'eqvol_l.xml': historical,
    'extra.xml': [local], 'extra_l.xml': [...historical.filter((_, i) => i % 2), local] });
  const result = await h.poll();
  expect(result.counters).toMatchObject({ detailFetches: 80, deferred: 7478, warningPending: 0, warningReady: true });
  expect(h.fetches[4]).toBe(local.url);
  expect(h.fetches.filter(url => url === local.url)).toHaveLength(1);
  expect(h.warnings()).toMatchObject({ state: 'active', active: [expect.objectContaining({ code: '15' }), expect.objectContaining({ code: '16' })] });
  expect(h.alerts.get(`jma:${local.url}`)).toMatchObject({ parserVersion: PARSER_VERSION, localWarningCheck: { version: VERSION, resolved: true } });
});

test('already-seen current parser entries need the new verified readiness marker, then cost no detail requests', async () => {
  const h = harness(); const local = entry();
  h.seen(local, { parserVersion: PARSER_VERSION, category: 'other', localSummaryVersion: PARSER_VERSION }); h.add(local);
  h.feeds({ 'extra_l.xml': [local] });
  expect((await h.poll()).counters.detailFetches).toBe(1);
  expect(h.warnings().state).toBe('active');
  expect((await h.poll()).counters.detailFetches).toBe(0);
});

test('newer unresolved warning prevents all-clear and remains pending across feed rollover', async () => {
  process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN = '1';
  const h = harness(); const clear = entry('clear'); const unknown = entry('unknown', { at: now, product: 'UNKNOWN', title: 'Unknown relevance' });
  h.add(clear, { clear: true }); h.add(unknown);
  h.feeds({ 'extra.xml': [unknown], 'extra_l.xml': [clear] });
  expect((await h.poll()).counters).toMatchObject({ warningReady: false, warningPending: 1 });
  expect(h.warnings().state).toBe('stale');
  expect(h.state.warningPending[0].url).toBe(unknown.url);
  h.feeds({ 'extra_l.xml': [clear] }); // short entry disappears before hourly long-feed update
  h.responses.set(unknown.url, new Error('synthetic unavailable'));
  expect((await h.poll()).counters).toMatchObject({ warningReady: false, detailFetches: 1, detailErrors: 1 });
  expect(h.warnings().state).toBe('stale');
  // Unknown product detail cannot prove local coverage even if its title looks local.
  h.add(unknown);
  expect((await h.poll()).counters.warningReady).toBe(false);
});

test('deferred newer local detail becomes current on next bounded poll; unresolved clear never leaks', async () => {
  process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN = '1';
  const h = harness(); const newer = entry('newer', { at: now }); const old = entry('old');
  h.add(old, { clear: true }); h.add(newer);
  await h.localSummary.ingestAlert(parseJmaAlert({ xmlText: detail(old, { clear: true }), entry: old }));
  // A failed attempt consumes the cap and the unresolved new event survives.
  h.responses.set(newer.url, new Error('synthetic failure'));
  h.feeds({ 'extra.xml': [newer], 'extra_l.xml': [old] });
  expect((await h.poll()).counters).toMatchObject({ warningReady: false, detailFetches: 1, warningPending: 2 });
  expect(h.warnings().active).toEqual([]);
  h.add(newer);
  expect((await h.poll()).counters.warningReady).toBe(false); // old evidence still needs verified parsing
  expect((await h.poll()).counters.warningReady).toBe(true);
  expect(h.warnings()).toMatchObject({ state: 'active', at: now.toISOString() });
});

test('irrelevant categories, verified remote municipality and old warning history do not block local clear', async () => {
  process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN = '2';
  const h = harness(); const local = entry(); const remote = entry('remote', { title: 'Remote', at: now });
  const earthquake = entry('earthquake', { product: 'VXSE53', at: now });
  const historical = entry('old-warning', { at: new Date(+now - 7 * 3600000) });
  h.add(local, { clear: true }); h.add(remote, { code: '1310100' });
  h.feeds({ 'extra.xml': [remote, local, historical], 'eqvol.xml': [earthquake] });
  expect((await h.poll()).counters).toMatchObject({ warningReady: true, deferred: 2 });
  expect(h.warnings().state).toBe('clear');
});

test.each(['extra.xml', 'extra_l.xml'])('failed relevant feed %s prevents current status even with fresh details', async name => {
  const h = harness(); const local = entry(); h.add(local); h.feeds({ 'extra.xml': [local], 'extra_l.xml': [local] });
  h.responses.set(base + name, new Error('synthetic feed failure'));
  expect((await h.poll()).counters).toMatchObject({ warningReady: false, warningFeedErrors: 1 });
  expect(h.warnings().state).toBe('stale');
  h.feeds({ 'extra_l.xml': [local] });
  expect((await h.poll()).counters.warningReady).toBe(true);
});

test('earthquake-feed failure is diagnostic but does not invalidate verified weather state', async () => {
  const h = harness(); const local = entry(); h.add(local); h.feeds({ 'extra_l.xml': [local] });
  h.responses.set(base + 'eqvol.xml', new Error('synthetic failure'));
  expect((await h.poll()).counters).toMatchObject({ warningReady: true, feedErrors: 1, warningFeedErrors: 0 });
});

test.each(['extra.xml', 'extra_l.xml'])('stale or malformed %s is not a successful warning poll', async name => {
  const h = harness();
  h.responses.set(base + name, atom([], new Date(+now - 2 * 3600000)));
  expect((await h.poll()).counters.warningReady).toBe(false);
  h.responses.set(base + name, '<html>upstream maintenance</html>');
  expect((await h.poll()).counters.warningReady).toBe(false);
});

test('custom feeds missing the long warning feed cannot certify coverage at a 15-minute polling interval', async () => {
  process.env.DISASTER_JMA_FEEDS = base + 'extra.xml';
  const h = harness();
  expect((await h.poll()).counters).toMatchObject({ warningFeedsPresent: false, warningReady: false });
});

test('unknown timestamps remain pending and recent local checks bypass the archive start cutoff', async () => {
  const h = harness(); const local = entry(); const unknown = entry('unknown-time', { at: null, product: 'UNKNOWN' });
  h.state.startedAt = now; h.add(local); h.add(unknown);
  h.feeds({ 'extra_l.xml': [local, unknown] });
  expect((await h.poll()).counters).toMatchObject({ detailFetches: 2, warningReady: false, warningPending: 1 });
});

test.each(['取消', '訂正'])('bodyless %s cannot restore all-clear and invalidates matching event coverage', async infoType => {
  const h = harness(); const old = entry('old'); const cancel = entry('revision', { at: now });
  h.add(old); h.feeds({ 'extra_l.xml': [old] }); await h.poll();
  expect(h.warnings().state).toBe('active');
  h.add(cancel, { infoType, body: false }); h.feeds({ 'extra.xml': [cancel], 'extra_l.xml': [old] });
  expect((await h.poll()).counters.warningReady).toBe(false);
  expect(h.summaries.get(key('warnings')).data.coverage).toBe(false);
  expect(h.warnings().active).toEqual([]);
});

test('provider cancellation of hazards and newer correction win despite out-of-order feed entries', async () => {
  const h = harness(); const active = entry('active'); const clear = entry('clear', { at: now });
  h.add(active); h.add(clear, { clear: true, infoType: '訂正' });
  h.feeds({ 'extra_l.xml': [active, clear] });
  expect((await h.poll()).counters.warningReady).toBe(true);
  expect(h.warnings().state).toBe('clear');
});

test('same revision conflicting local variants stay unknown despite transport readiness', async () => {
  const h = harness(); const active = entry('active'); const clear = entry('clear');
  h.add(active); h.add(clear, { clear: true }); h.feeds({ 'extra_l.xml': [active, clear] });
  await h.poll(); expect(h.warnings().state).toBe('stale');
});

test('merged short/long duplicate keeps newest date; old copy cannot hide a recent unresolved correction', async () => {
  const h = harness(); const recent = entry('revision', { at: now });
  h.feeds({ 'extra.xml': [recent], 'extra_l.xml': [{ ...recent, updatedAt: new Date(+now - 86400000) }] });
  h.responses.set(recent.url, new Error('synthetic detail failure'));
  expect((await h.poll()).counters).toMatchObject({ detailFetches: 1, warningPending: 1, warningReady: false });
});

test('failed details do not abort other eligible warnings or exceed shared attempt budget', async () => {
  process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN = '2';
  const h = harness(); const bad = entry('bad', { at: now }); const good = entry(); const other = entry('other');
  h.add(good); h.add(other); h.responses.set(bad.url, new Error('synthetic failure'));
  h.feeds({ 'extra_l.xml': [bad, good, other] });
  expect((await h.poll()).counters).toMatchObject({ detailFetches: 2, detailErrors: 1, deferred: 1, warningPending: 2 });
  expect(h.summaries.get(key('warnings')).data.hazards).toHaveLength(2);
  expect(h.logger.warning).toHaveBeenCalled();
});

test('bounded pending overflow fails closed even if entries disappear from the next feed', async () => {
  process.env.DISASTER_JMA_MAX_NEW_DETAILS_PER_RUN = '1';
  const h = harness(); const entries = Array.from({ length: MAX_PENDING + 2 }, (_, i) => entry(`pending-${i}`));
  h.feeds({ 'extra_l.xml': entries });
  expect((await h.poll()).counters).toMatchObject({ warningPendingOverflow: true, warningReady: false });
  expect(h.state.warningPending).toHaveLength(MAX_PENDING);
  h.feeds();
  expect((await h.poll()).counters.warningReady).toBe(false);
});

test('six-hour coverage and 45-minute successful-poll limits still expire verified advisories', async () => {
  const h = harness(); const local = entry(); h.add(local); h.feeds({ 'extra_l.xml': [local] }); await h.poll();
  expect(h.warnings().state).toBe('active');
  jest.setSystemTime(new Date(+now + 46 * 60000)); expect(h.warnings().state).toBe('stale');
  jest.setSystemTime(new Date(+localAt + 6 * 3600000 + 1));
  await h.localSummary.health(true); expect(h.warnings().state).toBe('stale');
});

test('runOnce persists local readiness independently of global deferred and invalidates health during refresh', async () => {
  const h = harness(); const health = jest.spyOn(h.localSummary, 'health');
  h.state.save = jest.fn(); h.service.getState = jest.fn(async () => h.state);
  h.localSummary.bootstrap = jest.fn(async () => { expect(health.mock.calls[0]).toEqual([false]); });
  h.service.pollJmaFeeds = jest.fn(async () => ({ feeds: [], counters: { feedErrors: 0, deferred: 7478, warningReady: true } }));
  await h.service.runOnce();
  expect(health.mock.calls[0]).toEqual([false]);
  expect(health.mock.calls[1]).toEqual([true, expect.objectContaining({ deferred: 7478 })]);
  expect(h.state.counters.warningReady).toBe(true);
});

test('a summary write failure after refreshing a seen alert is retried before readiness can recover', async () => {
  const h = harness(); const local = entry();
  h.seen(local, { parserVersion: PARSER_VERSION, localSummaryVersion: PARSER_VERSION });
  h.add(local); h.feeds({ 'extra_l.xml': [local] });
  const ingest = jest.spyOn(h.localSummary, 'ingestAlert').mockRejectedValueOnce(new Error('synthetic summary failure'));
  expect((await h.poll()).counters.warningReady).toBe(false);
  expect(h.alerts.get(`jma:${local.url}`).localSummaryVersion).toBeNull();
  expect((await h.poll()).counters).toMatchObject({ detailFetches: 0, warningReady: true });
  expect(ingest).toHaveBeenCalledTimes(2);
  expect(h.warnings().state).toBe('active');
});

test('health timestamp records the feed check, not the end of a long archive repair', async () => {
  const h = harness(); const local = entry(); h.add(local); h.feeds({ 'extra_l.xml': [local] });
  const result = await h.service.pollJmaFeeds(h.state);
  jest.setSystemTime(new Date(+now + 46 * 60000));
  await h.localSummary.health(true, result.counters);
  expect(h.warnings().state).toBe('stale');
});

test('verified remote correction does not block local coverage; unrecognized local status does', async () => {
  const h = harness(); const local = entry(); const remote = entry('remote');
  h.add(local); h.add(remote, { code: '1310100', infoType: '訂正' });
  // A different region has a different provider event identity.
  h.responses.set(remote.url, h.responses.get(remote.url).replace('kanagawa', 'tokyo'));
  h.feeds({ 'extra_l.xml': [local, remote] });
  expect((await h.poll()).counters.warningReady).toBe(true);
  const bad = entry('bad-status', { at: now });
  h.responses.set(bad.url, detail(bad).replace('<Status>継続</Status>', '<Status>unknown</Status>'));
  h.feeds({ 'extra_l.xml': [local, remote, bad] });
  expect((await h.poll()).counters.warningReady).toBe(false);
  expect(h.warnings().state).toBe('stale');
});

test.each(['<Item/>', '<Item><Area><Code>1410000</Code></Area></Item>'])('partial or ambiguous regional coverage stays unknown: %s', async extraItem => {
  const h = harness(); const e = entry();
  h.responses.set(e.url, detail(e, { code: '1310100' }).replace('</Warning>', `${extraItem}</Warning>`));
  h.feeds({ 'extra_l.xml': [e] });
  expect((await h.poll()).counters.warningReady).toBe(false);
});
