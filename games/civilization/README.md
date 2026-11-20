# ⚔ Civilization (1991-style)

A 4X strategy browser game inspired by *Sid Meier's Civilization* (1991).
Explore a procedurally generated world, found cities, research a 48-tech
tree across four eras, build roads and an economy, wage war, race rivals
to the world wonders, and conquer every other civilization — all in plain
HTML/CSS/JS, no build step.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
cd civilization
python3 -m http.server 8000
# → http://localhost:8000
```

## How to play

- **Expand** — move a **Settler** to open land, select it, *Found City*.
  Settlers (and later the **Engineer**) can also **⛏ Build Road** on
  their tile: roads cut land movement cost to 1, so your army travels
  faster along them.
- **Cross the sea** — a land unit standing on the coast next to a friendly
  transport (**Ship**, **Transport Ship**, **War Galley** or **Carrack**)
  gets a
  **⛴ Board** button (or click the highlighted blue water tile). Sail the
  ship across, then **⚓ Disembark** on the far shore. Passengers cannot
  fight or found cities, and are lost if the ship sinks.
- **Develop** — cities harvest the 3×3 area around them:
  - **Food** → population growth
  - **Shields** → production (units & buildings)
  - **Science** → research
  Hover any explored tile to see exactly what its terrain does
  (yields, movement cost, defense).
- **Research** — pick the next tech in the Technology panel (right side).
  Techs grant per-city yield bonuses and unlock new units/buildings.
  The panel has three display modes: **HIDDEN** (era titles only — click
  one to expand its list), **SELECTABLE** (only the techs you can
  research now) and **ALL** (the entire tree).
- **Conquer** — select a military unit and click a **blue tile** to move,
  or click an adjacent **enemy unit** to attack (attacking starts a war).
  Wipe out every enemy city to win; lose all of yours and you're done.
- **Diplomacy** — declare war or make peace with any rival. While at peace,
  you may offer a rival a **100-gold gift** (🎁); each gift makes that
  rival much less likely to declare war on you.
- **Production carry-over** — switch a city's production anytime and the
  **shields already invested are kept** and applied to the new item
  (a Settler at 15/30 becomes a Warrior at 15/18). If the carried shields
  already exceed the new item's cost it **finishes at the end of this
  turn** and the excess is discarded — but until the turn ends you may
  still switch to something more expensive to keep them.
- **Wonders** — the **Great Pyramid**, **Great Wall**, **Colossus**,
  **Hanging Gardens**, **Moai**, **Lighthouse of Alexandria** and
  **National Museum** can each be built **once per game**: the first city to finish one claims it,
  and its bonus then applies to *all* of your cities. Claimed wonders are
  greyed out in every city panel.
- **World Rankings** — the right panel shows which civilization is leading
  (cities, units, techs, wonders).

Controls: drag to pan, mouse wheel to zoom, `Enter` to end turn.

## Mechanics (Civ-1 inspired)

- 8 terrain types (ocean, grassland, plains, forest, hills, mountains,
  desert, tundra) with movement costs and defensive bonuses.
- 6 bonus resources (wheat, horse, iron, gold, sheep, fish).
- **27 units** across three domains with attack, defense, HP and
  movement points; melee combat with mutual damage (Civ-1 style math):
  - **Land** (settler, warrior, spearman, archer, longbowman, chariot,
    phalanx, horseman, knight, longswordsman, paladin, catapult,
    musketeer, cannon, rifleman, engineer, mech, missile) — cannot enter
    water, blocked by mountains. Settlers and Engineers build roads.
  - **Naval** (ship, transport ship, war galley, carrack, steamship,
    battleship, gunship) — water only. Ship, Transport Ship, War Galley
    and Carrack are **transports**: they carry one land unit, which
    boards from an adjacent coast tile, rides with the ship and
    disembarks on the far shore (⛴ Board / ⚓ Disembark)
  - **Air** (plane, rocket) — flies over everything, including mountains
- **Stacking**: friendly units may share a square (including their own
  city). Clicking such a square selects the topmost unit (a transport
  ship with a passenger aboard is always preferred); use the *Units
  stacked here* list to pick any unit, and the *⬇ City* button to open
  the city panel.
- **Production carry-over**: switching a city's production keeps the
  shields already invested (absolute, not percentage); over-cost items
  finish at the end of the turn with the excess shields discarded.
- **Settlers** cross any land terrain (they are never stuck) and build
  roads; the **Engineer** (unlocked by Locomotion) builds roads too.
- 22 regular buildings (farm, monument, barracks, wall, market, temple,
  library, aqueduct, castle, academy, lighthouse, observatory, university,
  hospital, factory, radio tower, steel mill, power plant, supermarket,
  stock exchange, hangar, research lab) plus
  **7 world wonders** (great pyramid, great wall, colossus, hanging
  gardens, moai, lighthouse of alexandria, national museum).
- 48-technology tree in 4 eras (Ancient → Medieval → Industrial →
  Modern), with prerequisites and unlock effects. Tech costs scale by
  era — Ancient ×1, Medieval ×1.25, Industrial ×1.75, Modern ×2.5 — and
  per-city science bonuses are soft-capped (Civ.SCI_BONUS_CAP), so
  research stays a long pole into the late game. Tune Civ.ERA_COST_SCALE
  in js/data.js to change the pace.
- Map sizes: **Small 24×24, Standard 32×32, Large 44×44, Giant 56×56,
  Colossal 64×64** — the generator is size-agnostic, resources scale
  with area.
- City capture (conqueror razes buildings), unit healing, fog of war,
  deterministic seeded map generation, and difficulty-scaled AI rivals
  that expand, research, build, declare war, fight — and respond to
  your gold gifts (gifted rivals are calmer).
- Retro WebAudio bleeps (turn tick, discovery chime, war drum,
  victory/defeat fanfare) with a 🔊 mute toggle; all audio is
  synthesized at runtime, no asset files.

## Tests

Headless engine tests (no browser needed):

```bash
node test/smoke.js    [seed] [turns] [easy|normal|hard]   # sanity play N turns
node test/aggro.js    [seed] [turns] [easy|normal|hard]   # aggressive bot → victory/elimination
node test/reachable.js                                                # movement / corner-cut / domains
node test/engine2.js                                                  # domains, costCap, roads, wonders, stacking
node test/gifts.js                                                    # gold-gift diplomacy
node test/transport.js                                                # board -> sail -> disembark, sunk carrier
node test/progress-carry.js                                           # shield carry-over, content sizes, cost scaling
```

Browser integration tests (Playwright + Chromium; screenshots in `test/shots/`):

```bash
npm install playwright     # once (Chromium binaries may already be cached)
node test/browser-test.js   # start, build, tech, move, gifts, mute
node test/ui-flow.js        # stacking UI, road action, terrain tooltips
node test/transport-ui.js   # ⛴ Board button -> aboard -> sail -> ⚓ Disembark; colossal map
node test/refine4-ui.js     # tech panel modes (hidden/selectable/all); carrier-first selection
```

## Files

```
index.html      page + overlays (new game / help / victory / tooltip)
style.css       retro dark UI theme (build grid, rankings, tooltip, ...)
js/data.js      terrain, resources, 27 units, 29 buildings (7 wonders), 48 techs
js/mapgen.js    seeded value-noise world generation + start spots
js/game.js      engine: turns, yields, movement (domains/roads), combat, tech, wonders, capture
js/ai.js        heuristic AI opponents (research/build/expand/war/wonders)
js/render.js    canvas renderer: tiles, roads, cities, units, camera, hover
js/sound.js     tiny WebAudio bleeps (turn / tech / war / win / lose)
js/ui.js        panels, selection/stacking, build tooltips, rankings, diplomacy, overlays
test/           headless + browser tests and screenshots
```
