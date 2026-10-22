const Shared = require('../models/packing_shared_catalog');
const Legacy = require('../models/packing_container_catalog');
const User = require('../models/useraccount');
const { catalogSchema } = require('../utils/smallestBoxValidation');

function problem(code, status, message) {
  return Object.assign(new Error(message), { code, status, publicMessage: message });
}
function createCatalogService({ shared = Shared, legacy = Legacy, users = User,
  sourceOwner = () => process.env.PACKING_CATALOG_SOURCE_OWNER_ID } = {}) {
  const publicCatalog = doc => ({ containers: catalogSchema.parse({ containers: doc.containers || [] }).containers, revision: doc.revision || 0 });
  async function seed() {
    const configured = sourceOwner();
    let ownerIds;
    if (configured) {
      if (!/^[a-f\d]{24}$/i.test(configured)) throw problem('MIGRATION_SOURCE_INVALID', 503, 'The shared box catalog needs administrator setup.');
      const admin = await users.findOne({ _id: configured, type_user: 'admin' }).select('_id').lean();
      if (!admin) throw problem('MIGRATION_SOURCE_INVALID', 503, 'The shared box catalog needs administrator setup.');
      ownerIds = [admin._id];
    } else {
      const admins = await users.find({ type_user: 'admin' }).select('_id').limit(100).lean();
      if (admins.length === 100) throw problem('MIGRATION_SOURCE_AMBIGUOUS', 503, 'Select the admin catalog to share before continuing.');
      ownerIds = admins.map(user => user._id);
    }
    const sources = await legacy.find({ ownerId: { $in: ownerIds }, 'containers.0': { $exists: true } }).limit(2).lean();
    if (sources.length > 1 || (configured && sources.length !== 1)) {
      throw problem('MIGRATION_SOURCE_AMBIGUOUS', 503, 'Select the admin catalog to share before continuing.');
    }
    const source = sources[0];
    // Copy only the explicitly shared box definitions, with no starting tags. Retain the original document.
    const containers = (source?.containers || []).map(({ id, w, d, h, emptyWeight, maxLoadWeight }) =>
      ({ id, w, d, h, emptyWeight, maxLoadWeight, tags: [] }));
    return { ...catalogSchema.parse({ containers }), revision: 0, migratedFrom: source?.ownerId || null };
  }
  async function read() {
    const doc = await shared.findById('shared').lean();
    // GET stays read-only even if the startup migration has not finished yet.
    return publicCatalog(doc || await seed());
  }
  async function initialize() {
    const existing = await shared.findById('shared').lean();
    if (existing) return publicCatalog(existing);
    const initial = await seed();
    try {
      const doc = await shared.findOneAndUpdate({ _id: 'shared' }, { $setOnInsert: initial },
        { upsert: true, new: true, runValidators: true }).lean();
      return publicCatalog(doc);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const winner = await shared.findById('shared').lean();
      if (!winner) throw error;
      return publicCatalog(winner);
    }
  }
  async function save({ containers, revision }) {
    await initialize();
    const doc = await shared.findOneAndUpdate({ _id: 'shared', revision },
      { $set: catalogSchema.parse({ containers }), $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
    if (!doc) throw problem('CATALOG_CHANGED', 409, 'The shared boxes changed in another session. Reload before saving your edits.');
    return publicCatalog(doc);
  }
  return { read, initialize, save };
}
const catalogService = createCatalogService();
module.exports = { createCatalogService, catalogService, problem };
