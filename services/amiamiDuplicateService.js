const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const logger = require('../utils/logger');
const getListingHash = require('../utils/amiamiListingHash');

const PAGE_SIZE = 25;
const timeout = { maxTimeMS: 5000 };
// Product data may be copied. Source identifiers, raw responses and fetch
// diagnostics describe a particular gcode and stay with that entry.
const fields = {
  listing: ['itemName', 'brand', 'priceText', 'imageUrl', 'tags'],
  details: ['itemName', 'price', 'releaseDate', 'brand', 'seriesTitle', 'seriesTitles',
    'originalTitles', 'characterName', 'characterNames', 'sculptor', 'sculptorGroup',
    'specifications', 'details', 'remarks', 'copyright', 'saleStatus', 'flags', 'imageLinks'],
};
const summary = 'gcode listing.itemName details.itemName details.janCode';
const conflict = 'These entries changed. Review the current entries before merging.';
class ReviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function id(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/.test(value)) {
    throw new ReviewError(400, 'Invalid item identifier.');
  }
  return value;
}

function jan(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new ReviewError(400, 'Invalid JAN code.');
  }
  return value;
}

function revision(item) {
  return { _id: item._id, updatedAt: item.updatedAt ?? null, __v: item.__v ?? null, 'details.janCode': item.details.janCode };
}

function differences(keep, remove) {
  const rows = [];
  for (const [section, names] of Object.entries(fields)) {
    for (const name of names) {
      const left = keep[section]?.[name];
      const right = remove[section]?.[name];
      if (!isDeepStrictEqual(left, right)) {
        rows.push({ section, name, key: section + '_' + name, left, right });
      }
    }
  }
  return rows;
}

function createDuplicateService(Item) {
  async function groups(after) {
    const filter = { $type: 'string', $regex: /\S/ };
    if (after !== undefined) filter.$gt = jan(after);
    return Item.aggregate([
      { $match: { 'details.janCode': filter, mergedInto: null } },
      { $group: { _id: '$details.janCode', count: { $sum: 1 }, first: { $min: '$_id' }, last: { $max: '$_id' } } },
      { $match: { count: { $gt: 1 } } }, { $sort: { _id: 1 } }, { $limit: PAGE_SIZE + 1 },
    ]).option(timeout);
  }

  async function group(code, keeper, after) {
    const query = { 'details.janCode': jan(code), mergedInto: null };
    if (after !== undefined) query._id = { $gt: id(after) };
    let keep;
    if (keeper !== undefined) {
      keep = await Item.findOne({ _id: id(keeper), 'details.janCode': code, mergedInto: null }).select(summary).lean().setOptions(timeout);
      if (!keep) throw new ReviewError(409, conflict);
      query._id = { ...query._id, $ne: keeper };
    }
    const items = await Item.find(query).sort({ _id: 1 }).limit(PAGE_SIZE + 1).select(summary).lean().setOptions(timeout);
    return { keep, items };
  }

  async function compare(keeper, duplicate) {
    id(keeper);
    id(duplicate);
    if (keeper === duplicate) throw new ReviewError(400, 'Choose two different entries.');
    const items = await Item.find({ _id: { $in: [keeper, duplicate] }, mergedInto: null }).lean().setOptions(timeout);
    const keep = items.find(item => String(item._id) === keeper);
    const remove = items.find(item => String(item._id) === duplicate);
    if (!keep || !remove || !keep.details?.janCode || keep.details.janCode !== remove.details?.janCode) {
      throw new ReviewError(409, conflict);
    }
    jan(keep.details.janCode);
    const snapshot = createHash('sha256').update(JSON.stringify([keep, remove])).digest('hex');
    return { keep, remove, snapshot, differences: differences(keep, remove) };
  }

  async function merge(keeper, duplicate, form) {
    if (!form || typeof form.snapshot !== 'string' || !/^[a-f\d]{64}$/.test(form.snapshot)) {
      throw new ReviewError(400, 'Review both entries before merging.');
    }
    const pair = await compare(keeper, duplicate);
    if (form.snapshot !== pair.snapshot) throw new ReviewError(409, conflict);
    const allowed = new Set(['_csrf', 'snapshot', ...pair.differences.map(row => row.key)]);
    if (Object.keys(form).some(key => !allowed.has(key))) throw new ReviewError(400, 'Unknown merge choice.');

    const set = {};
    const unset = {};
    const listing = { ...pair.keep.listing };
    let listingChanged = false;
    for (const { key, section, name, right } of pair.differences) {
      if (!['keep', 'remove'].includes(form[key])) throw new ReviewError(400, 'Choose a value for each difference.');
      if (form[key] !== 'remove') continue;
      const path = section + '.' + name;
      if (right === undefined) unset[path] = 1;
      else set[path] = right;
      if (section === 'listing') {
        listing[name] = right;
        listingChanged = true;
      }
    }
    if (listingChanged) {
      set.listingHash = getListingHash(listing);
      set.listingChangedAt = new Date();
    }

    // Claim the reviewed revision before touching the survivor. In particular,
    // two simultaneous merges in opposite directions cannot both pass this
    // step and then retire each other's survivors.
    const claimed = await Item.findOneAndUpdate(revision(pair.remove), { $inc: { __v: 1 } },
      { ...timeout, returnDocument: 'after', projection: '_id updatedAt __v details.janCode' }).lean();
    if (!claimed) throw new ReviewError(409, conflict);
    const update = { $inc: { __v: 1 } };
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    const saved = await Item.updateOne(revision(pair.keep), update, { ...timeout, runValidators: true });
    if (!saved.matchedCount) throw new ReviewError(409, conflict);
    // Replace the entire BSON document so old fields and schema defaults
    // cannot leave searchable JANs, raw payloads or pending scrape state.
    const alias = { _id: pair.remove._id, gcode: pair.remove.gcode, mergedInto: pair.keep._id };
    const result = await Item.collection.replaceOne(revision(claimed), alias, timeout);
    if (!result.matchedCount) {
      logger.warning('AmiAmi duplicate changed after saving selected fields. Reopen the merge review.', { category: 'amiami-items' });
      throw new ReviewError(409, 'The selected details were saved. The other entry changed before its redirect could be saved. Review the pair again.');
    }
    return pair.keep.details.janCode;
  }
  return { groups, group, compare, merge };
}

module.exports = { PAGE_SIZE, ReviewError, createDuplicateService };
