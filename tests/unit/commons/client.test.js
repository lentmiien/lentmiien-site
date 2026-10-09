const fs = require('fs');
const vm = require('vm');
const World = require('../../../public/commons/world');
function harness() {
  const elements = new Map(), sockets = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, open: false, textContent: '', value: '', content: 'csrf',
      classList: { add() {}, remove() {} }, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; },
      replaceChildren() {}, append() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
      click() { return this.handlers.click?.(); },
    });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element, querySelector: () => element('csrf'), querySelectorAll: () => [], createElement: () => element('generated'), addEventListener() {} },
    CommonsWorld: World, CommonsRenderer: class { update() {} }, addEventListener() {},
    Image: class { set src(_) { queueMicrotask(() => this.onload()); } },
    matchMedia: () => ({ matches: false }), setTimeout: () => 0, clearTimeout() {}, setInterval() {}, crypto,
    io() {
      const handlers = {}, calls = [];
      const socket = { connected: true, handlers, calls,
        io: { on() {}, reconnection() {} }, on(name, fn) { handlers[name] = fn; },
        emit() {}, timeout() { return { emit: (...args) => calls.push(args) }; },
        disconnect() { this.connected = false; handlers.disconnect?.('io client disconnect'); },
      };
      sockets.push(socket); return socket;
    },
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('public/commons/client.js', 'utf8'), context);
  const snapshot = { version: 1, clientRevision: World.CLIENT_REVISION, serverTime: Date.now(), savedAt: new Date(), online: 1, maxOnline: 10, blooms: 0,
    self: { ...World.SPAWN, id: 'villager-0', plot: 0, petals: 0, discoveries: [] }, players: [] };
  const join = socket => socket.handlers.joined(snapshot);
  return { element, sockets, join };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
test.each(['replacement', 'reconnect'])('a stale action timeout cannot retry or open a dialog after %s', async mode => {
  const h = harness(); await settle(); h.element('enter').click(); const old = h.sockets[0]; h.join(old);
  const action = h.element('interact').click(); expect(old.calls).toHaveLength(1);
  old.disconnect();
  if (mode === 'replacement') { h.element('enter').click(); h.join(h.sockets[1]); }
  else { old.connected = true; h.join(old); }
  old.calls[0][2](new Error('old timeout')); await action; await settle();
  expect(h.sockets.reduce((n, s) => n + s.calls.length, 0)).toBe(1);
  expect(h.element('interaction').open).toBe(false);
  h.element('interact').click();
  expect(h.sockets.reduce((n, s) => n + s.calls.length, 0)).toBe(2);
});
test('model markup renders as plain text and late replies cannot overwrite a new connection', async () => {
  const h = harness(); await settle(); h.element('enter').click(); const old = h.sockets[0]; h.join(old);
  h.element('npc-text').value = 'hello';
  const first = h.element('npc-form').handlers.submit({ preventDefault() {} });
  old.calls[0][2](null, { text: '<img src=x onerror=alert(1)>', mode: 'llm' }); await first;
  expect(h.element('npc-answer').textContent).toBe('AI reply\n<img src=x onerror=alert(1)>');
  expect(h.element('npc-answer')).not.toHaveProperty('innerHTML');
  const second = h.element('npc-form').handlers.submit({ preventDefault() {} });
  old.disconnect(); h.element('enter').click(); h.join(h.sockets[1]);
  h.element('npc-answer').textContent = 'New conversation';
  old.calls[1][2](null, { text: 'late private reply', mode: 'llm' }); await second;
  expect(h.element('npc-answer').textContent).toBe('New conversation');
});
test('completed quest copy and empty nearby state describe current progress', async () => {
  const h = harness(); await settle(); h.element('enter').click(); const socket = h.sockets[0];
  const snapshot = { version: 1, clientRevision: World.CLIENT_REVISION, serverTime: Date.now(), savedAt: new Date(), online: 1, maxOnline: 10, blooms: 3,
    self: { ...World.SPAWN, x: 50, y: 35, id: 'villager-0', plot: 0, petals: 0, discoveries: ['stone-0', 'stone-1', 'stone-2'], lantern: true, decorated: false }, players: [] };
  socket.handlers.joined(snapshot);
  expect(h.element('quest-guidance').textContent).toContain('Return to your cottage');
  expect(h.element('interact').disabled).toBe(true); expect(h.element('interact').textContent).toBe('Nothing in reach');
  snapshot.self.decorated = true; socket.handlers.state(snapshot);
  expect(h.element('quest-guidance').textContent).toContain('Your lantern is at home');
});
test('stale corrected client revision closes the socket without changing save version', async () => {
  const h = harness(); await settle(); h.element('enter').click(); const socket = h.sockets[0];
  socket.handlers.joined({ version: 1, clientRevision: 'future' });
  expect(socket.connected).toBe(false); expect(h.element('status').textContent).toContain('Reload');
});
