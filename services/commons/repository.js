const crypto = require('crypto');
const World = require('../../public/commons/world');
const { validState } = require('./state');
const WORLD_ID = 'lantern-commons-v1';
class CommonsRepository {
  constructor({ model = require('../../models/commons_world'), now = Date.now, leaseMs = 20000 } = {}) {
    Object.assign(this, { model, now, leaseMs });
    this.owner = crypto.randomUUID();
  }
  async acquire() {
    const now = this.now();
    // _id's built-in unique index is the only index required. Contenders lose with E11000.
    const state = await this.model.findOneAndUpdate({ _id: WORLD_ID,
      $or: [{ leaseUntil: { $lte: new Date(now) } }, { leaseOwner: this.owner }, { leaseUntil: { $exists: false } }],
    }, { $set: { leaseOwner: this.owner, leaseUntil: new Date(now + this.leaseMs) },
      $setOnInsert: { version: World.VERSION, revision: 0, players: [], blooms: 0 } },
    { upsert: true, new: true, maxTimeMS: 2000, writeConcern: { w: 'majority' } }).lean();
    if (!validState(state)) throw new Error('Unsupported Commons world');
    return state;
  }
  async save(state, release = false) {
    const now = this.now();
    const leaseUntil = new Date(release ? now : now + this.leaseMs);
    const result = await this.model.updateOne({ _id: WORLD_ID, version: World.VERSION, revision: state.revision,
      leaseOwner: this.owner, leaseUntil: { $gt: new Date(now) } },
    { $set: { players: state.players, blooms: state.blooms, savedAt: new Date(now), leaseUntil }, $inc: { revision: 1 } },
    { maxTimeMS: 2000, writeConcern: { w: 'majority' } });
    if (result.modifiedCount !== 1) throw new Error('Commons ownership lost');
    return { ...state, revision: state.revision + 1, leaseUntil, savedAt: new Date(now) };
  }
}
module.exports = { CommonsRepository, WORLD_ID };
