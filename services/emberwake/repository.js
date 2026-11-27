const { randomUUID, randomInt } = require('node:crypto');
const State = require('./state');

const WORLD = 'shared-archipelago';
const LEASE_MS = 90000;
const options = { maxTimeMS: 5000, writeConcern: { w: 'majority' } };
function problem(code) {
  return Object.assign(new Error(code), { code });
}

class Repository {
  constructor({ model = require('../../models/emberwake_world'), now = Date.now } = {}) {
    this.model = model;
    this.now = now;
    this.writer = randomUUID();
  }
  async status() {
    const row = await this.model.findById(WORLD, 'paused savedAt', { maxTimeMS: 3000 }).lean();
    return { paused: !!row?.paused, savedAt: row?.savedAt?.getTime() || 0 };
  }
  async acquire(allowPaused = false) {
    const now = this.now(),
      leaseUntil = new Date(now + LEASE_MS);
    let row;
    try {
      row = await this.model
        .findOneAndUpdate(
          {
            _id: WORLD,
            ...(allowPaused ? {} : { paused: { $ne: true } }),
            $or: [{ leaseUntil: { $lte: new Date(now) } }, { writer: this.writer }, { writer: null }]
          },
          {
            $set: { writer: this.writer, leaseUntil },
            $setOnInsert: {
              schemaVersion: 1,
              revision: 0,
              paused: false,
              payload: State.encode(State.initial(randomInt(2147483647)))
            }
          },
          { ...options, upsert: true, returnDocument: 'after' }
        )
        .lean();
    } catch (error) {
      if (error.code === 11000) throw problem((await this.status()).paused ? 'MAINTENANCE' : 'WORLD_BUSY');
      throw error;
    }
    if (row.schemaVersion !== 1) throw problem('CHECKPOINT_INVALID');
    return {
      data: State.decode(row.payload),
      paused: row.paused,
      revision: row.revision,
      savedAt: +row.savedAt || 0,
      until: +row.leaseUntil
    };
  }
  async save({ raw, revision, paused, release, id }) {
    const now = this.now(),
      until = release ? now : now + LEASE_MS;
    const result = await this.model.updateOne(
      { _id: WORLD, schemaVersion: 1, revision, writer: this.writer },
      {
        $set: {
          payload: raw,
          paused,
          lastOperation: id,
          savedAt: new Date(now),
          writer: release ? null : this.writer,
          leaseUntil: new Date(until)
        },
        $inc: { revision: 1 }
      },
      options
    );
    if (result.modifiedCount !== 1) {
      // A majority write may have succeeded before the acknowledgement was lost.
      const prior = await this.model
        .findOne({ _id: WORLD, revision: revision + 1, lastOperation: id }, 'leaseUntil savedAt writer', {
          maxTimeMS: 3000
        })
        .lean();
      if (!prior || (!release && prior.writer !== this.writer)) throw problem('LEASE_LOST');
      return { revision: revision + 1, savedAt: +prior.savedAt, until: +prior.leaseUntil };
    }
    return { revision: revision + 1, savedAt: now, until };
  }
}
module.exports = { Repository, WORLD, LEASE_MS, problem };
