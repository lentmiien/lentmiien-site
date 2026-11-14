# Original Lumenwild artwork

Generated with the built-in image generation tool on 2026-11-14. No runtime image service is used. All final web assets are saved in `games/lumenwild/assets/`.

The source sheets were mechanically split at regular grid boundaries, alpha-trimmed, resized, and encoded to WebP with the existing Sharp dependency. Transparency is preserved. Runtime assets include directional fox poses, creature frames, collectibles, props, and biome terrain. Source outputs remain in the local generation library.

## Final prompt set

### cover

Use case: stylized-concept. Asset type: original title-screen illustration for a polished exploration game called Lumenwild (no text in image). Landscape 1536x1024. A tiny adventurous amber fox in a dark teal hooded traveling cape carrying a warm golden lantern, seen from behind at lower center, looking over an enormous magical botanical stone labyrinth in a deep twilight forest. Maze paths and branching bridges very clearly visible winding into the distance; ruined circular gateways, lush moss, jade foliage, orange fireflies, glowing teal mushrooms, little ivory flowers, ancient brass mechanisms. A luminous giant tree at distant center. Rich hand-painted storybook fantasy, precise beautiful details, atmospheric layers and soft volumetric light, a world one wants to explore. Graphite shadows, emerald and blue teal forest, golden amber and ember light. Cinematic composition, readable silhouette, generous dark areas toward bottom for title overlay. No lettering, no logo, no watermark, not pixel art.

Transparent background: false.

### fox

Use case: stylized-concept. Asset type: production game sprite sheet, transparent background, 1024x1024. Exactly 4 columns and 2 rows of evenly sized cells with equal empty gutters. One consistent charming amber-orange fox explorer with large ears, cream muzzle and tail-tip, dark teal hooded short cape, small leather satchel and glowing golden lantern. Polished hand-painted 2D adventure game sprites, three-quarter overhead camera, strong clear silhouette, detailed clean edges. Row 1: facing down front view idle; facing left profile idle; facing right profile idle; facing up back idle. Row 2: same four directions in a walking step pose. Each complete fox fits in central 80% of its cell, feet aligned within each cell, no overlap. Isolated figures only on genuine alpha transparency, no floor, no shadows outside figures, no letters, no grid lines, no border.

Transparent background: true.

### creatures

Use case: stylized-concept. Asset type: production enemy sprite atlas, genuine transparent background, square 1024x1024, exactly 4 columns and 3 rows of equal square cells. Clean even spacing, all creatures fully contained within central 75% of their cell. Polished hand-painted 2D fantasy adventure game style, three-quarter overhead view matching a tiny lantern fox in a botanical maze. Each row shows 4 distinct animation frames of SAME creature left to right: idle, walking, preparing attack with brighter glow, defeated fading. Row 1: squat moss-covered thorn beetle with little amber eyes, deep green shell. Row 2: mischievous floating purple wisp with a pale mask and flowing plum ribbons. Row 3: stout ancient stone-and-brass garden sentinel with luminous turquoise core, rounded shoulders and root feet. Friendly spooky, appealing and readable at small size, crisp edges, rich painterly texture. No floor, no rectangular backdrops, no text, no grid lines, no watermark.

Transparent background: true.

### relics

Use case: stylized-concept. Asset type: production prop sprite atlas for Lumenwild fantasy garden maze game. Square 1024x1024 genuine transparent background. Exactly 4 columns x 4 rows of 16 equal square cells, each item fully centered in central 75 percent of its cell with generous empty gutters, no overlapping cells. Rich polished hand-painted storybook fantasy, three-quarter overhead view, clear readable small-game icons, graphite jade teal and warm amber light. Row1 left to right: small cluster of golden light crystals; glowing ivory winged seed; red glass healing potion with leaf stopper; round brass glowing blue flash-bomb. Row2: floating golden compass needle on teal ribbon; closed wooden treasure chest with brass trim; glowing amber lantern on short mossy stone pedestal; magical circular mossy stone arch portal filled with teal glow. Row3: ancient circular floor rune stone with gold spiral; three unlit stone rune pillars clustered; cozy glowing camp lantern with rolled blanket; old open journal with pressed leaves. Row4: enormous blue bioluminescent mushroom cluster; moss-covered gnarled tree stump with orange flowers; glowing golden flower blooming in stone bowl; luminous jade butterfly spirit. Isolated objects only, no floor background, no labels, no grid, no borders, no watermark.

Transparent background: true.

### terrain

Use case: stylized-concept. Asset type: square 1024x1024 top-down seamless terrain tile atlas for a polished painterly botanical maze game. EXACT 4 columns by 4 rows, sixteen equal square tiles filling image edge-to-edge, NO gutters, NO borders, NO text. Each tile is viewed directly from above with only subtle dimensional edge highlights, richly hand-painted but not noisy. Row 1: dark jade mossy cobblestone walkable floor; mossy dense teal hedge wall; dark emerald water softly glowing; flat dark green leaf litter clearing. Row 2: dark blue ancient stone walkway; tall crumbling slate-blue stone wall top covered in cyan ivy; deep blue starry magical void; blue-gray smooth flagstone clearing. Row 3: dark plum terracotta garden floor; thick dark plum thorn hedge wall top dotted small pink blossoms; deep dark violet water; dark purple petal-covered garden clearing. Row 4: luminous amber golden runic barrier on dark stone; luminous cyan runic barrier on dark stone; moss-covered square platform with round subtle spiral; dark graphite rough rock. Cohesive sophisticated dark palette, floors clearly quieter and darker than textured walls, legible at 64 pixels per tile, no perspective tilt, no characters, no UI, no outlines around tile boundaries.

Transparent background: false.
