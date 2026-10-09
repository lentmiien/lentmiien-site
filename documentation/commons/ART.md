# Original shipped artwork

The **imagegen** skill at `/home/lennart/.codex/skills/.system/imagegen/SKILL.md` was read and used in its preferred built-in `image_gen` mode. Four successful generation calls created original artwork for this release. No private records, credentials, reference artist, existing character/IP or third-party asset pack was supplied. Gateway and runtime generation are not required.

| Asset | Role |
| --- | --- |
| `public/commons/village-atlas.v1.webp` | 4×2 transparent atlas: hall, cottage, conversation house, refuge, gallery, workshop, tree, keeper/avatar |
| `public/commons/scenery-atlas.v1.webp` | 4×2 transparent atlas: fountain, flowers, bench, lantern post, pond, standing stone, fence, potted plants |
| `public/commons/blue-hour.v1.webp` | Welcome illustration, curated gallery painting |
| `public/commons/cottage.v1.webp` | Owner-only cottage's common interior background |

Exact final prompts are in [ART-PROMPTS.json](ART-PROMPTS.json). Built-in PNG outputs were inspected, then copied/encoded into workspace WebP files with existing Sharp; alpha was preserved in both atlases. The two large backgrounds were resized for delivery. Runtime crops the atlas cells; no per-frame image generation or remote fetch occurs. Generation source PNGs remain in the tool's generated-images location and are not required for deployment; final WebP files are tracked.

`icon.svg`, terrain/path texture, tiny garden plants, progress UI, collision geometry, lantern glow and decoration overlay are original code-drawn work. These are distinguished from the generated raster art above. No external font or asset CDN is used by the standalone Commons page. The Socket.IO client is served by the existing local dependency.

The generated assets authorized for this project and original code-drawn material are distributed with this repository's existing ISC licensing; no additional third-party attribution or paid runtime art service is required. This records provenance and intended reuse, not a claim of exclusive copyright over model output. Future replacement art must keep the same original/generated/licensed provenance and use new versioned filenames for immutable caching.

Fresh review verified the original session tool records: the skill read at 2026-10-08 14:35 UTC and built-in generation calls at 14:36:09, 14:44:41, 15:01:12 and 15:05:25 UTC. All four stored prompts match the calls exactly. `ART-PROMPTS.json` now also records generation timestamps, shipped dimensions, byte sizes and SHA-256 hashes. Both 1774×887 atlases decode with alpha; backgrounds decode at 1440×960 and 1152×960. The fractional 443.5-pixel atlas cell size is intentionally handled by Canvas source rectangles. All four WebPs are tracked and loaded locally; original generation credentials and PNGs are not deployment inputs.


## v1.1 crop correction (2026-10-09)

No raster was edited or regenerated. The generated source art remains the accepted v1 art; `World.art` now gives all sixteen integer source rectangles and the avatar's measured sole contact point. The old fractional 4×2 boundaries cut donor sprites (most visibly the pond's right rim) and included their fragments in neighbors. Crops extend across nominal cell edges where needed, leaving margin for soft shadows and legitimate detached details. They are source windows, not alpha-threshold masks. Destination rectangles use `source size × original scale` and cell-relative offsets, preserving composition and size instead of stretching a trimmed image into a square.

Alpha ≥32 connected-component bounds were diagnostic/test evidence only. The final rectangles were visually inspected through the actual Canvas sprite routine on dark, grass and light backgrounds; the before/after sheets are in [validation-v1.1](validation-v1.1/). The lamp's one-off inset is replaced by the same explicit-window contract as every other sprite. Geometry diagnostics distinguish full nominal cells (cyan), ground blockers (red), world anchors (gold), and visible art. Art above ground footprints may intentionally occlude players.

Unchanged shipped SHA-256 hashes (also retained in `ART-PROMPTS.json`):

| File | SHA-256 |
| --- | --- |
| `village-atlas.v1.webp` | `5f468f27f460c61de84b40a4216a3cd340b853e264e831612c6c1e65e2e54ecc` |
| `scenery-atlas.v1.webp` | `ad0f696067ff74c7234c792ed87462058ef75eeaa0ee51214bb736a859da16ee` |
| `blue-hour.v1.webp` | `c3b196c46072e08307177249eb362cb5011afa3335041ff54057c02a3e5a9d32` |
| `cottage.v1.webp` | `becc5d5f5d98402b95a1694b587cb47e9ea6462314e600cdd3ceb17870fffcbd` |

No art filename/cache rule change is required. All changed client code and CSS use the shared `1.1.0` URL revision. No image-generation skill/tool call was necessary for this code-only extraction correction.
