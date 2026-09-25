# Three.js

Vendored unmodified from the repository's installed `three` package, version **0.185.1**:

- `build/three.module.min.js`
- `build/three.core.min.js`
- `LICENSE` → `THREE-LICENSE.txt`

The module imports its adjacent core file. Both are needed. The MIT license permits redistribution; retain `THREE-LICENSE.txt`. No CDN, package installation or shared `/vendor` mount is needed to play.

To deliberately update, copy both matching build files and their license from the reviewed repository dependency, then rerun the module's core and browser tests. Do not mix versions.
