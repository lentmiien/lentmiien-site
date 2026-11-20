const fs = require('node:fs');
const pug = require('pug');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const conversationId = 'a'.repeat(24);
const id = n => String(n).padStart(24, '0');
const message = n => ({
  _id: id(n), user_id: 'member', category: 'Test', tags: [], contentType: 'text',
  content: { text: `Message ${n}`, html: `<p>Message ${n}</p>` }, hideFromBot: false,
});
const source = fs.readFileSync('public/js/chat5_5.js', 'utf8');
const render = pug.compileFile('views/chat5_chat.pug');
let dom, doc, handlers, socket;
const entry = n => doc.querySelector(`.chat5-entry[data-id="${id(n)}"]`);
const flush = () => new Promise(resolve => setImmediate(resolve));

async function openChat({ start = id(2), saved = true, phone = false, canEdit = true } = {}) {
  const messages = saved ? [message(2), message(3)] : [];
  const messageWindow = {
    source: saved ? 'conversation5' : 'unsaved', loadedStart: saved ? 1 : 0, loadedEnd: saved ? 3 : 0,
    total: saved ? 3 : 0, hasMoreOlder: saved, batchSize: 25,
  };
  const html = render({
    loggedIn: true, bookmarks: [], htmlPaths: [], permissions: ['chat5'], csrfToken: 'test-token',
    canEditChatMessages: canEdit, conversationSource: messageWindow.source, messageWindow, messages,
    conversation: { _id: saved ? conversationId : 'NEW', title: 'Test', members: ['member'], tags: [],
      messages: saved ? [id(1), id(2), id(3)] : [],
      metadata: { model: 'test', maxMessages: 25, startMessageId: start, tools: [] } },
    chat_models: [], templates: [], personalities: [], responseTypes: [], trainingGroups: [{ groupId: 'training' }], ttsVoices: {},
  });
  dom = new JSDOM(html, { url: 'https://chat.test/chat5/chat/' + (saved ? conversationId : 'NEW'), runScripts: 'outside-only' });
  const win = dom.window;
  doc = win.document;
  await new Promise(resolve => win.addEventListener('load', resolve, { once: true }));
  handlers = new Map();
  socket = { on: (event, handler) => handlers.set(event, handler), emit: jest.fn() };
  win.io = () => socket;
  win.DOMPurify = createDOMPurify(win);
  win.toastui = { Editor: class { focus() {} getMarkdown() { return this.draft || ''; } } };
  win.matchMedia = () => ({ matches: phone });
  win.fetch = jest.fn(async url => {
    const [messageId, action] = url.split('/').slice(-2);
    return { ok: true, json: async () => ({ conversationId, messageId, action }) };
  });
  win.chat5MessageWindow = messageWindow;
  win.eval(source);
  doc.dispatchEvent(new win.Event('DOMContentLoaded'));
  return win;
}
afterEach(() => { dom?.window.close(); jest.useRealTimers(); });

test('one chat layout renders the saved boundary immediately above its card and keeps raw tools reachable', async () => {
  await openChat();
  expect(doc.querySelectorAll('#conversationContainer [data-chat5-start-message-id]')).toHaveLength(2);
  expect(doc.querySelectorAll('.chat5-start-divider')).toHaveLength(1);
  expect(entry(2).querySelector('article').previousElementSibling.textContent).toBe('Start message');
  expect(entry(2).querySelector('[aria-pressed="true"]').textContent).toBe('Selected start message');
  expect(doc.querySelector('#chat5Settings #startMessageId').value).toBe(id(2));
  expect(doc.querySelector('#chat5Settings #message_history').value).toBe([id(1), id(2), id(3)].join('\n'));
  expect(doc.querySelector('#completionWindow').getAttribute('aria-valuetext')).toBe('soonest');
  expect(doc.querySelector('#completionWindowNotice')).not.toBeNull();
  expect(doc.querySelector('[role="tablist"], .chat5-embed-button, #hideLastMessageBtn, #removeLastMessageBtn, #audio')).toBeNull();
  expect(doc.querySelector('#chat5Training .chat5-training-form')).not.toBeNull();
});

test('paginated and incoming cards support start selection and track settings broadcasts', async () => {
  const win = await openChat({ start: id(1) });
  expect(doc.querySelector('.chat5-start-divider')).toBeNull();
  doc.querySelector('[data-chat5-load-more]').click();
  const [, , ack] = socket.emit.mock.calls.at(-1);
  ack({ ok: true, messages: [{ ...message(1), hideFromBot: true }], meta: { total: 3, startIndex: 0, endIndex: 1 } });
  expect(entry(1).closest('details').open).toBe(true);
  expect(entry(1).firstElementChild.textContent).toBe('Start message');
  handlers.get('chat5-messages')({ id: conversationId, messages: [{ ...message(4), contentType: 'image', content: { image: 'test.png' } }] });
  entry(4).querySelector('[data-chat5-start-message-id]').click();
  await flush();
  expect(win.fetch).toHaveBeenCalledWith(`/chat5/chat/${conversationId}/messages/${id(4)}/start`,
    expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-CSRF-Token': 'test-token' }) }));
  expect(doc.querySelector('#startMessageId').value).toBe(id(4));
  expect(entry(4).querySelector('article').previousElementSibling.textContent).toBe('Start message');
  expect(entry(1).querySelector('.chat5-start-divider')).toBeNull();
  handlers.get('chat5-conversation-settings-updated')({ conversationId, metadata: { startMessageId: null } });
  expect(doc.querySelector('.chat5-start-divider')).toBeNull();
});

test('pointer release, movement, cancellation and ordinary clicks cannot trigger a guarded action', async () => {
  const win = await openChat();
  jest.useFakeTimers();
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  const button = entry(2).querySelector('[data-chat5-hold="hide"]');
  const pointer = (name, x = 0) => button.dispatchEvent(new win.PointerEvent(name, { bubbles: true, pointerId: 1, isPrimary: true, clientX: x }));
  button.click();
  for (const cancel of ['pointerup', 'pointermove', 'pointercancel', 'lostpointercapture']) {
    pointer('pointerdown');
    jest.advanceTimersByTime(300);
    pointer(cancel, 25);
    jest.advanceTimersByTime(800);
  }
  expect(win.fetch).not.toHaveBeenCalled();
  pointer('pointerdown');
  await jest.advanceTimersByTimeAsync(700);
  pointer('pointerup');
  button.click();
  expect(win.fetch).toHaveBeenCalledTimes(1);
  expect(entry(2).closest('.chat5-hidden-group')).not.toBeNull();
  expect(entry(2).querySelector('[data-chat5-hold="show"]')).not.toBeNull();
  handlers.get('chat5-message-changed')({ conversationId, messageId: id(2), action: 'show' });
  expect(entry(2).closest('.chat5-hidden-group')).toBeNull();
});

test('held keyboard removal targets one ID, clears its boundary and tolerates the room echo', async () => {
  const win = await openChat();
  jest.useFakeTimers();
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  const button = entry(2).querySelector('[data-chat5-hold="remove"]');
  const key = name => button.dispatchEvent(new win.KeyboardEvent(name, { bubbles: true, key: 'Enter' }));
  key('keydown'); key('keyup'); jest.advanceTimersByTime(800);
  expect(win.fetch).not.toHaveBeenCalled();
  key('keydown'); await jest.advanceTimersByTimeAsync(700);
  expect(win.fetch.mock.calls[0][0]).toBe(`/chat5/chat/${conversationId}/messages/${id(2)}/remove`);
  handlers.get('chat5-messages-removed')({ conversationId, removedIds: [id(2)] });
  expect(entry(2)).toBeNull();
  expect(entry(3)).not.toBeNull();
  expect(doc.getElementById('startMessageId').value).toBe('');
  expect(doc.getElementById('message_history').value).toBe([id(1), id(3)].join('\n'));
  expect(win.chat5MessageWindow).toMatchObject({ total: 2, loadedStart: 1, loadedEnd: 2 });
  expect(doc.querySelectorAll('.chat5-training-message-option')).toHaveLength(1);
  handlers.get('chat5-messages-removed')({ conversationId, removedIds: [id(1)] });
  expect(win.chat5MessageWindow).toMatchObject({ total: 1, loadedStart: 0, loadedEnd: 1 });
});

test('saved phone chat starts minimized and keeps the same editor and draft through toggles', async () => {
  const win = await openChat({ phone: true, canEdit: false });
  const toggle = doc.getElementById('chat5ComposerToggle');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  const editor = win.editor;
  toggle.click(); editor.draft = 'Still writing';
  toggle.click(); toggle.click();
  expect(win.editor).toBe(editor);
  expect(win.editor.getMarkdown()).toBe('Still writing');
  expect(entry(2).querySelector('[data-chat5-start-message-id]').disabled).toBe(true);
  expect(entry(2).querySelector('[data-chat5-hold]').disabled).toBe(true);
});

test('new chats expose quick settings, then gain saved-message controls on first delivery', async () => {
  const win = await openChat({ saved: false, start: '', phone: true });
  expect(doc.getElementById('chat5QuickSettings').open).toBe(true);
  expect(doc.getElementById('chat5ComposerBody').hidden).toBe(false);
  handlers.get('chat5-messages')({ id: conversationId, messages: [message(1)] });
  expect(doc.getElementById('chat5QuickSettings').open).toBe(false);
  expect(entry(1).querySelector('[data-chat5-start-message-id]').disabled).toBe(false);
  expect(doc.querySelector('#chat5TrainingContent').hidden).toBe(false);
  expect(doc.querySelector('#chat5Training [name="conversation_id"]').value).toBe(conversationId);
  expect(win.location.pathname).toBe('/chat5/chat/' + conversationId);
});

test('saving a training entry refreshes the dialog and preserves the current draft and loaded history', async () => {
  const win = await openChat();
  win.editor.draft = 'Unsaved reply';
  doc.querySelector('[data-chat5-load-more]').click();
  socket.emit.mock.calls.at(-1)[2]({ ok: true, messages: [message(1)], meta: { total: 3, startIndex: 0, endIndex: 1 } });
  const entries = doc.getElementById('chat5TrainingEntries').cloneNode(false);
  entries.dataset.usage = JSON.stringify({ [id(1)]: { promptCount: 1, entryIds: ['entry1'], groupIds: ['training'] } });
  entries.textContent = 'New training entry';
  const url = win.location.href + '?training_success=Training+entry+added.#chat5Training';
  win.fetch.mockResolvedValue({ ok: true, url, text: async () =>
    `<div id="chat5TrainingContent">${entries.outerHTML}${doc.getElementById('trainingGroupId').outerHTML}</div>` });
  const status = doc.getElementById('chat5TrainingStatus');
  status.scrollIntoView = jest.fn();
  const form = doc.querySelector('.chat5-training-form');
  doc.getElementById('trainingPrompt-' + id(1)).checked = true;
  doc.getElementById('trainingOutput-' + id(3)).checked = true;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(win.fetch.mock.calls[0][1].body.get('_csrf')).toBe('test-token');
  expect(status.textContent).toBe('Training entry added.');
  expect(doc.getElementById('chat5TrainingEntries').textContent).toBe('New training entry');
  expect(doc.querySelector('.chat5-training-message-option .chat5-training-usage-badge').textContent).toContain('prompt');
  expect(entry(1)).not.toBeNull();
  expect(win.editor.getMarkdown()).toBe('Unsaved reply');
});
