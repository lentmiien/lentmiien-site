const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { models } = require('../../models/embeddinggemma2_pilot');
const { Files } = require('./files');
const { gateway } = require('./gateway');
const { fail, vector, MODEL, REVISION, SPACE } = require('./contract');
const logger = require('../../utils/logger');
const identity = { model: MODEL, revision: REVISION, space_id: SPACE, dimensions: 768, normalized: true, 'preprocessing.version': 'pilot-v1' };
function publicRecord(record) {
  return { id: String(record._id), kind: record.kind, text: record.text, title: record.title, filename: record.filename,
    bytes: record.bytes, capturedAt: record.capturedAt, model: record.model, revision: record.revision, space_id: record.space_id,
    dimensions: record.dimensions, normalized: record.normalized, precision: record.precision,
    preprocessing: record.preprocessing, mapping: record.mapping,
    ...(record.asset ? { mediaUrl: `/admin/embeddinggemma2/api/records/${record._id}/media` } : {}) };
}
class PilotService {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.files = dependencies.files || new Files(config.root);
    this.embed = dependencies.embed || gateway(config);
    this.connection = dependencies.connection || mongoose.connection;
    this.getModels = dependencies.getModels || models;
    this.busy = false;
  }
  async ready() {
    if (!this.config.enabled) fail('EmbeddingGemma2 playground is disabled.', 503);
    this.models = this.getModels(this.connection, this.config.dbName);
    if (!this.initialized) {
      await this.models.Record.createIndexes({ maxTimeMS: 10000 });
      this.initialized = true;
    }
    return this.models;
  }
  async acquire() {
    if (this.busy) fail('Another pilot operation is in progress. Wait before retrying.', 429);
    this.busy = true;
    let lease;
    try {
      const { Lease } = await this.ready();
      try { await Lease.updateOne({ _id: 'operation' }, { $setOnInsert: { until: new Date(0), token: '' } }, { upsert: true, maxTimeMS: 5000 }); }
      catch (error) { if (error.code !== 11000) throw error; }
      const token = randomUUID();
      const until = new Date(Date.now() + this.config.timeout + 180000);
      lease = await Lease.findOneAndUpdate({ _id: 'operation', until: { $lt: new Date() } }, { $set: { token, until } }, { new: true, maxTimeMS: 5000 }).lean();
      if (!lease) fail('Another pilot operation is in progress or reclaiming. Wait before retrying.', 429);
      const assert = async () => {
        if (!await Lease.exists({ _id: 'operation', token, until: { $gt: new Date() } }).maxTimeMS(5000)) fail('Pilot operation lease expired. Reload the dataset before retrying.', 503);
      };
      return { assert, release: async (uncertain = false) => {
        try {
          // An uncertain Gateway failure keeps admission closed until the original cold budget expires.
          if (!uncertain) await Lease.updateOne({ _id: 'operation', token }, { $set: { until: new Date(0) } }, { maxTimeMS: 5000 });
        } catch (error) { logger.error('EmbeddingGemma2 lease release failed', { category: 'embeddinggemma2', metadata: { errorName: error.name } }); }
        finally { this.busy = false; }
      } };
    } catch (error) { this.busy = false; throw error; }
  }
  async reconcile(lease) {
    await lease.assert();
    await this.files.clearStaging();
    const cursor = this.models.Record.find({ state: { $in: ['pending', 'deleting'] } }).maxTimeMS(10000).lean().cursor({ batchSize: 32 });
    let count = 0;
    try {
      for await (const record of cursor) {
        if (++count > this.config.globalItems) fail('Pilot recovery exceeds configured capacity; operator intervention required.', 503);
        await lease.assert();
        if (record.asset) await this.files.remove(record.asset);
        await this.models.Record.deleteOne({ _id: record._id, state: record.state }).maxTimeMS(5000);
      }
    } finally { await cursor.close(); }
    if (count) logger.warning('EmbeddingGemma2 recovered incomplete record operations', { category: 'embeddinggemma2', metadata: { count } });
  }
  async stats(owner) {
    const { Record } = await this.ready();
    const [result] = await Record.aggregate([{ $group: { _id: null, total: { $sum: 1 }, bytes: { $sum: '$bytes' },
      mineCount: { $sum: { $cond: [{ $eq: ['$owner', new mongoose.Types.ObjectId(String(owner))] }, 1, 0] } },
      mineBytes: { $sum: { $cond: [{ $eq: ['$owner', new mongoose.Types.ObjectId(String(owner))] }, '$bytes', 0] } },
    } }]).option({ maxTimeMS: 10000 });
    const total = result?.total || 0; const bytes = result?.bytes || 0;
    const mine = { count: result?.mineCount || 0, bytes: result?.mineBytes || 0 };
    const compatible = await Record.countDocuments({ owner, state: 'ready', ...identity }).maxTimeMS(5000);
    return { mine, total, bytes, compatible };
  }
  async list(owner, before) {
    const { Record } = await this.ready();
    const records = await Record.find({ owner, state: 'ready', ...(before ? { _id: { $lt: before } } : {}) })
      .select('-vector').sort({ _id: -1 }).limit(21).maxTimeMS(5000).lean();
    const stats = await this.stats(owner);
    return { records: records.slice(0, 20).map(publicRecord), next: records.length > 20 ? String(records[19]._id) : null,
      counts: { ...stats.mine, compatible: stats.compatible }, limits: { items: this.config.userItems, bytes: this.config.userBytes }, space_id: SPACE };
  }
  async add(owner, source, file, lease, active, authorize = async () => {}) {
    const { Record } = this.models;
    const bytes = file ? file.buffer.length : Buffer.byteLength(source.text) + Buffer.byteLength(source.title || '');
    const stats = await this.stats(owner);
    if (stats.mine.count >= this.config.userItems || stats.total >= this.config.globalItems || stats.mine.bytes + bytes > this.config.userBytes || stats.bytes + bytes > this.config.globalBytes) fail('Pilot storage capacity reached. Delete records before adding content.', 409);
    const media = file ? await this.files.validate(file, source.kind) : {};
    if (!active()) fail('Request disconnected before inference.', 499);
    await authorize();
    await lease.assert();
    const embedding = await this.embed(source, file?.buffer, false);
    await authorize();
    await lease.assert();
    if (!active()) fail('Request disconnected; nothing was added.', 499);
    const asset = file ? this.files.name() : undefined;
    // Durable intent precedes filesystem write. Ambiguous DB failures retain intent for recovery.
    const record = await Record.create({ owner, state: 'pending', kind: source.kind, text: source.text, title: source.title, ...media, bytes, asset, ...embedding });
    try {
      if (asset) await this.files.write(asset, file.buffer);
      await lease.assert();
      const committed = await Record.updateOne({ _id: record._id, owner, state: 'pending' }, { $set: { state: 'ready' } }, { runValidators: true, maxTimeMS: 5000 });
      if (committed.matchedCount !== 1) throw new Error('Pilot commit lost its pending record');
      return publicRecord(record);
    } catch (error) {
      // Keep intent if cleanup fails. Next lease holder retries safely.
      try { if (asset) await this.files.remove(asset); await Record.deleteOne({ _id: record._id, owner }).maxTimeMS(5000); }
      catch (cleanup) { logger.error('EmbeddingGemma2 ingest rollback requires recovery', { category: 'embeddinggemma2', metadata: { errorName: cleanup.name } }); }
      throw error;
    }
  }
  async search(owner, source, file, lease, active, authorize = async () => {}) {
    if (file) await this.files.validate(file, source.kind);
    if (!active()) fail('Request disconnected before inference.', 499);
    const { Record } = this.models;
    const stats = await this.stats(owner);
    if (stats.total > this.config.globalItems) fail('Dataset exceeds scan capacity. Raise the configured bound or delete records.', 409);
    const filter = { owner, state: 'ready', ...identity, ...(source.filter === 'all' ? {} : { kind: source.filter }) };
    const expected = await Record.countDocuments(filter).maxTimeMS(5000);
    if (!expected) return { records: [], scanned: 0, eligible: 0, total: stats.mine.count, excluded: stats.mine.count, space_id: SPACE };
    await authorize();
    await lease.assert();
    const query = await this.embed(source, file?.buffer, true);
    await authorize();
    await lease.assert();
    const top = []; let scanned = 0;
    const cursor = Record.find(filter).maxTimeMS(15000).lean().cursor({ batchSize: 32 });
    try {
      for await (const record of cursor) {
        if (!active()) fail('Search disconnected.', 499);
        if (++scanned > this.config.globalItems) fail('Dataset exceeds scan capacity.', 409);
        const v = vector(record.vector);
        const similarity = Math.max(-1, Math.min(1, v.reduce((sum, n, i) => sum + n * query.vector[i], 0)));
        const result = { ...publicRecord(record), similarity };
        top.push(result);
        top.sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
        if (top.length > source.topK) top.pop();
      }
    } finally { await cursor.close(); }
    if (scanned !== expected) fail('Dataset changed during search. Reload before trying again.', 409);
    return { records: top, scanned, eligible: expected, total: stats.mine.count, excluded: stats.mine.count - expected, space_id: SPACE };
  }
  async remove(owner, id, lease) {
    await lease.assert();
    const record = await this.models.Record.findOneAndUpdate({ _id: id, owner, state: 'ready' }, { $set: { state: 'deleting' } }, { new: true, maxTimeMS: 5000 }).lean();
    if (!record) fail('Record not found.', 404);
    if (record.asset) await this.files.remove(record.asset);
    await this.models.Record.deleteOne({ _id: id, owner, state: 'deleting' }).maxTimeMS(5000);
  }
  async media(owner, id) {
    const { Record } = await this.ready();
    const record = await Record.findOne({ _id: id, owner, state: 'ready', kind: { $in: ['image', 'audio', 'video'] } }).select('asset mime bytes').maxTimeMS(5000).lean();
    if (!record) fail('Record not found.', 404);
    const opened = await this.files.open(record.asset);
    if (opened.stat.size !== record.bytes) { await opened.handle.close(); throw new Error('Pilot asset size mismatch'); }
    return { ...opened, mime: record.mime };
  }
}
module.exports = { PilotService, identity, publicRecord };
