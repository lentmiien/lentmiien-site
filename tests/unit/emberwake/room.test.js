const { Room, CHECKPOINT_MS } = require('../../../services/emberwake/room');
const S = require('../../../services/emberwake/state');
const { problem } = require('../../../services/emberwake/repository');

const A = '1'.repeat(24),
  B = '2'.repeat(24);
function fixture() {
  let now = 1000,
    raw = S.encode(S.initial(52)),
    paused = false,
    revision = 0,
    savedAt = 0,
    last;
  const repo = {
    writes: 0,
    fail: false,
    lostReply: false,
    status: async () => ({ paused, savedAt }),
    async acquire(allowPaused) {
      if (paused && !allowPaused) throw problem('MAINTENANCE');
      return { data: S.decode(raw), paused, revision, savedAt, until: now + 90000 };
    },
    async save(op) {
      if (this.fail) throw Error('Fixture storage offline');
      if (last?.id !== op.id) {
        if (op.revision !== revision) throw problem('LEASE_LOST');
        raw = op.raw;
        paused = op.paused;
        revision++;
        savedAt = now;
        this.writes++;
        last = op;
      }
      if (this.lostReply) {
        this.lostReply = false;
        throw Error('Fixture lost acknowledgement');
      }
      return { revision, savedAt, until: now + 90000 };
    }
  };
  const log = { notice: jest.fn(), warning: jest.fn(), error: jest.fn() };
  const create = () => new Room({ repository: repo, automatic: false, now: () => now, log });
  return { repo, log, create, room: create(), advance: ms => (now += ms), read: () => S.decode(raw) };
}
function sailor(ticket) {
  return {
    ticket,
    live: true,
    validUntil: Infinity,
    alive() {
      return this.live;
    },
    close: jest.fn(function () {
      this.live = false;
    }),
    send: jest.fn()
  };
}
test('a later access takes control; stale inputs, actions and departures cannot move or disconnect the replacement', async () => {
  const { room, repo } = fixture(),
    one = sailor(1),
    two = sailor(2);
  const first = await room.join(A, one);
  room.sea.online.get(A).state.inventory.log = 4;
  const second = await room.join(A, two);
  expect(second.number).toBe(first.number);
  expect(second.state.inventory.log).toBe(4);
  expect(one.close).toHaveBeenCalledWith('TAKEN_OVER');
  expect(() => room.action(A, one, { op: 'home' })).toThrow('SESSION_ENDED');
  await room.leave(A, one);
  expect(room.members.size).toBe(1);
  expect(repo.writes).toBe(0);
  await expect(room.join(A, sailor(1))).rejects.toThrow('SESSION_ENDED');
  expect(room.members.get(A)).toBe(two);
  await room.leave(A, two);
  expect(repo.writes).toBe(1);
  expect(room.sea).toBe(null);
});
test('periodic, departure and shutdown writes preserve location, pack and edits; time stands still in an empty harbor', async () => {
  const { room, create, repo, read, advance } = fixture(),
    a = sailor(1),
    b = sailor(2);
  await room.join(A, a);
  await room.join(B, b);
  const g = room.sea.online.get(A);
  g.state.inventory.log = 2;
  g.state.player.x += 2;
  room.sea.world.set(2, 72, 2, require('../../../multiplayer/emberwake/js/data').ids.sand);
  const location = g.state.player.x;
  room.nextSave = CHECKPOINT_MS;
  advance(CHECKPOINT_MS);
  room.tick();
  await room.tail;
  expect(repo.writes).toBe(1);
  expect(read().crew[0].data.inventory.log).toBe(2);
  expect(read().edits['0,0']).toBeDefined();
  await room.leave(A, a);
  expect(read().crew[0].data.player.x).toBeCloseTo(location);
  await room.shutdown();
  expect(b.close).toHaveBeenCalledWith('SERVER_STOPPING');
  const prior = read();
  advance(24 * 3600000);
  room.tick();
  expect(read().time).toBe(prior.time);
  expect(repo.writes).toBe(3);
  const r = create(),
    restored = await r.join(A, sailor(3));
  expect(restored.state.time).toBe(prior.time);
  expect(restored.state.player.x).toBeCloseTo(location);
});
test('admin pause evicts everyone, checkpoints once, rejects late actions and stays closed across process replacement until resumed', async () => {
  const { room, create, read, repo } = fixture(),
    a = sailor(1),
    b = sailor(2);
  await room.join(A, a);
  await room.join(B, b);
  room.sea.online.get(B).state.inventory.pearl = 7;
  expect((await room.maintenance(true)).paused).toBe(true);
  expect([a, b].every(s => s.close.mock.calls[0][0] === 'MAINTENANCE')).toBe(true);
  expect(() => room.input(B, b, { seq: 1, keys: 1, yaw: 0, pitch: 0 })).toThrow('SESSION_ENDED');
  expect(read().crew[1].data.inventory.pearl).toBe(7);
  expect(repo.writes).toBe(1);
  const r = create();
  expect((await r.status()).paused).toBe(true);
  await expect(r.join(A, sailor(3))).rejects.toThrow('MAINTENANCE');
  expect((await r.maintenance(false)).paused).toBe(false);
  expect((await r.join(B, sailor(4))).state.inventory.pearl).toBe(7);
});
test.each(['fail', 'lostReply'])(
  'an interrupted checkpoint (%s) freezes admissions and retries without duplicate awards or losing the pause',
  async mode => {
    const { room, repo, log, read, create } = fixture(),
      a = sailor(1);
    await room.join(A, a);
    room.sea.online.get(A).state.inventory.shell = 7;
    repo[mode] = true;
    await expect(room.maintenance(true)).rejects.toThrow('SAVE_UNAVAILABLE');
    expect(log.error).toHaveBeenCalled();
    expect(room.blocked).toBe(true);
    await expect(room.join(B, sailor(2))).rejects.toThrow('SAVE_UNAVAILABLE');
    repo.fail = false;
    await room.recover();
    expect(room.blocked).toBe(false);
    expect(read().crew[0].data.inventory.shell).toBe(7);
    expect(repo.writes).toBe(1);
    expect((await create().status()).paused).toBe(true);
  }
);
test('expired or revoked member stops receiving frames while the remaining crew keeps playing', async () => {
  const { room, advance } = fixture(),
    a = sailor(1),
    b = sailor(2);
  await room.join(A, a);
  await room.join(B, b);
  a.validUntil = 1100;
  advance(101);
  room.tick();
  await room.tail;
  expect(a.close).toHaveBeenCalledWith('SESSION_ENDED');
  expect(a.send).not.toHaveBeenCalled();
  expect(b.send).toHaveBeenCalled();
  expect(room.members.size).toBe(1);
  expect(room.blocked).toBe(false);
});
test('eight simultaneous connections fit, and another access by an existing sailor can take over a full world', async () => {
  const { room } = fixture();
  for (let i = 1; i <= 8; i++) await room.join(i.toString(16).padStart(24, '0'), sailor(i));
  await expect(room.join(B, sailor(9))).rejects.toThrow('ROOM_FULL');
  await expect(room.join('1'.padStart(24, '0'), sailor(10))).resolves.toHaveProperty('number', 1);
});
test('a shutdown concurrent with a slow acquire cannot admit a late connection', async () => {
  const { room, repo } = fixture(),
    acquire = repo.acquire.bind(repo);
  let go;
  repo.acquire = async p => {
    await new Promise(r => {
      go = r;
    });
    return acquire(p);
  };
  const joining = room.join(A, sailor(1));
  await Promise.resolve();
  const stopping = room.shutdown();
  go();
  await expect(joining).rejects.toThrow();
  await stopping;
  expect(room.members.size).toBe(0);
  expect(room.sea).toBe(null);
});
test('a missing write acknowledgement during active play retains later in-memory edits before closing the harbor', async () => {
  const { room, repo, read } = fixture(),
    a = sailor(1);
  await room.join(A, a);
  const g = room.sea.online.get(A),
    original = repo.save.bind(repo);
  repo.save = async op => {
    repo.save = original;
    const response = await original(op);
    g.state.inventory.amber = 9;
    throw Object.assign(new Error('Synthetic acknowledgement failure'), { response });
  };
  await expect(room.flush(false)).rejects.toThrow('SAVE_UNAVAILABLE');
  expect(a.close).toHaveBeenCalledWith('SAVE_UNAVAILABLE');
  await room.recover();
  expect(read().crew[0].data.inventory.amber).toBe(9);
  expect(repo.writes).toBe(2);
});
