'use strict';
const { randomUUID } = require('node:crypto');
const { Simulation } = require('./simulation');
const { problem } = require('./repository');
const { validAction, validInput } = require('./protocol');

const CHECKPOINT_MS = 30000;
class Room {
  constructor({ repository, log = require('../../utils/logger'), now = Date.now, automatic = true }) {
    Object.assign(this, { repository, log, now, automatic });
    this.members = new Map();
    this.admissions = new Map();
    this.tail = Promise.resolve();
    this.sea = null;
    this.timer = null;
    this.retry = null;
    this.pending = null;
    this.recovering = false;
    this.blocked = false;
    this.pausing = false;
    this.stopping = false;
    this.savedAt = 0;
  }
  serial(fn) {
    const operation = this.tail.then(fn);
    this.tail = operation.catch(() => {});
    return operation;
  }
  async acquire(allowPaused) {
    if (this.sea) return;
    let saved;
    try {
      saved = await this.repository.acquire(allowPaused);
    } catch (error) {
      if (!['MAINTENANCE', 'WORLD_BUSY'].includes(error.code))
        this.log.error('Emberwake could not open its checkpoint', {
          category: 'emberwake.persistence',
          metadata: { errorName: error.name }
        });
      throw error;
    }
    this.sea = new Simulation(saved.data);
    this.revision = saved.revision;
    this.until = saved.until;
    this.savedAt = saved.savedAt;
    this.pausing = saved.paused;
  }
  async status() {
    if (this.sea)
      return {
        paused: this.pausing,
        blocked: this.blocked,
        online: this.members.size,
        savedAt: this.savedAt
      };
    return { ...(await this.repository.status()), blocked: this.blocked, online: 0 };
  }
  join(id, connection) {
    return this.serial(async () => {
      if (this.stopping || this.blocked) throw problem('SAVE_UNAVAILABLE');
      if (this.pausing && this.sea) throw problem('MAINTENANCE');
      await this.acquire(false);
      if (
        this.stopping ||
        !connection.alive() ||
        connection.validUntil <= this.now() ||
        (this.admissions.get(id) || 0) > connection.ticket
      ) {
        if (!this.members.size) await this.flush(true);
        throw problem('SESSION_ENDED');
      }
      const old = this.members.get(id);
      let g;
      try {
        g = this.sea.connect(id);
      } catch (error) {
        if (!this.members.size) await this.flush(true);
        throw error;
      }
      this.sea.resetControls(g);
      this.admissions.set(id, connection.ticket);
      this.members.set(id, connection);
      if (old) old.close('TAKEN_OVER');
      this.start();
      return this.sea.joined(g);
    });
  }
  current(id, connection) {
    if (this.members.get(id) !== connection || !connection.alive() || connection.validUntil <= this.now())
      throw problem('SESSION_ENDED');
    if (this.blocked || this.pausing || this.stopping || this.until <= this.now())
      throw problem('SAVE_UNAVAILABLE');
    return this.sea.online.get(id);
  }
  input(id, c, p) {
    const g = this.current(id, c);
    if (!validInput(p)) throw problem('INVALID_INPUT');
    this.sea.input(g, p, this.now());
  }
  action(id, c, p) {
    const g = this.current(id, c);
    if (!validAction(p)) throw problem('INVALID_INPUT');
    return this.sea.action(g, p);
  }
  detach(id, c) {
    if (this.members.get(id) !== c) return false;
    this.members.delete(id);
    this.sea.disconnect(id);
    if (!this.members.size) this.stopTimer();
    return true;
  }
  leave(id, c) {
    if (!this.detach(id, c)) return Promise.resolve();
    return this.serial(async () => {
      if (this.sea && !this.blocked) await this.flush(!this.members.size);
    });
  }
  closeAll(reason) {
    this.stopTimer();
    for (const [id, c] of this.members) {
      this.detach(id, c);
      c.close(reason);
    }
  }
  start() {
    if (this.timer || !this.automatic) return;
    this.previous = this.now();
    this.nextSave = this.previous + CHECKPOINT_MS;
    this.lastFrame = 0;
    this.timer = setInterval(() => this.tick(), 50);
    this.timer.unref?.();
  }
  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }
  tick() {
    if (!this.members.size || this.blocked || this.stopping || this.pausing) return;
    const now = this.now();
    if (now >= this.until) {
      this.fail(problem('LEASE_EXPIRED'));
      return;
    }
    try {
      for (const [id, c] of this.members)
        if (c.validUntil <= now || !c.alive()) {
          this.leave(id, c).catch(() => {});
          c.close('SESSION_ENDED');
        }
      if (!this.members.size) return;
      const dt = Math.min(0.05, Math.max(0, (now - (this.previous ?? now - 50)) / 1000));
      this.previous = now;
      this.sea.tick(dt, now);
      if (!this.lastFrame || now - this.lastFrame >= 95) {
        this.lastFrame = now;
        const delta = this.sea.takeDelta();
        for (const [id, c] of this.members) {
          if (!c.alive() || c.validUntil <= this.now()) {
            this.leave(id, c).catch(() => {});
            c.close('SESSION_ENDED');
          } else c.send(this.sea.frame(this.sea.online.get(id), delta, this.savedAt));
        }
      }
      if (now >= this.nextSave && !this.autosaving) {
        this.nextSave = now + CHECKPOINT_MS;
        this.autosaving = true;
        this.serial(async () => {
          if (this.members.size && !this.blocked) await this.flush(false);
        })
          .catch(() => {})
          .finally(() => {
            this.autosaving = false;
          });
      }
    } catch (error) {
      this.fail(error);
    }
  }
  async finishWrite() {
    const op = this.pending,
      saved = await this.repository.save(op);
    this.pending = null;
    this.revision = saved.revision;
    this.until = saved.until;
    this.savedAt = saved.savedAt;
    if (op.release) this.sea = null;
  }
  async flush(release) {
    try {
      this.pending = {
        raw: this.sea.checkpoint(),
        revision: this.revision,
        paused: this.pausing,
        release,
        id: randomUUID()
      };
      await this.finishWrite();
    } catch (error) {
      this.fail(error);
      throw problem('SAVE_UNAVAILABLE');
    }
  }
  fail(error) {
    if (!this.blocked)
      this.log.error('Emberwake closed the harbor after a checkpoint or simulation failure', {
        category: 'emberwake.persistence',
        metadata: { cause: error.code || error.name }
      });
    this.blocked = true;
    this.closeAll('SAVE_UNAVAILABLE');
    if (this.automatic && !this.retry && !this.stopping) {
      this.retry = setTimeout(() => {
        this.retry = null;
        this.recover().catch(() => {});
      }, 5000);
      this.retry.unref?.();
    }
  }
  recover() {
    return this.serial(async () => {
      if (!this.blocked) return;
      try {
        if (this.pending) await this.finishWrite();
        if (this.sea) await this.flush(true);
        this.blocked = false;
      } catch (error) {
        if (error.code === 'LEASE_LOST') {
          // A different writer advanced. Its durable revision wins.
          this.log.warning('Emberwake lost its writer lease; reconnect to the durable world', {
            category: 'emberwake.persistence'
          });
          this.pending = null;
          this.sea = null;
          this.blocked = false;
        } else {
          this.fail(error);
          throw error;
        }
      }
    });
  }
  maintenance(paused) {
    return this.serial(async () => {
      if (this.blocked || this.stopping) throw problem('SAVE_UNAVAILABLE');
      await this.acquire(true);
      this.pausing = paused;
      if (paused) this.closeAll('MAINTENANCE');
      await this.flush(!this.members.size);
      this.log.notice(paused ? 'Emberwake maintenance pause saved' : 'Emberwake harbor reopened', {
        category: 'emberwake.maintenance'
      });
      return { paused, savedAt: this.savedAt };
    });
  }
  shutdown() {
    this.stopping = true;
    this.closeAll('SERVER_STOPPING');
    clearTimeout(this.retry);
    this.retry = null;
    return this.serial(async () => {
      if (this.pending) await this.finishWrite();
      if (this.sea) await this.flush(true);
    });
  }
}
module.exports = { Room, CHECKPOINT_MS };
