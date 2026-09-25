# Original reproducible artwork

Generated locally on 2026-09-25 with `scripts/generate-assets.cjs`. These are original code-authored SVG illustrations, not stock imagery or AI-generated photographs.

| File | Purpose |
| --- | --- |
| `coast-poster.svg` | Loading-screen coastal illustration: switchback, cliffs, forest and lighthouse |
| `rover.svg` | Golden Pebble car-selection illustration |
| `tourer.svg` | Sea-green Meridian car-selection illustration |
| `sport.svg` | Ember Comet car-selection illustration |
| `island-map.svg` | Authored coastline, hill contours and exact connected road network |
| `terrain.svg` | Ground colours, meadow patches, town paving, obstacle contact shadows and road markings |
| `terrain.png` | 4096 × 4096 rasterization of `terrain.svg` for the WebGL terrain material |

Run `node games/island-drive/scripts/generate-assets.cjs` from the repository root. It uses the repository's already installed `sharp` package at build time only. The script's seeded world definition and vector source reproduce the artwork without credentials or AI calls. Wait for generation to finish before launching a browser or serving the generated texture.

The game also builds original low-poly car, building, tree and landmark meshes from local source. Three.js is the only vendored runtime library; its MIT notice is in `vendor/THREE-LICENSE.txt`. Original module source and artwork follow the repository's ISC license declared in the root package metadata.
