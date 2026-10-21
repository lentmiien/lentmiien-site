const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { buildConversationList, buildConversationFilters } = require('../../services/chat5ConversationListService');
const now = new Date(2026, 9, 22, 12);
const card = (overrides = {}) => ({
  api_model: 'model-a', model_name: 'Model A', provider: 'Provider A', model_type: 'chat',
  in_modalities: ['text', 'image'], out_modalities: ['text'], max_tokens: 100000, max_out_tokens: 5000,
  deprecation_date: null, ...overrides,
});
const conversation = (overrides = {}) => ({
  _id: 'a', title: 'Project Alpha', category: 'Work', tags: ['design, review'], members: ['Owner'],
  summary: 'A synthetic summary', messages: ['m1'], createdAt: now, updatedAt: now,
  metadata: { model: 'model-a', reasoning: 'high', mode: 'standard' }, ...overrides,
});
function render(conversations, cards, extra = {}) {
  const listed = buildConversationList(conversations, cards, ['a'], now);
  return pug.renderFile(path.resolve(__dirname, '../../views/chat5_top.pug'), {
    loggedIn: true, permissions: [], conversations: listed,
    filters: buildConversationFilters(listed, ['Work', 'Personal']), ...extra,
  });
}
async function browser(conversations, cards, extra = {}) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(render(conversations, cards, extra), { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.resolve(__dirname, '../../public/js/chat5_top.js'), 'utf8'));
  return dom;
}

test.each([
  [null, 'none', ''],
  ['2026-10-21', 'deprecated', 'deprecated since 2026-10-21'],
  ['2026-10-22', 'scheduled', 'deprecates today (2026-10-22)'],
  ['2027-01-01', 'scheduled', 'scheduled for deprecation on 2027-01-01'],
])('classifies deprecation %s by calendar day', (date, status, warning) => {
  const [entry] = buildConversationList([conversation()], [card({ deprecation_date: date })], [], now);
  expect(entry.filters.deprecation).toEqual([status]);
  expect(entry.modelCards[0].warning).toContain(warning);
  if (!date) expect(entry.modelCards[0].warning).toBe('');
});

test('uses exact model IDs, preserves all provider matches, and keeps missing metadata unknown', () => {
  const entries = buildConversationList([
    conversation(), conversation({ metadata: { model: 'model' } }), conversation({ metadata: undefined }),
  ], [card(), card({ provider: 'Provider B', deprecation_date: '2026-10-01' })], ['a'], now);
  expect(entries[0].modelCards).toHaveLength(2);
  expect(entries[0].filters.deprecation).toEqual(['none', 'deprecated']);
  expect(entries[0].filters.provider).toEqual(['Provider A', 'Provider B']);
  expect(entries[0].isPending).toBe(true);
  for (const entry of entries.slice(1)) {
    expect(entry.modelCards).toEqual([]);
    expect(entry.filters.deprecation).toEqual(['unknown']);
  }
});

test('combines literal title, conversation, and model filters; hides headings and resets hidden controls', async () => {
  const dom = await browser([
    conversation(),
    conversation({ _id: 'b', title: 'Project Beta', category: 'Personal', tags: ['other'], metadata: { model: 'model-b' }, updatedAt: new Date('2020-01-01') }),
    conversation({ _id: 'c', title: 'Project Alpha archive', old: true, metadata: { model: 'missing' }, updatedAt: new Date('2020-01-01') }),
  ], [card({ deprecation_date: '2027-01-01' }), card({ api_model: 'model-b', provider: 'Provider B' })]);
  try {
    const { document, Event } = dom.window;
    const change = (key, value) => {
      const input = document.getElementById(`filter-${key}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const visible = () => [...document.querySelectorAll('.entry')].filter(e => !e.hidden);
    change('title', '  PROJECT alpha  ');
    expect(visible()).toHaveLength(2);
    for (const [key, value] of Object.entries({ category: 'Work', model: 'model-a', deprecation: 'scheduled', tag: 'design, review', member: 'Owner', pending: 'pending', source: 'current', provider: 'Provider A', type: 'chat', input: 'image', output: 'text', reasoning: 'high', mode: 'standard' })) change(key, value);
    expect(visible()).toHaveLength(1);
    expect(document.getElementById('filterResults').textContent).toBe('1 of 3 conversations');
    const headers = [...document.querySelectorAll('.bucket-header')];
    expect(headers.filter(e => !e.hidden)).toHaveLength(1);
    change('title', '.*');
    expect(visible()).toHaveLength(0);
    expect(document.getElementById('noConversations').hidden).toBe(false);
    expect(headers.every(e => e.hidden)).toBe(true);
    document.getElementById('conversationFilters').reset();
    expect(visible()).toHaveLength(3);
    expect(headers.every(e => !e.hidden)).toBe(true);
    expect(document.getElementById('filterResults').textContent).toBe('3 of 3 conversations');
    expect(document.getElementById('noConversations').hidden).toBe(true);
  } finally { dom.window.close(); }
});

test('escapes hostile metadata in cards, filters, and previews and clears a previous preview warning', async () => {
  const hostile = '\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const dom = await browser([
    conversation({ title: hostile, tags: [hostile], summary: hostile }),
    conversation({ _id: 'b', metadata: { model: 'missing' } }),
  ], [card({ model_name: hostile, provider: hostile, deprecation_date: '2020-01-01' })]);
  try {
    const { document } = dom.window;
    const [first, second] = document.querySelectorAll('.entry');
    expect(first.querySelector('img, script')).toBeNull();
    expect(first.querySelector('[onerror]')).toBeNull();
    expect(first.querySelector('.chat5-model-warning--deprecated').textContent).toContain('deprecated since');
    first.querySelector('[data-preview]').click();
    expect(document.getElementById('previewTitle').textContent).toBe(hostile);
    expect(document.getElementById('previewModel').textContent).toContain(hostile);
    expect(document.getElementById('previewModelWarning').hidden).toBe(false);
    expect(document.getElementById('convPreviewModal').querySelector('img, script')).toBeNull();
    second.querySelector('[data-preview]').click();
    expect(document.getElementById('previewModelWarning').hidden).toBe(true);
    expect(document.getElementById('previewModel').textContent).toContain('deprecation status unknown');
  } finally { dom.window.close(); }
});

test('renders an empty list and catalog failure without breaking filtering', async () => {
  const dom = await browser([], [], { modelCardsUnavailable: true });
  try {
    expect(dom.window.document.getElementById('filterResults').textContent).toBe('0 of 0 conversations');
    expect(dom.window.document.getElementById('noConversations').textContent).toBe('No conversations yet.');
    expect(dom.window.document.body.textContent).toContain('Model cards could not be loaded');
  } finally { dom.window.close(); }
});
