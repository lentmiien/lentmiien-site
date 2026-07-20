const path = require('path');

const threeEntryPath = require.resolve('three');
const THREE_PACKAGE_ROOT = path.resolve(path.dirname(threeEntryPath), '..');
const threePackage = require(path.join(THREE_PACKAGE_ROOT, 'package.json'));

const THREE_VENDOR_BASE_URL = `/vendor/three/${threePackage.version}`;
const THREE_BUILD_PATH = path.join(THREE_PACKAGE_ROOT, 'build');
const THREE_ADDONS_PATH = path.join(THREE_PACKAGE_ROOT, 'examples', 'jsm');

module.exports = {
  THREE_ADDONS_PATH,
  THREE_BUILD_PATH,
  THREE_PACKAGE_ROOT,
  THREE_VENDOR_BASE_URL,
  THREE_VERSION: threePackage.version,
};
