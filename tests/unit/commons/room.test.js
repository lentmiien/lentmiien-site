const { CommonsRoom } = require('../../../services/commons/room');
const World = require('../../../public/commons/world');
const id = n => String(n).padStart(24, '0');
const request = (target, n = 1) => ({ target, id: `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000` });
function harness(maxOnline = 10) {
  let time = Date.UTC(2026, 9, 8, 3), persisted = { version: 1, revision: 0, players: [], blooms: 0, leaseUntil: new Date(time + 20000) };
  const repository = {
    acquire: jest.fn(async () => structuredClone({ ...persisted, leaseUntil: new Date(time + 20000) })),
    save: jest.fn(async state => {
      persisted = structuredClone({ ...state, revision: state.revision + 1, leaseUntil: new Date(time + 20000), savedAt: new Date(time) });
      return structuredClone(persisted);
    }),
  };
  const room = new CommonsRoom({ repository, maxOnline, now: () => time, log: { error: jest.fn(), warning: jest.fn() } });
  const connection = token => ({ token, validUntil: time + 100000, close: jest.fn() });
  const locate = (user, target) => { const l = World.locations.find(x => x.id === target); Object.assign(room.state.players.find(p => p.userId === user), { x: l.x, y: l.y + (l.sprite < 6 ? 1.2 : 0), scene: 'village' }); };
  return { room, repository, connection, locate, advance: ms => { time += ms; }, persisted: () => persisted };
}
test('authoritative geometry, speed, collision, expiry and finite bounds', () => {
  const p = { ...World.SPAWN };
  World.move(p, { x: 1, y: 1, at: 100 }, 10, 100);
  expect(Math.hypot(p.x - 32, p.y - 25)).toBeCloseTo(.4);
  const old = { ...p }; World.move(p, { x: 1, y: 0, at: 0 }, .1, 301); expect(p).toEqual(old);
  expect(World.walkable(NaN, 1)).toBe(false); expect(World.walkable(32, 16)).toBe(false);
  expect(World.walkable(-1, 20)).toBe(false); expect(World.walkable(12, 4, 'home')).toBe(false);
});
test('joins persist plots and cap admits takeovers without stale disconnect writes', async () => {
  const h = harness(1), a = h.connection('a'), b = h.connection('b');
  await h.room.join(id(1), a);
  await expect(h.room.join(id(2), h.connection('c'))).rejects.toMatchObject({ code: 'ROOM_FULL' });
  await h.room.join(id(1), b); expect(a.close).toHaveBeenCalledWith('TAKEN_OVER');
  const saves = h.repository.save.mock.calls.length;
  await h.room.leave(id(1), 'a'); expect(h.repository.save).toHaveBeenCalledTimes(saves);
  expect(h.room.snapshot(id(1), 'b').self.plot).toBe(0);
  expect(() => h.room.input(id(1), 'a', { x: 1, y: 0 })).toThrow('SESSION_EXPIRED');
});
test('simultaneous last-slot joins are serialized', async () => {
  const h = harness(1);
  const results = await Promise.allSettled([h.room.join(id(1), h.connection('a')), h.room.join(id(2), h.connection('b'))]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(h.persisted().players).toHaveLength(1);
});
test('checkpoint, disconnect and restart resume facing/location without unload', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a'));
  h.room.input(id(1), 'a', { x: 1, y: 0 }); h.advance(100); h.room.tick();
  await h.room.checkpoint(); expect(h.persisted().players[0].x).toBeCloseTo(32.4);
  await h.room.leave(id(1), 'a'); expect(h.room.state).toBeNull();
  const other = new CommonsRoom({ repository: h.repository, now: h.room.now });
  const snapshot = await other.join(id(1), { ...h.connection('b'), validUntil: h.room.now() + 10000 });
  expect(snapshot.self.x).toBeCloseTo(32.4); expect(snapshot.self.facing).toBe('right');
});
test('private houses and inventory never appear in another player snapshot', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a')); await h.room.join(id(2), h.connection('b'));
  h.locate(id(2), 'home-0'); await expect(h.room.action(id(2), 'b', request('home-0'))).rejects.toMatchObject({ code: 'PRIVATE_HOUSE' });
  h.locate(id(1), 'home-0'); await h.room.action(id(1), 'a', request('home-0'));
  const snapshot = h.room.snapshot(id(2), 'b');
  expect(snapshot.players).toHaveLength(1); expect(snapshot.players[0].plot).toBe(1);
  expect(JSON.stringify(snapshot)).not.toContain(id(1));
  expect(snapshot.players[0]).not.toHaveProperty('petals'); expect(snapshot).not.toHaveProperty('receipts');
  expect(h.room.snapshot(id(1), 'a').players).toEqual([]);
});
test('garden races/replays are durable and do not multiply rewards', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a')); h.locate(id(1), 'garden-0');
  const results = await Promise.all([h.room.action(id(1), 'a', request('garden-0')), h.room.action(id(1), 'a', request('garden-0'))]);
  expect(results[1].duplicate).toBe(true); expect(h.persisted().blooms).toBe(1);
  await h.room.action(id(1), 'a', request('garden-0', 2)); expect(h.persisted().players[0].petals).toBe(1);
  h.advance(86400000); h.room.state.leaseUntil = new Date(Date.now() + 86400000 * 365); h.room.authorize(id(1), 'a', Date.now() + 86400000 * 365);
  await h.room.action(id(1), 'a', request('garden-0', 3)); expect(h.persisted().players[0].petals).toBe(2);
});
test('explore, garden, craft, decorate loop persists and bounds inventory', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a'));
  for (let i = 0; i < 3; i++) for (const kind of ['stone', 'garden']) { const target = `${kind}-${i}`; h.locate(id(1), target); await h.room.action(id(1), 'a', request(target, i * 2 + (kind === 'stone' ? 1 : 2))); }
  h.locate(id(1), 'workshop'); await h.room.action(id(1), 'a', request('workshop', 7));
  expect(h.persisted().players[0]).toMatchObject({ lantern: true, petals: 0 });
  h.locate(id(1), 'home-0'); await h.room.action(id(1), 'a', request('home-0', 8));
  await h.room.action(id(1), 'a', request('decorate', 9)); expect(h.persisted().players[0].decorated).toBe(true);
});
test('failed action save closes room without acknowledging success or exposing changed state', async () => {
  const h = harness(), c = h.connection('a'); await h.room.join(id(1), c); h.locate(id(1), 'garden-0');
  h.repository.save.mockRejectedValueOnce(new Error('db failed'));
  await expect(h.room.action(id(1), 'a', request('garden-0'))).rejects.toMatchObject({ code: 'SAVE_UNAVAILABLE' });
  expect(c.close).toHaveBeenCalledWith('SAVE_UNAVAILABLE'); expect(h.persisted().blooms).toBe(0); expect(h.room.state).toBeNull();
});
test('expired lease/session, foreign fields and malformed inputs fail closed', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a'));
  for (const value of [{ x: 100, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: 0, userId: id(2) }, null]) expect(() => h.room.input(id(1), 'a', value)).toThrow();
  await expect(h.room.action(id(1), 'a', { ...request('garden-0'), owner: id(2) })).rejects.toThrow('INVALID_ACTION');
  await expect(h.room.action(id(1), 'a', request('garden-0'))).rejects.toThrow('TOO_FAR');
  h.advance(21000); h.room.tick(); expect(h.room.state).toBeNull();
});
test('Tokyo real-time clock has stable date boundary and legible night', () => {
  expect(World.clock(Date.UTC(2026, 0, 1, 15))).toMatchObject({ day: '2026-01-02', hour: 0, phase: 'Night', darkness: .4 });
  expect(World.clock(Date.UTC(2026, 0, 1, 3)).darkness).toBe(0);
});
module.exports = { harness, id, request };
test('all twelve plots are permanent and a thirteenth resident cannot allocate another', async () => {
  const h = harness();
  for (let i = 1; i <= 12; i++) { await h.room.join(id(i), h.connection(String(i))); await h.room.leave(id(i), String(i)); }
  await expect(h.room.join(id(13), h.connection('13'))).rejects.toThrow('VILLAGE_FULL');
  expect(h.persisted().players.map(p => p.plot)).toEqual(Array.from({ length: 12 }, (_, n) => n));
});
test('checkpoint save holds simulation and duplicate receipts survive a room restart', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a')); h.locate(id(1), 'garden-0');
  await h.room.action(id(1), 'a', request('garden-0'));
  await h.room.leave(id(1), 'a'); await h.room.join(id(1), h.connection('b'));
  expect(await h.room.action(id(1), 'b', request('garden-0'))).toMatchObject({ duplicate: true });
  let finish;
  const original = h.repository.save.getMockImplementation();
  h.repository.save.mockImplementationOnce(state => new Promise(resolve => { finish = async () => resolve(await original(state)); }));
  h.room.input(id(1), 'b', { x: 1, y: 0 }); const before = h.room.state.players[0].x;
  const saving = h.room.checkpoint(); await Promise.resolve(); h.advance(100); h.room.tick();
  expect(h.room.state.players[0].x).toBe(before); await finish(); await saving;
});
test('configured maximum ten online refuses an eleventh while preserving saved members', async () => {
  const h = harness();
  for (let n = 1; n <= 10; n++) await h.room.join(id(n), h.connection(String(n)));
  await expect(h.room.join(id(11), h.connection('11'))).rejects.toThrow('ROOM_FULL');
  await h.room.leave(id(1), '1'); await h.room.join(id(11), h.connection('11'));
  expect(h.room.connections.size).toBe(10); expect(h.persisted().players).toHaveLength(11);
});
test('a save reply arriving after lease expiry cannot resurrect the closed room', async () => {
  const h = harness(); await h.room.join(id(1), h.connection('a'));
  let resolve;
  h.repository.save.mockImplementationOnce(state => new Promise(r => { resolve = () => r({ ...state, leaseUntil: new Date(h.room.now() + 20000) }); }));
  const pending = h.room.checkpoint(); await Promise.resolve(); h.advance(21000); h.room.tick();
  expect(h.room.state).toBeNull(); resolve(); await expect(pending).rejects.toThrow('SAVE_UNAVAILABLE');
  expect(h.room.state).toBeNull(); expect(h.room.connections.size).toBe(0);
});
