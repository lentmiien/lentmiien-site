const fs = require('fs');
const { JSDOM } = require('jsdom');
const { detailFixture } = require('../fixtures/codexDetails');
let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
function setup(page = 'session') {
  const fixture = detailFixture();
  dom = new JSDOM(fixture.html(page), { url: `http://localhost/codex/${page}s/${page}-1`, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const intervals = new Map();
  win.setInterval = (callback, delay) => { intervals.set(delay, callback); return delay; };
  win.clearInterval = (delay) => intervals.delete(delay);
  win.CSS = { escape: (value) => value };
  win.fetch = jest.fn(async (url) => ({ ok: true, text: async () => JSON.stringify(url.includes('/events') || url.includes('/raw-events')
    ? { events: [{ id: 'event-1', seq: 1, category: 'message', kind: 'agent_message', summary: 'Working on the request', timestamp: '2026-09-19T10:00:02Z' }], lastSeq: 1 }
    : { ok: true, ...fixture.payload(page) }) }));
  win.eval(fs.readFileSync('public/js/codex.js', 'utf8'));
  return { fixture, win, doc: win.document, async poll() { intervals.get(10000)?.(); await flush(); } };
}

test('session starts collapsed with response, links, status and live indicator visible; process details absent', async () => {
  const { doc } = setup(); await flush();
  expect([...doc.querySelectorAll('.codex-session-nav > *')].map((node) => node.getAttribute('aria-label'))).toEqual(['Prompt Library', 'Latest turn', 'Archive']);
  expect(doc.querySelector('.codex-followup-panel').open).toBe(false);
  expect(doc.querySelectorAll('.codex-turn-disclosure')).toHaveLength(2);
  expect([...doc.querySelectorAll('.codex-turn-disclosure')].every((node) => !node.open)).toBe(true);
  expect(doc.querySelector('.codex-session-response strong').textContent).toBe('formatted response');
  expect(doc.querySelector('.codex-session-response').closest('details')).toBeNull();
  expect(doc.querySelector('[data-turn-activity] [data-activity-summary]').textContent).toContain('Working on the request');
  expect(doc.querySelector('[data-action="toggle-events"], [data-events-for]')).toBeNull();
  expect(doc.querySelector('.codex-session-response img')).toBeNull();
  expect(doc.querySelectorAll('[data-action="cancel-turn"], [data-action="retry-turn"]')).toHaveLength(2);
});

test('polling preserves disclosure nodes/open state, focused summary, response links and follow-up drafts', async () => {
  const { doc, fixture, poll } = setup(); await flush();
  const disclosure = doc.querySelector('.codex-turn-disclosure');
  disclosure.open = true;
  const summary = disclosure.querySelector('summary');
  summary.focus();
  doc.querySelector('.codex-followup-panel').open = true;
  doc.querySelector('#codex-followup-prompt').value = 'Keep this draft';
  await poll();
  expect(doc.querySelector('.codex-turn-disclosure')).toBe(disclosure);
  expect(disclosure.open).toBe(true);
  expect(doc.activeElement).toBe(summary);
  expect(doc.querySelector('#codex-followup-prompt').value).toBe('Keep this draft');
  const responseLink = doc.querySelector('.codex-session-response a');
  responseLink.focus();
  fixture.state.turns[0].durationMs = 60000;
  await poll();
  expect(doc.activeElement).toBe(responseLink);
  fixture.state.turns[0].status = 'succeeded';
  fixture.state.turns[0].finalResponse = '**Updated response**';
  await poll();
  expect(doc.querySelector('.codex-session-response strong').textContent).toBe('Updated response');
  expect(doc.querySelector('[data-turn-activity]')).toBeNull();
  expect(doc.querySelector('[data-action="cancel-turn"]')).toBeNull();
  expect(doc.querySelector('.codex-turn-disclosure').open).toBe(true);
});

test('queued cards gain live progress and new turns start collapsed on refresh', async () => {
  const { doc, fixture, poll } = setup(); await flush();
  fixture.state.turns[1].status = 'running';
  fixture.state.turns.push({ ...fixture.state.turns[0], id: 'turn-3', sequence: 3, status: 'queued', finalResponse: '' });
  await poll();
  expect(doc.querySelectorAll('[data-turn-activity]')).toHaveLength(2);
  expect(doc.querySelectorAll('.codex-turn-card')).toHaveLength(3);
  expect(doc.querySelector('[data-turn-id="turn-3"] details').open).toBe(false);
  expect(doc.querySelector('[data-turn-id="turn-3"] .codex-session-response').textContent).toContain('Response pending.');
});

test('turn renders Markdown on initial load and refresh while retaining Process Details nodes', async () => {
  const { doc, fixture, poll } = setup('turn'); await flush();
  const process = doc.querySelector('[data-process-activity]');
  const tabs = doc.querySelector('[role="tablist"]');
  expect(doc.querySelector('.codex-transcript--detail h1').textContent).toBe('Request');
  expect(doc.querySelector('.codex-transcript--detail table')).not.toBeNull();
  fixture.state.turns[0].finalResponse = '### Updated\n\n**Done**';
  await poll();
  expect(doc.querySelector('.codex-transcript--detail').textContent).toContain('Updated');
  expect(doc.querySelector('[data-process-activity]')).toBe(process);
  expect(doc.querySelector('[role="tablist"]')).toBe(tabs);
  expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(3);
});
