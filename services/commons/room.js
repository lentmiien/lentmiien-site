const World = require('../../public/commons/world');
const logger = require('../../utils/logger');
class CommonsError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new CommonsError(code); };
class CommonsRoom {
  constructor({ repository, maxOnline = 10, now = Date.now, log = logger } = {}) {
    Object.assign(this, { repository, maxOnline, now, log });
    this.state = null;
    this.connections = new Map();
    this.tail = Promise.resolve();
    this.busy = false;
    this.failed = false;
    this.lastTick = now();
    this.lastLeaseWarning = -Infinity;
  }
  serial(fn) {
    const operation = this.tail.then(async () => {
      this.busy = true;
      try { return await fn(); } finally { this.busy = false; }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  current(userId, token) {
    const connection = this.connections.get(userId);
    if (!connection || connection.token !== token || connection.validUntil <= this.now()) fail('SESSION_EXPIRED');
    if (this.failed || !this.state || +new Date(this.state.leaseUntil) <= this.now()) fail('SAVE_UNAVAILABLE');
    return connection;
  }
  async persist(next, release = false) {
    try {
      const saved = await this.repository.save(next, release);
      if (this.failed || (!release && +new Date(saved.leaseUntil) <= this.now())) throw new Error('Commons save completed after ownership expired');
      this.state = saved;
    }
    catch (error) { this.unavailable(error); fail('SAVE_UNAVAILABLE'); }
  }
  unavailable(error) {
    if (!this.failed) this.log.error('Commons persistence unavailable; room closed pending recovery', {
      category: 'commons.persistence', metadata: { errorName: error?.name || 'Error' },
    });
    this.failed = true;
    for (const connection of this.connections.values()) connection.close('SAVE_UNAVAILABLE');
    this.connections.clear();
    this.state = null;
  }
  async join(userId, connection) {
    return this.serial(async () => {
      if (!this.state) {
        try { this.state = await this.repository.acquire(); this.failed = false; }
        catch (error) {
          if (this.now() - this.lastLeaseWarning > 60000) {
            this.lastLeaseWarning = this.now();
            this.log.warning('Commons room could not acquire database ownership; check database, schema and app replicas', {
              category: 'commons.lease', metadata: { errorName: error?.name || 'Error' },
            });
          }
          fail('ROOM_UNAVAILABLE');
        }
      }
      const previous = this.connections.get(userId);
      if (!previous && this.connections.size >= this.maxOnline) fail('ROOM_FULL');
      const next = structuredClone(this.state);
      let player = next.players.find(p => p.userId === userId);
      if (!player) {
        if (next.players.length >= World.homes.length) fail('VILLAGE_FULL');
        const plot = World.homes.find(h => !next.players.some(p => p.plot === h.plot)).plot;
        player = { userId, plot, ...World.SPAWN, petals: 0, discoveries: [], watered: [], receipts: [], lantern: false, decorated: false };
        next.players.push(player);
      }
      const repair = World.repairPosition(player);
      if (repair) {
        Object.assign(player, repair);
        if (repair.scene) this.log.warning('Commons saved position could not be retained; returned to village spawn', {
          category: 'commons.position', metadata: { repair: 'spawn-fallback' },
        });
      }
      await this.persist(next);
      this.connections.set(userId, { ...connection, input: null, emote: null });
      if (previous) previous.close('TAKEN_OVER');
      return this.snapshot(userId, connection.token);
    });
  }
  authorize(userId, token, validUntil) {
    const connection = this.connections.get(userId);
    if (connection?.token === token) connection.validUntil = validUntil;
  }
  input(userId, token, data) {
    const c = this.current(userId, token);
    if (!data || Object.keys(data).length !== 2 || ![-1, 0, 1].includes(data.x) || ![-1, 0, 1].includes(data.y)) fail('INVALID_INPUT');
    c.input = { x: data.x, y: data.y, at: this.now() };
  }
  tick() {
    const now = this.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.state) return;
    if (+new Date(this.state.leaseUntil) <= now) return this.unavailable(new Error('Lease expired'));
    if (this.busy) return;
    for (const p of this.state.players) {
      const c = this.connections.get(p.userId);
      if (c && c.validUntil > now) World.move(p, c.input, dt, now);
    }
  }
  snapshot(userId, token) {
    this.current(userId, token);
    const own = this.state.players.find(p => p.userId === userId);
    const presence = this.state.players.filter(p => p.scene === 'village' && own.scene === 'village'
      && this.connections.get(p.userId)?.validUntil > this.now());
    const transform = p => ({ id: `villager-${p.plot}`, plot: p.plot, x: p.x, y: p.y, facing: p.facing, lantern: p.lantern,
      emote: this.connections.get(p.userId)?.emote?.until > this.now() ? this.connections.get(p.userId).emote.text : null });
    return { version: World.VERSION, clientRevision: World.CLIENT_REVISION, serverTime: this.now(), savedAt: this.state.savedAt,
      online: this.connections.size, maxOnline: this.maxOnline, blooms: this.state.blooms,
      self: { ...transform(own), scene: own.scene, petals: own.petals, discoveries: own.discoveries, decorated: own.decorated },
      players: presence.map(transform) };
  }
  async action(userId, token, request) {
    return this.serial(async () => {
      const connection = this.current(userId, token);
      if (!request || Object.keys(request).some(k => !['id', 'target'].includes(k))
        || typeof request.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(request.id)
        || typeof request.target !== 'string' || request.target.length > 32) fail('INVALID_ACTION');
      const next = structuredClone(this.state);
      const p = next.players.find(row => row.userId === userId);
      const receipt = p.receipts.find(r => r.id === request.id);
      if (receipt) return { message: receipt.message, duplicate: true };
      if (!World.nearby(p).some(l => l.id === request.target)) fail('TOO_FAR');
      connection.input = null;
      let message;
      const target = request.target;
      if (target.startsWith('home-')) {
        if (target !== `home-${p.plot}`) fail('PRIVATE_HOUSE');
        Object.assign(p, { scene: 'home', x: 6, y: 7, facing: 'up' });
        message = 'Welcome home. This room and its keepsakes belong only to you.';
      } else if (target === 'exit') {
        const home = World.homes[p.plot];
        Object.assign(p, { scene: 'village', x: home.x, y: home.y + 1.6, facing: 'down' });
        message = 'The village is waiting, just as you left it.';
      } else if (target === 'decorate') {
        if (!p.lantern) fail('NEED_LANTERN');
        p.decorated = !p.decorated;
        message = p.decorated ? 'Your handmade lantern fills the cottage with a little warmth.' : 'Your lantern is safely tucked away.';
      } else if (target.startsWith('stone-')) {
        if (!p.discoveries.includes(target)) p.discoveries.push(target);
        message = ['Listen. Even quiet places have a story.', 'Rain does not hurry the garden. Neither must you.', 'A small light is enough to find the way home.'][Number(target.slice(-1))];
      } else if (target.startsWith('garden-')) {
        const day = World.clock(this.now()).day;
        const key = `${day}:${target}`;
        p.watered = p.watered.filter(k => k.startsWith(day));
        if (p.watered.includes(key)) message = 'This bed is cared for today. Come back after midnight in Tokyo.';
        else {
          p.watered.push(key); p.petals = Math.min(12, p.petals + 1); next.blooms = Math.min(9999, next.blooms + 1);
          message = 'You watered the garden. One golden petal for you; one more bloom for everyone.';
        }
      } else if (target === 'workshop') {
        if (p.lantern) message = 'Your lantern is already made. Take it home and arrange it in your cottage.';
        else if (p.discoveries.length < 3 || p.petals < 3) message = 'A lantern needs three garden petals and the wisdom of all three woodland stones.';
        else { p.petals -= 3; p.lantern = true; message = 'You made a woodland lantern! Carry its glow, or place it in your cottage.'; }
      } else if (['chat', 'hall', 'shelter', 'gallery', 'keeper'].includes(target)) {
        return { target };
      } else fail('INVALID_ACTION');
      p.receipts.push({ id: request.id, message }); p.receipts = p.receipts.slice(-64);
      await this.persist(next);
      return { message };
    });
  }
  emote(userId, token, text) {
    const c = this.current(userId, token);
    if (!['Hello!', 'Thank you!', 'Lovely here.'].includes(text)) fail('INVALID_ACTION');
    c.emote = { text, until: this.now() + 4000 };
  }
  async leave(userId, token) {
    return this.serial(async () => {
      if (this.connections.get(userId)?.token !== token) return;
      this.connections.delete(userId);
      if (!this.state) return;
      const empty = this.connections.size === 0;
      await this.persist(structuredClone(this.state), empty);
      if (empty) this.state = null;
    });
  }
  async checkpoint() {
    return this.serial(async () => {
      if (!this.state) return;
      await this.persist(structuredClone(this.state), this.connections.size === 0);
      if (this.connections.size === 0) this.state = null;
    });
  }
}
module.exports = { CommonsRoom, CommonsError };
