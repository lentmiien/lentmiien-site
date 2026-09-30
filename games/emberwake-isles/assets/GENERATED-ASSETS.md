# Original assets and provenance

All game-specific art is original procedural work written for Emberwake Isles. No Minecraft textures, characters, sounds or branding are copied. The imagegen skill was inspected; its guidance explicitly prefers code-native assets where those are the better fit. No AI raster generation or external image request was performed or is claimed.

Reproduce the committed assets from the repository root:

```sh
node games/emberwake-isles/scripts/generate-assets.cjs
```

- `atlas.png`: original 128×128 pixel atlas, 16×16 tiles, deterministic material noise, wood grain, masonry and mineral seam motifs. Generated with Node's built-in zlib plus a minimal deterministic PNG writer; no image library or network required.
- `icons/*.svg`: 94 original item illustrations, with dedicated tools, foods and vessels plus isometric material/furnishing swatches. Text labels disambiguate furniture; these are not 94 bespoke detailed illustrations.
- `chart.svg`: original finite-island cartographic cover. The actual in-game map is generated from the same seeded terrain as the simulation, not this stylized cover.
- `js/mesher.js`: authored box silhouettes for workstations, chairs, daybeds, canopy, sofa, lamps, windows, garden furniture, instruments and other furnishings; emitted into shared chunk geometry.
- `js/world.js`: procedural terrain, tree shapes, cave networks, and five original landmark sculptures: listening shell, post office, teapot, quiet bell, moon moth archive.
- `js/renderer.js`: procedural ocean, cloud boxes, celestial disc, atmospheric silhouettes, vessels and crops.
- `js/audio.js`: original gesture-enabled synthesized gathering, placing, crafting, music-box and storm tones. No recordings or narration; no Piper use.
- `css/color-theme.css`: local copy of the existing Graphite/Ember/Golden Amber theme from Rocket Lander. The rest of the UI is new.
- `vendor/`: separately licensed, unmodified Three.js. See its MIT license and provenance.

The asset script and geometry/audio source are the reproducible source of truth. No generated art is referenced from an external tool cache or remote host.
