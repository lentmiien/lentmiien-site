# Local rendering dependencies

Three.js **0.185.1**, from this repository's installed `three` dependency:

- `build/three.module.min.js` and `build/three.core.min.js` (unmodified).
- `examples/jsm/loaders/GLTFLoader.js`, `DRACOLoader.js`,
  `examples/jsm/utils/BufferGeometryUtils.js`, `SkeletonUtils.js`.
  Only module specifiers were adapted to sibling local files; no bare imports,
  import map, remote resolver, or CDN is required.
- Three.js MIT license: `THREE-LICENSE.txt`.
- `examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js` and
  `draco_decoder.wasm`, unmodified. Draco is Apache-2.0;
  `DRACO-LICENSE.txt` is copied from Google's Draco 1.5.7 repository.
  The local Draco decoder uses one blob worker to decode the bundled model.

`SHA256SUMS` records the vendored source and license files. Keep matching
Three.js build / addon versions when deliberately updating. This feature
introduces no package or lockfile changes.
