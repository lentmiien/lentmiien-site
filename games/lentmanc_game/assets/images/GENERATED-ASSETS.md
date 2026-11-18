# Generated and Constructed Visual Assets

This manifest was initialized before production artwork, as required by the project workflow, and completed as each asset was reviewed. Every final generated or processed runtime image is recorded below with its prompt, dimensions, reference inputs, processing, and continuity notes.

## Production rules

- Built-in image generation is used for original raster artwork.
- Important character references are generated and reviewed before cinematic scenes.
- Later prompts reuse the invariant descriptions in `../../../docs/CHARACTER-BIBLE.md` and reference the approved character art when those characters appear.
- Generated images contain no text, captions, signatures, logos, watermarks, or pseudo-writing.
- Runtime scene art is stored locally as optimized WebP. Reviewed reference masters are retained locally in `characters/`.
- Dialogue portraits are crops from approved reference art, not independently redesigned faces.
- The exploration renderer uses two local WebP atlases. Tile symbols, story conditions, and collision come from `js/maps.js`.

## Exploration artwork

| File | Contents | Processing |
| --- | --- | --- |
| `exploration/terrain.webp` | 1280×1024 atlas of twenty 256px square materials | Thirteen painted ground samples and seven Lumenwild textures, cropped, color matched, and blended at the edges for tiling. |
| `exploration/sprites.webp` | 1536×1888 transparent atlas with 54 frames | Trees, architecture, scenery, story objects, six NPCs, and three views of Aren. Each silhouette is cut out, trimmed, and packed with a gutter. The side view also faces right through mirroring. |

The seven maps share the atlases. The renderer blends ground at terrain boundaries, lays bridges across water, and fits one roof to each connected village building. Crown City’s cutaway walls follow the walkable floor plan. The world chart retains its painted backdrop, HTML labels and SVG routes.

The following assets come from the repository’s `games/lumenwild/assets/` directory and are included in the atlases.

- Terrain uses tiles 3 (undergrowth), 4 (masonry), 15 (rubble), 16 (planks), 24 (causeway inlay), 32 (frozen stone), and 38 (lava).
- Props use 6 (lantern), 8 (carved plinth), 9 (gate stones), 10 (coiled rope and lantern), 11 (journal), 13 (stump), 24 (rolled order), 38 (ember lamp), 44 (bell), 45 (sluice gear), 46 (crystal), 62 (ledger), and 82 (clasp).

### Exploration prompts

The original material and sprite sheets used the built-in image generator. The shipped cast uses the jade-coated healer and silver-haired mechanic from the story-object sheet.

<details>
<summary>Woodland ground</summary>

Use case: stylized-concept. Square 1536x1536 terrain texture atlas, exact 2 columns by 2 rows of FOUR square, edge-to-edge, overhead ground textures for a beautifully hand-painted fantasy RPG. Each quadrant must fill its entire quarter of the sheet to the edges with one continuous homogeneous material. NO spacing, seams, grid lines, gutters, isolated tile platforms, tall plants, trees, large objects, horizon, cast shadows, vignetting, text, UI or outlines around the cells. Camera straight down, gentle soft diffuse light, tactile gouache style with visible confident larger brush strokes and quiet fine detail. Each panel spans about three game tiles on each side so details are small and natural. Top left: softly sunlit woodland meadow floor, believable moss green and sage grasses, tiny grasses and a few tiny cream wildflower flecks on velvety patches of moss; moderate/light values and warm olive glints, gentle small-scale ground variation. Top right: warm buff ochre well-worn compacted earth trail, fine sand and a few tiny dull stone chips and leaf fragments, smooth walkable surface with soft tonal variation, absolutely no grass border. Bottom left: cool damp muted sage-green marsh meadow with low leafy groundcover and warm dark soil peeking through, muted blue-green grasses, open areas, soft mid-tone values. Bottom right: pale silver-blue fresh snow, softly wind-combed white drifts and tiny ice grains, faint lilac-gray shadows, an even ground surface without boulders or landmarks. Use a cohesive restrained storybook palette. Every quarter is a material sample.

</details>

<details>
<summary>Settlement and wilderness ground</summary>

Use case: stylized-concept. Production game art, square texture sampler for a narrative fantasy RPG on a PRECISE THREE-COLUMN BY THREE-ROW equal grid. Nine different full-bleed materials. These are continuous, seamlessable top-down ground surfaces that cover large playable areas. Professional subtle gouache environment painting, soft diffuse light, big quiet shapes, mid-range local value and very low tonal contrast within each material; fine tactile detail without high-frequency noise. No centered motif. No tile outlines or gaps between the nine square panels. No shadows around the panel edges. No people, props, vegetation clumps, or active volcanoes. First row from left: (1) the gray-brown soil of a burned village after rain, a few wisps of pale gray ash and tiny charred splinters in soft earth, broad quiet dusty brushwork, NO stones or flowers (2) smooth packed village road, muted warm gray-taupe clay with scattered tiny gravel chips, worn and matte (3) a waterlogged mill lane, desaturated slate-green moss blending into dark muted earth, a few tiny blades of flattened grass. Second row from left: (1) a very broad sheet of warm blue-charcoal basalt rock, smooth flat surface, only a few fine irregular natural cracks and muted maroon tints, no clustered boulders (2) burnt terracotta volcanic footpath, a smooth continuous expanse of muted rusty charcoal grit with small rust-red cinders, no circular vents, no visible lava (3) deep slowly moving river water, rich desaturated jade-teal, delicate horizontal ripples and subtle bands of reflected pale sky, fine details but open quiet middle values; NO stars, lily pads, bright caustics or islands. Third row from left: (1) a level medieval capital courtyard floor paved by stonemasons, LONG staggered rectangular gray limestone flagstones with silvery sage tones and narrow subtle joints, worn polished planes, larger clean shapes (2) warm sandy honey-taupe OLD STONE ROAD with neat, small, regular fan-set cobbles like a medieval city street, upper surface smoothed by feet, subtle joints, moderately light (3) solid deep midnight indigo arctic ocean with broad horizontal ribbons of subtle reflected moonlight, dark, quiet cold water under an eclipse; no stars, planets, snow, sea ice or land. Allow each material to fill its entire square, straight-down overhead, no lettering, cartography, border or horizon.

</details>

<details>
<summary>Trees, buildings, and terrain props</summary>

Use case: stylized-concept. Game asset: a professionally painted, TRUE TRANSPARENT 2D RPG environmental sprite atlas for Asterra, 4 columns by 4 rows of 16 equally spaced separate environmental sprites, square canvas 2048x2048. EXACTLY ONE complete, independent illustration in each of sixteen equal square grid cells. Each object sits entirely in its cell with empty transparent gutter on all four sides, no visible grid. Consistent three-quarter overhead orthographic JRPG map view, like gouache and ink fantasy background art: richly colored natural materials, readable silhouettes, crisp brushwork, soft warm sun from top left, shadow on lower right of each object only, no ground squares or scenery behind them. Row 1 left to right: (1) mature white-barked silver birch with round clustered sage and yellow-green foliage and delicately branching trunk, (2) slender twin white-barked birches sharing a sunlit golden leafy crown, (3) rounded canopy gray-green wetland willow with drooping branches, (4) mossy layered gray limestone boulder outcrop tufted with moss. Row 2: (1) grouping of forest ferns and a few white wildflowers, (2) cluster of slender wetland bulrushes with rust-brown cattails, (3) mossy fallen birch log with broken twigs, (4) cluster of small copper-orange wild mushrooms on forest duff. Row 3: (1) a whole medieval timber-framed cottage with steep slate-green shingle roof, stone chimney, ochre plaster, visible doorway on the low side, (2) another whole medieval village cottage with ochre thatch roof and white plaster, (3) roofless ruined cottage, with blackened beams and soot-stained broken masonry walls, (4) medieval riverside mill building with slate roof and clearly visible wooden paddlewheel on its right side. Row 4: (1) split black columnar basalt outcrop dark blue-gray with a warm copper edge, (2) jagged blue ice ridge with a cap of white snow, (3) old wooden trail fingerpost with two simple blank planks pointing to the sides, (4) low round stone well with wooden lintel and rope bucket. No text or numbers, no UI, no tile backgrounds, no framing, no modern materials. No other objects. Each object drawn large with clean separation and genuine transparent pixels surrounding it.

</details>

<details>
<summary>Regional landmarks</summary>

Use case: stylized-concept. A polished TRANSPARENT game prop atlas for seven fantasy RPG locations. Precisely 3 columns by 3 rows, nine separate complete illustrated environmental objects, generous TRANSPARENT gutters between every object. No background of any color, no white border, no grid lines, no letterforms. A slightly elevated three-quarter overhead game camera, illustrative watercolor and gouache with crisp ink accents, realistic medieval materials and cinematic, grounded color. Row one left to right: (1) a compact tufted mature birch tree with a broader darker moss-green canopy, pale trunks visible below its spreading asymmetric shadowed branches, quiet olive sage foliage, an irregular silhouette seen from above, entirely within the cell; (2) a long low ruined boundary wall made of stacked gray dry stone, a few weeds between the irregular stones, broken ends; (3) twisted charred tree trunk splitting into two angular bare fallen branches, no leaves, earthy soot. Row two: (1) wide low fractured basalt ledge, irregular flat graphite slabs with two discreet ember fissures, volcanic wasteland NO vegetation or moss; (2) a LOW mound of three wind-packed snowdrifts beside two small outcropping dark blue rocks, soft snow edges, polar landscape; (3) a tall well-built arched medieval stone gateway of gray and buff granite blocks, small slate coping stones, OPEN passage in the center, no doors, no banners, symmetrical front facing, seen slightly from above. Row three: (1) a craftsman's wooden workbench with coiled copper tubes, a small anvil and hanging hand tools seen slightly from above; (2) a small group of watertight wooden crates, two barrels and a coil of hemp rope for a canal landing; (3) a modest medieval market awning of dark rust-and-cream striped cloth over a wooden stall with baskets of bread. All nine stand or rest on invisible ground with genuine transparency around them. No floor tiles, pads, isolated land squares, humans or text. Strong recognizable silhouettes for a beautiful painted town map.

</details>

<details>
<summary>Exploration cast</summary>

Use case: stylized-concept. Production sprite atlas for a painted fantasy JRPG. Square canvas, genuine transparent background, precisely 3 columns x 3 rows, NINE isolated full-body human exploration sprites, one centered in each equal square cell with generous transparent margins and the entire head and feet inside each cell. Cohesive clear hand-painted figures with refined ink and soft cel-shading, readable at 56 pixels high. Slightly elevated three-quarter overhead camera showing the crown of the head, large stylized heads (about three heads tall), chunky silhouettes, clearly separated feet in a natural standing stance, lit from upper left. No text, labels, grid, frames, ground, pedestals, drop shadows, or floor. FIRST ROW: the SAME young man Aren in three directions, chestnut shaggy wavy hair, warm freckled skin, moss green short hooded jacket, rust-orange scarf, tan leather crossbody mushroom satchel, dark trousers, brown boots. First cell FRONT facing the viewer, second cell BACK of head, hood, and satchel facing completely away from viewer, third cell SIDE PROFILE FACING LEFT. Same clothing/hair in all. SECOND ROW left to right: front view of broad sturdy middle-aged bearded woodcutter Bram in a brick red shirt, forest-green vest and work boots; front view of young brown-skinned woman Mira with a dark curly braid, teal river-worker clothes, ochre hip rope and blue sash; front view of tall lean pale-olive Sir Cael with straight black hair tied low, silver left shoulder guard, deep teal tunic and flowing blue-gray cloak. THIRD ROW: front view of silver-haired elderly farmer woman Rowan in indigo dress holding a little warm lantern; front view of Mara a copper-brown skinned female mechanic with brass goggles on forehead and a leather work apron; front view of young prince Lucen with jaw-length dark hair and silver temple streak wearing a midnight navy princely vest, small rust-orange shoulder cord. The image is nine beautiful clear small illustrated video game figures each alone in their cell. Keep precise grid layout.

</details>

<details>
<summary>Story objects and final Mira and Mara sprites</summary>

Use case: stylized-concept. Asset type: nine separate hand-painted game sprites in a precise 3 by 3 square atlas, genuine transparent background, equal square cells with wide clear transparent padding on every side of every complete subject. Storybook fantasy JRPG, slightly elevated three-quarter overhead orthographic camera, sun from upper left, rich painted materials, clear silhouettes even at 56 px. No lettering, grid, frames or backgrounds. Row one from left: (1) the Starling, ONE complete small moored wooden-and-brass fantasy dirigible, huge dark blue-gray oval fabric lift envelope, delicate ropes, ochre canvas fins, warm amber lamps, enclosed hull, seen diagonally from above, wide silhouette; (2) a weathered upright stone with a pale silver ribbon and small white flowers at its foot, intimate village memorial; (3) battered dark metal heater shield with one faded gold sun emblem and rust-orange trim lying tilted on wet earth, no extra weapons. Row two: (1) cluster of delicate ivory bell-shaped wild mushrooms with cool blue shade, fine stems and slender drooping caps; (2) cluster of rusty ochre-orange wild chanterelles with wavy tall fox-ear-shaped caps on soft forest duff; (3) a long medieval oak bookshelf, front spines of old leather folios, a few rolled scrolls, fantasy archive furniture seen from the same elevated camera. Row three: (1) full-body, friendly compact young healer Mira, light golden-brown skin, round mass of jaw-length dark auburn curls with two brass pins, cream blouse, deep jade split apron-coat, cinnamon sash, little herb pouches, charcoal leggings and ankle boots; (2) full-body lean woman mechanic Mara, deep umber skin, chin-length asymmetric SILVER-GRAY hair shaved close on the left, goggles with amber lenses resting on her head, graphite sleeveless long work coat over Ember-orange high collar shirt, dark trousers and brass spanner; (3) a black basalt steam vent, ragged dark stone rim, tiny amber hot cracks, SMALL quiet wisp of vapor, no floor rectangle. Both women are front-facing stylized three-heads-tall RPG exploration figures seen from slightly above, confident ink edges and soft cel shading, not portraits. Each sprite alone in its own cell, entirely visible including roof, hats or feet; transparent everywhere between sprites. No extra subjects.

</details>

## Generated character references

### `characters/aren-reference.png`

- **Purpose:** definitive Aren Vale identity and costume anchor; source for `portraits/aren.webp`.
- **Dimensions:** 1024×1536 PNG.
- **Prompt:** “Aren Vale, lean 19-year-old fantasy villager; warm light-brown freckled skin; amber-brown eyes; notched right eyebrow; tiny crescent scar below left jaw; thick slightly wavy chestnut ear-length hair with three forehead locks; charcoal-blue shirt; short moss-green hooded jacket; rust-orange scarf; dark trousers; tan mushroom satchel; brown boots; pale-gray left-wrist memorial ribbon. Full-body three-quarter pose plus determined chest inset on matte graphite, grounded anime-inspired painted 2D, clean linework, restrained cel shading, no weapon, armor, text, logo, or watermark.”
- **Reference used:** written Aren specification in the character bible; no image input.
- **Processing:** copied unchanged from the built-in image generator. The single upper-body crop starts at (179, 42), spans 409×409, and is exported at 512×512 WebP quality 90.
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
- **Processing:** copied unchanged. The single upper-body crop starts at (135, 64), spans 415×415, and is exported at 512×512 WebP quality 90.
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
| `portraits/aren.webp` | Aren dialogue cards | 512×512 | `aren-reference.png` | 409px square upper-body crop, WebP quality 90 | Neutral portrait; scene text carries other expressions. |
| `portraits/bram.webp` | Bram dialogue cards | 512×512 | `bram-reference.png` | 470px square upper-body crop; WebP quality 88 | Axe appears behind the shoulder as a tool. |
| `portraits/cael.webp` | Cael dialogue cards | 512×512 | `cael-reference.png` | 455px square upper-body crop; WebP quality 88 | The left shoulder guard remains the strongest small-scale identifier. |
| `portraits/edric.webp` | Edric dialogue cards | 512×512 | `edric-reference.png` | 415px square upper-body crop, WebP quality 90 | The locket is below some narrow-screen crops; its alt description remains in dialogue. |
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
- 1 terrain atlas and 1 transparent sprite atlas for 7 authored exploration maps.
