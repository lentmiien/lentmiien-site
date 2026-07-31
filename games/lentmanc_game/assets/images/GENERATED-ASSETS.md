# Generated and Constructed Visual Assets

This manifest was initialized before production artwork, as required by the project workflow, and completed as each asset was reviewed. Every final generated or processed runtime image is recorded below with its prompt, dimensions, reference inputs, processing, and continuity notes.

## Production rules

- Built-in image generation is used for original raster artwork.
- Important character references are generated and reviewed before cinematic scenes.
- Later prompts reuse the invariant descriptions in `../../../docs/CHARACTER-BIBLE.md` and reference the approved character art when those characters appear.
- Generated images contain no text, captions, signatures, logos, watermarks, or pseudo-writing.
- Runtime scene art is stored locally as optimized WebP. Reviewed reference masters are retained locally in `characters/`.
- Dialogue portraits are crops from approved reference art, not independently redesigned faces.
- Exploration sprites and tiles are deterministic canvas constructions described below; they are not presented as generated assets.

## Constructed map visuals

| Asset | Purpose | Construction | Dimensions | Processing and caveats |
| --- | --- | --- | --- | --- |
| Runtime canvas tile renderer | Seven authored exploration maps | 48×48 logical tiles drawn from terrain tokens in `js/maps.js`; layered fills, edge lines, landmarks, collision highlights, props, character silhouettes, and animated amber crystal light | Responsive canvas; 48×48 logical tile | Code-native, no external source. It favors deterministic collision readability over a generated tilesheet. |
| Runtime character sprites | Aren and recurring NPC exploration silhouettes | Two-head-tall canvas sprites assembled from each character’s invariant palette, hair silhouette, clothing blocks, and distinguishing prop | Approximately 28×40 logical pixels | Code-native; not used as portrait reference. |
| World-chart route overlay | Current location, visited trail, and every inter-location journey | Responsive HTML labels and state markers plus SVG route paths positioned from authored percentage coordinates in `js/maps.js` | Responsive over a 3:2 chart | Code-native overlay. Names, route state, and current position are never baked into or inferred from the generated backdrop. |

## Generated character references

### `characters/aren-reference.png`

- **Purpose:** definitive Aren Vale identity and costume anchor; source for `portraits/aren.webp`.
- **Dimensions:** 1024×1536 PNG.
- **Prompt:** “Aren Vale, lean 19-year-old fantasy villager; warm light-brown freckled skin; amber-brown eyes; notched right eyebrow; tiny crescent scar below left jaw; thick slightly wavy chestnut ear-length hair with three forehead locks; charcoal-blue shirt; short moss-green hooded jacket; rust-orange scarf; dark trousers; tan mushroom satchel; brown boots; pale-gray left-wrist memorial ribbon. Full-body three-quarter pose plus determined chest inset on matte graphite, grounded anime-inspired painted 2D, clean linework, restrained cel shading, no weapon, armor, text, logo, or watermark.”
- **Reference used:** written Aren specification in the character bible; no image input.
- **Processing:** copied unchanged from the built-in image generator. Portrait crop extracted at 460×460 and resized to 512×512 WebP quality 88.
- **Continuity review:** accepted. Freckles, warm skin, chestnut hair, rust scarf, moss jacket, satchel, and ribbon are clear. The subtle jaw scar is visible in the master but may disappear at portrait scale.

### `characters/bram-reference.png`

- **Purpose:** definitive Bram Alder identity and costume anchor; source for `portraits/bram.webp`.
- **Dimensions:** 1024×1536 PNG.
- **Prompt:** “Bram Alder, broad sturdy 45-year-old woodcutter and former militia fighter; medium-brown skin; square weathered face; gray-green eyes; broken nose with bridge scar; dark-umber cropped wavy hair graying at temples; short beard gray at chin; brick-red wool shirt; charcoal undershirt; forest-green vest; brown workwear; one right fingerless glove; wooden bird necklace; bound short axe and rope. Full-body three-quarter pose plus rueful chest inset on graphite, grounded anime-inspired painted 2D, protective rather than aggressive, no armor, text, logo, or watermark.”
- **Reference used:** written Bram specification in the character bible; no image input.
- **Processing:** copied unchanged. Portrait crop extracted at 470×470 and resized to 512×512 WebP quality 88.
- **Continuity review:** accepted. Necklace, workwear, broad silhouette, graying hair, nose scar, glove, rope, and tool remain readable.

### `characters/cael-reference.png`

- **Purpose:** definitive Sir Cael Varin identity and Veyran-costume anchor; source for `portraits/cael.webp`.
- **Dimensions:** 1024×1536 PNG.
- **Prompt:** “Sir Cael Varin, lean athletic 37-year-old Veyran knight; cool olive skin; diamond face; cyan-gray eyes; vertical left-eyebrow scar; ink-black shoulder-length straight hair in a low half-tail with silver clasp and one loose right-cheek strand; deep-teal layers; worn graphite scale-and-cloth armor; exactly one silver left shoulder guard; pale blue-gray-lined cloak; black gloves; rib bandage; broken empty scabbard and silver oath cylinder. Full-body plus guilty chest inset on graphite with cyan halo, grounded anime-inspired painted 2D, no gold regalia, text, logo, or watermark.”
- **Reference used:** written Cael specification in the character bible; no image input.
- **Processing:** copied unchanged. Portrait crop extracted at 455×455 and resized to 512×512 WebP quality 88.
- **Continuity review:** accepted. Hair clasp, scar, cool palette, single shoulder guard, pale cloak, rib-protecting posture, and broken scabbard are consistent.

### `characters/edric-reference.png`

- **Purpose:** definitive King Edric Aurel identity and tragic-antagonist anchor; source for `portraits/edric.webp`.
- **Dimensions:** 864×1821 PNG.
- **Prompt:** “King Edric Aurel, imposing but gaunt 52-year-old king; light olive skin; exhausted steel-blue eyes; aquiline nose; close salt-and-pepper beard; scar at left mouth corner; swept-back collar-length dark-brown hair heavily streaked silver; narrow blackened-silver circlet; charcoal military coat with restrained antique-gold piping; wine-red sash; graphite half-cape lined burgundy; glass locket with one pressed pale moonflower. Full-body plus weary-tender chest inset on graphite, cold face light and Ember rim, grounded anime-inspired painted 2D, tragic rather than cartoon-villainous, no text, logo, or watermark.”
- **Reference used:** written Edric specification in the character bible; no image input.
- **Processing:** copied unchanged. Portrait crop extracted from the chest inset at 420×420 and resized to 512×512 WebP quality 88.
- **Continuity review:** accepted. Locket, circlet, beard, silver-streaked hair, wine sash, tired eyes, and restrained dark palette remain stable. Ornament is slightly richer than the everyday military coat but remains within royal-scene variation.

### `characters/supporting-cast-reference.png`

- **Purpose:** definitive identity board for Mira, Mara, Elara, and Lucen; source for four portrait crops.
- **Dimensions:** 1254×1254 PNG, four equal 627×627 quadrants.
- **Prompt:** “Precise 2×2 supporting cast board on matte graphite, no labels. Top-left Mira Fen with golden-brown skin, jaw-length dark-auburn curls, two brass pins on her anatomical left, right-eye beauty mark, cream wrap blouse, jade apron-coat, cinnamon sash. Top-right Mara ‘Cinder’ Vell with deep umber skin, right-cheek burn, asymmetric silver hair shaved on anatomical left, amber goggles, graphite mechanic coat, Ember shirt and brass spanner. Bottom-left Queen Elara with green eyes, honey-brown/silver braided coil, moonflower pin, dove-gray/sage gown. Bottom-right Prince Lucen with green-blue eyes, jaw-length dark hair, right-temple silver streak, navy/cream clothing and Ember cord. Grounded anime-inspired painted 2D, no text or watermark.”
- **Reference used:** written character-bible specifications; no image input.
- **Processing:** the first generation placed Mira’s brass pins on the wrong side. A targeted built-in edit moved only those pins to her anatomical left while preserving the board. Each quadrant was extracted and resized to 512×512 WebP quality 88.
- **Continuity review:** accepted after correction. All four hairstyles, face marks, palettes, and signature accessories are clearly separated and match the bible.

## Processed dialogue portraits

| Filename | Purpose | Dimensions | Character reference | Processing | Continuity caveat |
| --- | --- | --- | --- | --- | --- |
| `portraits/aren.webp` | Aren dialogue cards | 512×512 | `aren-reference.png` | 460px square upper-body crop; WebP quality 88 | Neutral portrait; scene text carries other expressions. |
| `portraits/bram.webp` | Bram dialogue cards | 512×512 | `bram-reference.png` | 470px square upper-body crop; WebP quality 88 | Axe appears behind the shoulder as a tool. |
| `portraits/cael.webp` | Cael dialogue cards | 512×512 | `cael-reference.png` | 455px square upper-body crop; WebP quality 88 | The left shoulder guard remains the strongest small-scale identifier. |
| `portraits/edric.webp` | Edric dialogue cards | 512×512 | `edric-reference.png` | 420px square chest-inset crop; WebP quality 88 | The locket is below some narrow-screen crops; its alt description remains in dialogue. |
| `portraits/mira.webp` | Mira dialogue cards | 512×512 | top-left supporting-cast quadrant | Direct 627px quadrant crop; WebP quality 88 | Corrected left-side pins retained. |
| `portraits/mara.webp` | Mara dialogue cards | 512×512 | top-right supporting-cast quadrant | Direct 627px quadrant crop; WebP quality 88 | Goggles, shaved side, and burn scar all remain visible. |
| `portraits/elara.webp` | Elara dialogue cards | 512×512 | bottom-left supporting-cast quadrant | Direct 627px quadrant crop; WebP quality 88 | Illness is conveyed through scene copy rather than an exaggerated visual. |
| `portraits/lucen.webp` | Lucen dialogue cards | 512×512 | bottom-right supporting-cast quadrant | Direct 627px quadrant crop; WebP quality 88 | No crown in the base portrait; ending art adds the repaired circlet. |

## Generated title, cinematic, environment, and ending art

### `environments/title-key-art.webp`

- **Purpose:** title screen, initial preload, world overview, and title fallback.
- **Dimensions:** 1600×900 WebP, quality 86. `title-thumbnail.webp` is a 256×144 quality-82 derivative for metadata/fallback.
- **Prompt:** “Wide anime-inspired painted 2D title tableau: Aren on a graphite cliff looking across the Hand-shaped Asterra continent; five finger sites, volcanic thumb, southern palm site, and remote snowy island represented by seven Golden Amber beacons; cyan central gate; small Starling airship; eclipsed moon; atmospheric Cael and Edric profiles facing opposing directions; Graphite/Ember/Golden Amber/Veyran-cyan palette; quiet negative space for HTML menu; no text, map labels, logo, or watermark.”
- **Character references:** Aren, Cael, and Edric definitive PNGs.
- **Processing:** initial generation contained eight beacons. A targeted edit removed the small extra beacon immediately left of the portal, leaving exactly seven. The corrected 1672×941 source was center-cropped/resized to 1600×900 and encoded as WebP.
- **Continuity caveat:** the key art is a symbolic aerial view, not a navigable or scale-accurate map. The central cyan ring is the gate, not an eighth crystal.

### `environments/hand-world-map.webp`

- **Purpose:** world-chart backdrop for the always-available map dialog and every travel interlude.
- **Dimensions:** 1536×1024 WebP, quality 86.
- **Prompt:** “Top-down painted fantasy map of Asterra’s Hand-shaped island-continent: broad central palm; five distinct peninsulas; volcanic southwest thumb; forested eastern finger; southeastern reed-and-river finger; rain-dark northeastern mill valley; tiny capital landmark in the upper central palm; separate icy island beyond the northern fingertips; readable paths, rivers, forests, farmland, basalt, cliffs, and snow; anime-inspired hand-painted 2D fantasy cartography; Graphite-blue sea, desaturated forest green, Ember orange, Golden Amber paths, pale cyan ice; entire coastline and generous ocean margin; absolutely no words, labels, compass, legend, border, characters, ships, route lines, pins, UI, signature, logo, or watermark.”
- **Character reference used:** none; this is an environment-only asset based on the geography defined in `docs/GAME-DESIGN.md` and `js/maps.js`.
- **Processing:** copied from the built-in image generator’s 1536×1024 PNG output, visually reviewed, and encoded locally to WebP quality 86 with FFmpeg/libwebp. No crop was required.
- **Continuity caveat:** the painting supplies terrain mood and the recognizable hand silhouette, while exact locations and routes are deterministic overlays. This avoids treating generated coast details as gameplay coordinates and keeps all labels accessible.

### `scenes/willowmere-ruins.webp`

- **Purpose:** prologue destruction and Bram’s arrival.
- **Dimensions:** 1600×900 WebP, quality 86.
- **Prompt:** “Willowmere at blue-hour dusk after a royal-army/crystal-warden battle; Aren frozen in the muddy lane with mushroom satchel and wrist ribbon; Bram approaches protectively; survivors carry lanterns and help one another; discarded graphite/Ember shields; cracked amber stone circle; smoke and damaged timber homes; no bodies, gore, active fighting, monster, text, or watermark.”
- **Character references:** Aren and Bram.
- **Processing:** corrected source center-cropped from 1672×941 to 16:9, resized, and WebP encoded.
- **Continuity caveat:** Bram’s axe is lowered in hand rather than bound during this immediate aftermath; it remains a practical tool and no attack is shown.

### `scenes/ashfinger-rescue.webp`

- **Purpose:** Ashfinger evacuation story encounter.
- **Dimensions:** 1600×900 WebP, quality 86.
- **Prompt:** “Rain-dark canal-village rescue: Mira bandages and directs people to an open sluice, Aren holds a rope line, Bram braces a collapsing beam; distant soldiers retreat from a horned river-stag mineral warden with amber cracks; heroism is protection, not attacking; storm-blue, lantern amber, no gore, active weapon strikes, text, or watermark.”
- **Character references:** Aren, Bram, and the Mira quadrant of the supporting board.
- **Processing:** center-cropped from 1672×941 to 16:9, resized, and WebP encoded.
- **Continuity caveat:** the warden is intentionally distant and oversized so the reckless “fight it” option reads as dangerous.

### `scenes/cinder-thumb.webp`

- **Purpose:** volcanic confrontation with Edric and heat-vent encounter clue.
- **Dimensions:** 1600×900 WebP, quality 86.
- **Prompt:** “Cinder Thumb volcanic standoff: Aren and Bram crouch behind basalt studying a route of steam vents; Edric grips the moonflower locket and commands soldiers seating a weakened crystal; enormous basalt-salamander warden with amber cracks; lava fissures, ancient socket, ash sky; protagonists visibly outmatched; no charge, cackling villain, gore, text, or watermark.”
- **Character references:** Aren, Bram, and Edric.
- **Processing:** center-cropped from 1672×941 to 16:9, resized, and WebP encoded.
- **Continuity caveat:** the generated salamander has a dragon-like neck silhouette, but retains the required low mineral body, obsidian plates, and amber fissures; it is never described as a dragon in-game.

### `scenes/starling-workshop.webp`

- **Purpose:** Crown City airship reveal, Cael confession, and workshop escape setup.
- **Dimensions:** 1600×900 WebP, quality 86.
- **Prompt:** “Secret vaulted workshop under Crown City: Mara on a gantry with amber goggles and spanner; Lucen with keys and unreadable folded records; Aren listens, hurt but composed; Cael extends a silver oath cylinder in apology; the compact wooden-and-brass Starling with dark oval lift envelope, canvas fins, and amber engine lamps fills the upper scene; Graphite forge, Ember and cyan dawn; no readable writing, guns, modern engines, text, or watermark.”
- **Character references:** Aren, Cael, and the Mara/Lucen quadrants of the supporting board.
- **Processing:** center-cropped from 1672×941 to 16:9, resized, and WebP encoded.
- **Continuity caveat:** the illustration defines the final Starling silhouette used by canvas map props and story descriptions.

### `scenes/frostcrown-choice.webp`

- **Purpose:** final choice-battle and ending-selection scene.
- **Dimensions:** 1600×900 WebP, quality 86.
- **Prompt:** “Frostcrown under total eclipse: reachable weakened crystal floating over an empty socket; Aren at the moral center, Bram protective but non-directive, Cael offers indigo wrapping cloth, defeated Edric kneels with cracked circlet and moonflower locket; cyan gate ignites; Starling strains at anchor; ice-moth warden dissolves into amber motes; solemn, no victory pose, duel, gore, runes, text, or watermark.”
- **Character references:** Aren, Bram, Cael, and Edric.
- **Processing:** center-cropped from 1672×941 to 16:9, resized, and WebP encoded.
- **Continuity caveat:** clothing includes location-appropriate frost and tears but does not redesign any character.

### Ending art

One 1774×887 built-in generation produced three explicitly isolated equal panels. It used Aren, Cael, Edric, Elara, and Lucen references and the prompt: “Exactly three equal wordless epilogues: left, Aren and Cael beside seven inert crystal fragments and a dark gate in cold dawn; center, Lucen laying down the sheathed royal sword before citizens while Aren watches and a restored gate glows; right, healthy Elara holding moonleaf while uncrowned Edric offers his signet to Lucen, Aren between the families, open Veyran gate and cyan-leafed trees. Preserve all fixed designs; no text, labels, heraldry, battle, or watermark.”

| Filename | Ending and purpose | Dimensions | Crop/processing | Continuity caveat |
| --- | --- | --- | --- | --- |
| `scenes/ending-severed-dawn.webp` | Ending 1, The Severed Dawn | 600×900 | Left 591×887 panel resized; WebP quality 88 | Seven fragments are symbolic remnants, not seven still-functional crystals. |
| `scenes/ending-crown-of-ash.webp` | Ending 2, A Crown of Ash and Peace | 600×900 | Center 591×887 panel resized; WebP quality 88 | Lucen’s repaired circlet is subtle at small scale; the laid-down royal sword carries the transfer of power. |
| `scenes/ending-open-sky.webp` | Ending 3, The Open Sky | 600×900 | Right 592×887 panel resized; WebP quality 88 | Elara’s healthier complexion and Edric’s missing circlet/cape are intentional story-state changes. |

## Counts

- 5 approved generated character-reference images.
- 8 processed dialogue portraits.
- 2 generated title/environment illustrations plus 1 thumbnail derivative.
- 5 generated cinematic story illustrations.
- 3 ending illustrations cropped from 1 generated triptych.
- 0 raster sprite sheets and 0 raster tilesheets by design.
- 7 deterministic data-authored exploration maps rendered with code-native canvas tiles and sprites.
