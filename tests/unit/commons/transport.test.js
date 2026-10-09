jest.mock('../../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const WebSocket = require('ws');
const { createPreview } = require('../../../scripts/preview-commons');
const { PLAY, TALK } = require('../../../utils/commonsAuthorizationPolicy');
const World = require('../../../public/commons/world');
let preview, clients;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for transport state');
    await pause(15);
  }
}
async function login(resident) {
  const response = await fetch(preview.url + '/__preview/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resident }) });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(preview.url + '/commons', { headers: { cookie } })).text();
  return { cookie, csrf: html.match(/name="csrf-token" content="([^"]+)"/)[1] };
}
async function connect(auth, { path = '/commons/socket.io', namespace = '/commons', origin = preview.url } = {}) {
  const ws = new WebSocket(preview.url.replace('http:', 'ws:') + path + '/?EIO=4&transport=websocket', { headers: { Origin: origin, Cookie: auth.cookie } });
  clients.push(ws);
  const packets = []; let failure;
  ws.on('error', error => { failure = error; });
  ws.on('message', raw => {
    const packet = raw.toString(); packets.push(packet);
    if (packet === '2') ws.send('3');
    if (packet.startsWith('0')) ws.send(`40${namespace ? namespace + ',' : ''}${JSON.stringify({ csrf: auth.csrf })}`);
  });
  await until(() => failure || packets.some(p => p.startsWith('40') || p.startsWith('44')));
  if (failure) throw failure;
  let sequence = 0;
  const events = name => packets.filter(p => p.startsWith('42/commons,')).map(p => JSON.parse(p.slice(11))).filter(event => event[0] === name).map(event => event[1]);
  return { ws, packets, events, async command(name, payload) {
    const id = ++sequence, prefix = `43/commons,${id}`;
    ws.send(`42/commons,${id}${JSON.stringify([name, payload])}`);
    await until(() => packets.some(p => p.startsWith(prefix)));
    return JSON.parse(packets.find(p => p.startsWith(prefix)).slice(prefix.length))[0];
  } };
}
beforeEach(async () => { clients = []; preview = await createPreview({ v12: true }); });
afterEach(async () => { for (const client of clients) client.terminate(); await preview.stop(); });
test('normal HTTP/client script and default Site transport coexist with guarded Commons bootstrap', async () => {
  const auth = await login(2);
  expect((await fetch(preview.url + '/socket.io/socket.io.js')).status).toBe(200);
  const site = await connect(auth, { path: '/socket.io', namespace: '' });
  const game = await connect(auth); await until(() => game.events('joined').length);
  await pause(1200); // Engine.IO unknown-upgrade cleanup must not kill either transport.
  expect(site.ws.readyState).toBe(WebSocket.OPEN); expect(game.events('state').length).toBeGreaterThan(2);
  expect((await fetch(preview.url + '/commons', { headers: { cookie: auth.cookie } })).status).toBe(200);
  const wrongNamespace = await connect(auth, { namespace: '' });
  expect(wrongNamespace.packets.some(p => p.startsWith('44') && p.includes('UNAUTHORIZED'))).toBe(true);
  await expect(connect(auth, { origin: 'https://attacker.test' })).rejects.toThrow(/Unexpected server response: 4\d\d/);
  const wrongCsrf = await connect({ ...auth, csrf: 'invalid' });
  expect(wrongCsrf.packets.some(p => p.includes('UNAUTHORIZED'))).toBe(true);
});
test('two real sockets isolate cottages, survive takeover and restore the owner after disconnect', async () => {
  const a = await login(2), b = await login(3);
  const first = await connect(a), second = await connect(b);
  await until(() => first.events('joined').length && second.events('joined').length);
  const user = '2'.padStart(24, '0');
  const player = () => preview.room.state.players.find(p => p.userId === user);
  Object.assign(player(), { x: World.homes[0].x, y: World.homes[0].y + 1.2 });
  expect(await first.command('action', { id: crypto.randomUUID(), target: 'home-0' })).toHaveProperty('message');
  await until(() => second.events('state').at(-1)?.players.length === 1);
  expect(JSON.stringify(second.events('state').at(-1))).not.toContain(user);
  expect(second.events('state').at(-1).players[0]).not.toHaveProperty('petals');
  Object.assign(preview.room.state.players[1], { x: 7, y: 8.2 });
  expect(await second.command('action', { id: crypto.randomUUID(), target: 'home-0' })).toHaveProperty('error', 'PRIVATE_HOUSE');
  await pause(1550);
  const replacement = await connect(a); await until(() => replacement.events('joined').length);
  expect(first.events('closed')).toContainEqual({ code: 'TAKEN_OVER' });
  expect(preview.room.connections.size).toBe(2);
  first.ws.terminate(); await pause(50); expect(preview.room.connections.size).toBe(2);
  expect(replacement.events('joined')[0].self).toMatchObject({ plot: 0, scene: 'home' });
  replacement.ws.close(); second.ws.close(); await until(() => preview.room.state === null);
  await pause(1550);
  const rejoin = await connect(a); await until(() => rejoin.events('joined').length);
  expect(rejoin.events('joined')[0].self).toMatchObject({ plot: 0, scene: 'home' });
});
test('formerly authorized play grant removal stops snapshots and the next mutation', async () => {
  const client = await connect(await login(2)); await until(() => client.events('joined').length);
  preview.grants.set('Preview 2', [TALK]);
  expect(await client.command('emote', 'Hello!')).toHaveProperty('error', 'UNAUTHORIZED');
  await until(() => preview.room.connections.size === 0);
  const count = client.events('state').length; await pause(200);
  expect(client.events('state')).toHaveLength(count);
});
test('idle sockets lose authority after session-store revocation', async () => {
  const client = await connect(await login(2)); await until(() => client.events('joined').length);
  await new Promise(resolve => preview.store.clear(resolve));
  await until(() => client.events('closed').length);
  expect(client.events('closed')).toContainEqual({ code: 'UNAUTHORIZED' });
  await until(() => preview.room.state === null);
});
test('NPC requests stay private and a removed talk grant discards a pending provider reply', async () => {
  await preview.stop();
  const calls = []; let finish;
  preview = await createPreview({ provider: messages => { calls.push(messages); return new Promise(resolve => { finish = resolve; }); } });
  const first = await connect(await login(2)), second = await connect(await login(3));
  await until(() => first.events('joined').length && second.events('joined').length);
  const reply = first.command('talk', { text: 'private first account text' }); await until(() => finish);
  preview.grants.set('Preview 2', [PLAY]); finish('<img src=x onerror=alert(1)>');
  expect(await reply).toHaveProperty('error', 'UNAUTHORIZED');
  expect(JSON.stringify(second.packets)).not.toMatch(/private first|onerror/);
  const otherReply = second.command('talk', { text: 'second account' }); await until(() => calls.length === 2);
  expect(JSON.stringify(calls[1])).not.toMatch(/private first|onerror/);
  finish('Only the second account'); expect(await otherReply).toEqual({ mode: 'llm', text: 'Only the second account' });
}, 10000);
async function privateRequest(auth, client, path, body, extraHeaders = {}) {
  return fetch(preview.url + '/commons/api/' + path, { method: body ? 'POST' : 'GET',
    headers: { cookie: auth.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf,
      'X-Commons-Connection': client.events('joined').at(-1).connection, ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('real HTTP panels require current owner, proximity, scene policy and CSRF; no private socket broadcasts', async () => {
  const auth = await login(2), outsider = await login(1);
  const client = await connect(auth), admin = await connect(outsider);
  await until(() => client.events('joined').length && admin.events('joined').length);
  const player = preview.room.state.players.find(p => p.userId === '2'.padStart(24, '0'));
  const other = preview.room.state.players.find(p => p.userId === '1'.padStart(24, '0'));
  Object.assign(player, { x: 30, y: 22 });
  let response = await privateRequest(auth, client, 'quests'); expect(response.status).toBe(200);
  const board = await response.json(); expect(board.rows).toHaveLength(2); expect(response.headers.get('cache-control')).toContain('no-store');
  const taskId = board.rows[0].taskId;
  expect((await privateRequest(auth, client, 'quests/done', { taskId }, { 'X-CSRF-Token': '' })).status).toBe(403);
  expect((await privateRequest(auth, client, 'quests/done', { taskId }, { Origin: 'https://foreign.invalid' })).status).toBe(403);
  expect((await privateRequest(auth, client, 'quests/done', { taskId })).status).toBe(200);
  expect((await privateRequest(auth, client, 'quests/done', { taskId })).status).toBe(200);
  expect((await (await privateRequest(auth, client, 'quests')).json()).rows).toHaveLength(1);
  expect((await privateRequest(outsider, client, 'quests')).status).toBe(403);
  Object.assign(player, { scene: 'home', x: 8, y: 5 });
  const page = await (await privateRequest(auth, client, 'diary')).json();
  const input = { date: page.today, text: '<script>Synthetic owner secret</script>', revision: 0 };
  expect((await privateRequest(auth, client, 'diary', input)).status).toBe(200);
  expect((await privateRequest(auth, client, 'diary', input)).status).toBe(409);
  expect((await privateRequest(auth, client, 'diary?ownerId=000000000000000000000001')).status).toBe(400);
  Object.assign(other, { scene: 'home', x: 8, y: 5 });
  expect((await (await privateRequest(outsider, admin, 'diary')).json()).entry.text).toBe('');
  expect(JSON.stringify(admin.events('state'))).not.toContain('Synthetic owner secret');
  Object.assign(other, { scene: 'village', x: 44, y: 19.6 });
  expect(await admin.command('action', { id: crypto.randomUUID(), target: 'shelter' })).toHaveProperty('error', 'FORBIDDEN');
  expect((await privateRequest(outsider, admin, 'stock')).status).toBe(403);
  Object.assign(player, { scene: 'village', x: 44, y: 19.6 });
  expect(await client.command('action', { id: crypto.randomUUID(), target: 'shelter' })).toHaveProperty('message');
  Object.assign(preview.room.state.players.find(p => p.userId === player.userId), { x: 3, y: 5 });
  response = await privateRequest(auth, client, 'stock'); expect(response.status).toBe(200); expect((await response.json()).rows.length).toBeGreaterThan(3);
  expect(JSON.stringify(admin.events('state'))).not.toMatch(/targetAmount|person-meals|equipment-stock/);
  preview.users.get('2'.padStart(24, '0')).type_user = 'user';
  expect((await privateRequest(auth, client, 'stock')).status).toBe(403);
  expect(preview.room.state.players.find(p => p.userId === player.userId).scene).toBe('village');
  expect(client.events('private-reset').length).toBeGreaterThan(0);
}, 15000);
test('in-flight Hall statistics are suppressed after role change and after same-account takeover', async () => {
  const auth = await login(1), client = await connect(auth); await until(() => client.events('joined').length);
  const principal = preview.users.get('1'.padStart(24, '0'));
  Object.assign(preview.room.state.players[0], { scene: 'hall', x: 9, y: 5 });
  let finish, started = false;
  preview.fixtures.panels.statistics = () => { started = true; return new Promise(resolve => { finish = resolve; }); };
  const pending = privateRequest(auth, client, 'statistics'); await until(() => started);
  principal.type_user = 'user'; finish({ rows: [{ title: 'Synthetic forbidden result', value: 100 }] });
  const response = await pending; expect(response.status).toBe(403); expect(await response.text()).not.toContain('Synthetic forbidden result');
  principal.type_user = 'admin'; await pause(1550);
  Object.assign(preview.room.state.players[0], { scene: 'hall', x: 9, y: 5 }); started = false;
  const delayed = privateRequest(auth, client, 'statistics'); await until(() => started);
  const replacement = await connect(auth); await until(() => replacement.events('joined').length);
  finish({ rows: [{ title: 'Synthetic old generation', value: 100 }] });
  expect(await (await delayed).text()).not.toContain('Synthetic old generation');
  expect((await privateRequest(auth, client, 'diary')).status).toBe(403);
}, 15000);
test('private parser bounds multilingual text, rejects excessive and malformed JSON with generic no-store errors', async () => {
  const auth = await login(2), client = await connect(auth); await until(() => client.events('joined').length);
  Object.assign(preview.room.state.players[0], { scene: 'home', x: 8, y: 5 });
  const day = (await (await privateRequest(auth, client, 'diary')).json()).today;
  expect((await privateRequest(auth, client, 'diary', { date: day, revision: 0, text: '日'.repeat(10000) })).status).toBe(200);
  expect((await privateRequest(auth, client, 'diary', { date: day, revision: 1, text: '日'.repeat(25000) })).status).toBe(413);
  const malformed = await fetch(preview.url + '/commons/api/diary', { method: 'POST', headers: { cookie: auth.cookie, 'Content-Type': 'application/json' }, body: '{broken' });
  expect(malformed.status).toBe(400); expect(await malformed.json()).toEqual({ error: 'INVALID_INPUT' });
  expect(malformed.headers.get('cache-control')).toContain('no-store');
});
test('specified immutable admin identity enters Shelter but loses access when its current role changes', async () => {
  const id = require('../../../services/commons/policy').SHELTER_ADMIN_ID;
  const principal = { _id: id, name: 'Synthetic specified account', type_user: 'admin' };
  preview.users.set(id, principal); preview.grants.set(principal.name, [PLAY, 'emergencystock']);
  const auth = await login(id), client = await connect(auth); await until(() => client.events('joined').length);
  Object.assign(preview.room.state.players[0], { x: 44, y: 19.6 });
  expect(await client.command('action', { id: crypto.randomUUID(), target: 'shelter' })).toHaveProperty('message');
  Object.assign(preview.room.state.players[0], { x: 3, y: 5 });
  expect((await privateRequest(auth, client, 'stock')).status).toBe(200);
  principal.type_user = 'user'; expect((await privateRequest(auth, client, 'stock')).status).toBe(403);
  expect(preview.room.state.players[0].scene).toBe('village');
});
test('private adapter failures expose only finite public codes and log actionable redacted context', async () => {
  const auth = await login(2), client = await connect(auth); await until(() => client.events('joined').length);
  Object.assign(preview.room.state.players[0], { scene: 'shelter', x: 3, y: 5 });
  preview.fixtures.panels.stock = async () => { throw Object.assign(new Error('Synthetic private source detail'), { code: 'PRIVATE_SOURCE_DETAIL' }); };
  let response = await privateRequest(auth, client, 'stock');
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'UNAVAILABLE' });
  preview.fixtures.panels.stock = async () => { throw Object.assign(new Error('Bound exceeded'), { code: 'SUMMARY_UNAVAILABLE' }); };
  response = await privateRequest(auth, client, 'stock');
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'SUMMARY_UNAVAILABLE' });
  const warnings = require('../../../utils/logger').warning.mock.calls;
  expect(warnings).toContainEqual(['Commons private operation failed', { category: 'commons.private', metadata: { operation: 'stock', code: 'SUMMARY_UNAVAILABLE' } }]);
  expect(JSON.stringify(warnings)).not.toMatch(/PRIVATE_SOURCE_DETAIL|Synthetic private source detail/);
});
