const World = require('../../public/commons/world');
const { CommonsError } = require('./room');
const logger = require('../../utils/logger');
const fail = code => { throw new CommonsError(code); };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const fields = (input, allowed) => input && !Array.isArray(input) && Object.keys(input).every(k => allowed.includes(k));
function createDiary({ model = require('../../models/commons_diary'), now = Date.now } = {}) {
  let lastIndexWarning = -Infinity;
  const today = () => World.clock(now()).day;
  async function requireUniqueIndex() {
    try {
      // init() does not build indexes when autoIndex is false. Check actual Mongo
      // metadata on every write, including after reconnects or index removal.
      const indexes = await model.collection.listIndexes({ maxTimeMS: 2000 }).toArray();
      if (indexes.some(index => index.unique === true && !index.partialFilterExpression && !index.sparse
        && Object.keys(index.key).length === 2 && index.key.ownerId === 1 && index.key.date === -1)) return;
    } catch (_) { /* Missing collection, denied metadata access or database failure: fail closed. */ }
    if (now() - lastIndexWarning >= 60000) {
      lastIndexWarning = now();
      logger.warning('Commons diary writes disabled: verify the full unique ownerId/date index and listIndexes access; see documentation/commons/V1.2.md', { category: 'commons.diary.index' });
    }
    fail('DIARY_INDEX_UNAVAILABLE');
  }
  const serialize = entry => entry ? { date: entry.date, text: entry.text, revision: entry.revision, updatedAt: entry.updatedAt } : null;
  async function read(ownerId, input = {}) {
    if (!fields(input, ['date', 'before']) || input.date && input.before
      || input.date !== undefined && (!validDate(input.date) || input.date > today())
      || input.before !== undefined && !validDate(input.before)) fail('INVALID_INPUT');
    const day = today();
    if (input.before !== undefined) {
      const entries = await model.find({ ownerId, date: { $lt: input.before, $lte: day } })
        .select('date updatedAt').sort({ date: -1 }).limit(21).maxTimeMS(2000).lean();
      return { today: day, dates: entries.slice(0, 20).map(e => ({ date: e.date, updatedAt: e.updatedAt })),
        next: entries.length > 20 ? entries[19].date : null };
    }
    const date = input.date || day;
    const entry = await model.findOne({ ownerId, date }).maxTimeMS(2000).lean();
    return { today: today(), entry: serialize(entry) || { date, text: '', revision: 0, updatedAt: null } };
  }
  async function save(ownerId, input, revalidate = async () => {}) {
    if (!fields(input, ['date', 'text', 'revision']) || Object.keys(input).length !== 3
      || !validDate(input.date) || typeof input.text !== 'string' || input.text.length > 10000
      || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision > 1000000000) fail('INVALID_INPUT');
    if (input.date !== today()) fail('DAY_CHANGED');
    await requireUniqueIndex();
    await revalidate();
    if (input.date !== today()) fail('DAY_CHANGED');
    // The pipeline's server-clock guard also runs for inserts. An invalid date
    // conversion aborts the entire atomic write (including upsert) after midnight.
    const filter = { ownerId, date: input.date, revision: input.revision };
    const sameDay = { $eq: [{ $dateToString: { date: '$$NOW', format: '%Y-%m-%d', timezone: 'Asia/Tokyo' } }, input.date] };
    try {
      const entry = await model.findOneAndUpdate(filter,
        [{ $set: { text: { $cond: [sameDay, { $literal: input.text }, { $dateFromString: { dateString: 'commons-day-changed' } }] },
          updatedAt: '$$NOW', revision: { $add: ['$revision', 1] } } }],
        { upsert: input.revision === 0, updatePipeline: true, returnDocument: 'after', maxTimeMS: 2000, writeConcern: { w: 'majority', wtimeout: 2000 } }).lean();
      if (!entry) fail(input.date !== today() ? 'DAY_CHANGED' : 'REVISION_CONFLICT');
      return { today: today(), entry: serialize(entry) };
    } catch (error) { if (error.code === 241) fail('DAY_CHANGED'); if (error.code === 11000) fail('REVISION_CONFLICT'); throw error; }
  }
  return { read, save };
}
module.exports = { createDiary, validDate };
