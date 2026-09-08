const fs = require('fs');
const vm = require('vm');
function el() {
  return { dataset: {}, hidden: false, textContent: '', value: '', children: [], handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    querySelector: () => null, querySelectorAll: () => [], setAttribute: jest.fn(), removeAttribute: jest.fn(),
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    classList: { add: jest.fn(), remove: jest.fn() }, focus: jest.fn(), showModal: jest.fn(), close: jest.fn(),
  };
}
function fixture() {
  const ids = ['chats', 'agenda', 'cooking', 'jobs', 'ask', 'codex', 'runpod', 'tapo', 'models', 'gateway'];
  const cards = ids.map(id => {
    const card = el(); card.dataset.section = id;
    const children = Object.fromEntries(['account-card-content', 'account-card-state', 'account-card-data', 'account-card-note', 'account-collapse', 'account-refresh'].map(c => [`.${c}`, el()]));
    card.querySelector = selector => children[selector];
    card.hidden = ['tapo', 'models'].includes(id);
    children['.account-card-content'].hidden = ['gateway', 'codex'].includes(id);
    return card;
  });
  const elements = {};
  for (const id of ['account-dashboard', 'account-settings', 'account-customizer', 'account-status', 'job-scope', 'job-types', 'account-customize', 'account-customize-close', 'account-save', 'account-reset', 'nav-save', 'nav-reset']) elements[id] = el();
  elements['account-dashboard'].dataset.csrfToken = 'fixture';
  elements['account-dashboard'].querySelectorAll = () => cards;
  elements['job-scope'].value = 'mine';
  elements['account-settings'].textContent = JSON.stringify({ jobs: { types: [] }, jobTypes: [] });
  const pending = [];
  const fetch = jest.fn(url => new Promise(resolve => pending.push({ url, resolve })));
  const document = { getElementById: id => elements[id], createElement: () => el(), querySelectorAll: () => [], body: el(), activeElement: el() };
  const window = { location: { hash: '', reload: jest.fn() } };
  vm.runInNewContext(fs.readFileSync('public/js/account_dashboard.js', 'utf8'), { document, window, fetch, AbortController, Intl, Date, setTimeout: () => 1, clearTimeout: () => {} });
  return { cards, elements, pending, fetch };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const answer = request => request.resolve({ ok: true, redirected: false, json: async () => ({ ok: true, rows: [], state: 'empty', fetchedAt: new Date().toISOString() }) });
test('loads at most four cards concurrently and never requests hidden/collapsed sections', async () => {
  const f = fixture(); expect(f.fetch).toHaveBeenCalledTimes(4);
  f.pending.slice(0, 4).forEach(answer); await flush();
  expect(f.fetch).toHaveBeenCalledTimes(6);
  const urls = f.fetch.mock.calls.map(c => c[0]);
  for (const id of ['tapo', 'models', 'gateway', 'codex']) expect(urls).not.toContain(`/mypage/api/cards/${id}`);
  f.pending.slice(4).forEach(answer); await flush();
});
test('card failure does not break queue; expansion loads its card once and refresh retries', async () => {
  const f = fixture();
  f.pending[0].resolve({ ok: false }); await flush();
  expect(f.cards[0].dataset.state).toBe('error');
  expect(f.fetch).toHaveBeenCalledTimes(5);
  f.pending.slice(1).forEach(answer); await flush(); f.pending.slice(5).forEach(answer); await flush();
  const collapsed = f.cards.find(c => c.dataset.section === 'gateway');
  const toggle = collapsed.querySelector('.account-collapse'); toggle.handlers.click({ currentTarget: toggle });
  expect(f.fetch.mock.calls.at(-1)[0]).toBe('/mypage/api/cards/gateway');
  answer(f.pending.at(-1)); await flush();
  toggle.handlers.click({ currentTarget: toggle }); toggle.handlers.click({ currentTarget: toggle });
  expect(f.fetch.mock.calls.filter(c => c[0].endsWith('/gateway'))).toHaveLength(1);
  collapsed.querySelector('.account-refresh').handlers.click();
  expect(f.fetch.mock.calls.filter(c => c[0].endsWith('/gateway'))).toHaveLength(2);
  answer(f.pending.at(-1)); await flush();
});
