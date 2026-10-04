// Compatibility adapter for the existing saved-gallery cache and record contract.
const { LocalImageThumbnailService, SETTINGS } = require('./localImageThumbnailService');
class GoodImageThumbnailService extends LocalImageThumbnailService {
  get(record) {
    if (typeof record?.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(record.filename)) {
      return Promise.reject(Object.assign(new Error('Thumbnail unavailable.'), { status: 404 }));
    }
    return super.get({ _id: record._id, filename: record.filename });
  }
}
module.exports = { GoodImageThumbnailService, SETTINGS };
