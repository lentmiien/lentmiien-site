const fs = require('fs');
const pug = require('pug');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;

let dom;
afterEach(() => dom?.window.close());

async function flush() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function createTurnPage(modelProvider = 'openai') {
  const state = { turn: { id: 'turn-1', status: 'running', modelProvider }, session: {}, workspace: {} };
  const html = pug.renderFile('views/codex/turn.pug', {
    formAssetUrl, loggedIn: false, permissions: [], htmlPaths: [], bookmarks: [], admin: false,
    codexState: state, codexStateJson: JSON.stringify(state),
  });
  dom = new JSDOM(html, {
    url: 'http://localhost/codex/turns/turn-1', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window;
  const intervals = new Map();
  win.setInterval = (callback, delay) => { intervals.set(delay, callback); return delay; };
  win.clearInterval = (id) => intervals.delete(id);
  win.CSS = { escape: (value) => value };
  let response = { ok: true, events: [], lastSeq: 0, remainingUsage: null };
  win.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify(response) }));
  const gauge = win.document.querySelector('[data-remaining-usage]');
  expect(gauge.hidden).toBe(true);
  win.eval(fs.readFileSync('public/js/codex.js', 'utf8'));
  return {
    gauge,
    async poll(remainingUsage, lastSeq = 1) {
      response = { ok: true, events: [], lastSeq, remainingUsage };
      intervals.get(2000)();
      await flush();
    },
  };
}

test('shows and updates the gauge without opening raw events and retains it between updates', async () => {
  const { gauge, poll } = createTurnPage();
  await flush();
  expect(gauge.hidden).toBe(true);

  await poll({ seq: 1, remainingPercent: 92 });
  expect(gauge.hidden).toBe(false);
  expect(gauge.querySelector('[data-remaining-usage-label]').textContent).toBe('92% remaining');
  expect(gauge.querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('92');
  expect(gauge.querySelector('[data-remaining-usage-fill]').style.width).toBe('92%');

  await poll({ seq: 2, remainingPercent: 80 }, 2);
  expect(gauge.textContent).toContain('80% remaining');
  expect(gauge.querySelector('[data-remaining-usage-fill]').style.width).toBe('80%');
  expect(dom.window.fetch).toHaveBeenLastCalledWith(
    '/codex/api/turns/turn-1/events?afterSeq=1', expect.any(Object)
  );

  await poll(null, 3);
  expect(gauge.hidden).toBe(false);
  expect(gauge.textContent).toContain('80% remaining');
  await poll({ seq: 4, remainingPercent: 0 }, 4);
  expect(gauge.hidden).toBe(false);
  expect(gauge.textContent).toContain('0% remaining');
  expect(gauge.querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('0');
  await poll({ seq: 5, remainingPercent: 100 }, 5);
  expect(gauge.textContent).toContain('100% remaining');
  expect(dom.window.fetch.mock.calls.every(([url]) => !url.includes('/raw-events'))).toBe(true);
});

test('local turns stay hidden without usage events and malformed percentages are inert', async () => {
  const { gauge, poll } = createTurnPage('ollama');
  await flush();
  await poll(null);
  await poll({ remainingPercent: '<img src=x onerror=alert(1)>' });
  await poll({ remainingPercent: 101 });
  expect(gauge.hidden).toBe(true);
  expect(gauge.querySelector('img')).toBeNull();
});
