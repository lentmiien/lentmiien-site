const fs = require('fs');
const path = require('path');

const {
  THREE_ADDONS_PATH,
  THREE_BUILD_PATH,
  THREE_PACKAGE_ROOT,
  THREE_VENDOR_BASE_URL,
  THREE_VERSION,
} = require('../../utils/threeVendor');

describe('Three.js browser assets', () => {
  test('uses an installed package version in the public asset URL', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(THREE_PACKAGE_ROOT, 'package.json'), 'utf8'),
    );

    expect(THREE_VERSION).toBe(manifest.version);
    expect(THREE_VENDOR_BASE_URL).toBe(`/vendor/three/${manifest.version}`);
  });

  test.each([
    ['build/three.module.min.js', () => path.join(THREE_BUILD_PATH, 'three.module.min.js')],
    ['OrbitControls', () => path.join(THREE_ADDONS_PATH, 'controls', 'OrbitControls.js')],
    ['GLTFLoader', () => path.join(THREE_ADDONS_PATH, 'loaders', 'GLTFLoader.js')],
    ['Draco decoder', () => path.join(THREE_ADDONS_PATH, 'libs', 'draco', 'draco_decoder.wasm')],
    ['Basis transcoder', () => path.join(THREE_ADDONS_PATH, 'libs', 'basis', 'basis_transcoder.wasm')],
  ])('includes the %s asset', (_label, resolveAssetPath) => {
    expect(fs.statSync(resolveAssetPath()).isFile()).toBe(true);
  });
});
