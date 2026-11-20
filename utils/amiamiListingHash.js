const { createHash } = require('node:crypto');

module.exports = function getListingHash(listing) {
  const values = {};
  for (const key of ['itemName', 'brand', 'priceText', 'imageUrl', 'tags']) {
    values[key] = listing && listing[key];
  }
  return createHash('sha256')
    .update(JSON.stringify(values))
    .digest('hex');
};
