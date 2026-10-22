const { rateLimit } = require('express-rate-limit');
const { catalogService } = require('./smallestBoxCatalogService');
const { findSmallestBox } = require('./smallestBoxService');
const { searchSchema } = require('../utils/smallestBoxValidation');

function createPackingOperations({ catalog = catalogService, search = findSmallestBox } = {}) {
  const activeOwners = new Set();
  const limiter = rateLimit({ windowMs: 60000, limit: 5,
    keyGenerator: req => req.packingOwnerId, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many searches. Please try again in a minute.' } });
  async function run(req, res, next) {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid search. Use unique item IDs, valid dimensions, up to 200 items (7 for bruteforce), and valid tags.' });
    const owner = req.packingOwnerId;
    if (activeOwners.has(owner) || activeOwners.size >= 2) {
      return res.status(429).json({ success: false, message: 'A box search is already running. Please try again shortly.' });
    }
    activeOwners.add(owner);
    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.once('close', onClose);
    try {
      const { containers } = await catalog.read();
      const result = await search(containers, parsed.data, { signal: abort.signal });
      if (req.verifyPackingAccess) await req.verifyPackingAccess();
      if (!abort.signal.aborted) res.json(result);
    } catch (error) { if (!abort.signal.aborted) next(error); }
    finally { res.off('close', onClose); activeOwners.delete(owner); }
  }
  return { limiter, run };
}
const packingOperations = createPackingOperations();
module.exports = { createPackingOperations, packingOperations };
