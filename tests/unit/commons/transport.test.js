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
beforeEach(async () => { clients = []; preview = await createPreview(); });
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
