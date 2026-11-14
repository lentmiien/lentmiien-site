# The Waking Guardians

## Scope and access

Six additional stages bring the world to fifteen regions. The Rainbound Wilds opens after The Amber Frontier and contains Sunken Belfry, Mycelium Warrens, and Stormglass Causeway. Where Dawn Begins follows it through Sundial Desert, Velvet Labyrinth, and Aurora Crown. Completing that chapter opens the fifteen-region homecoming. The existing routes retain their order and prerequisites.

The new layouts use flooded square rings and towers, connected mushroom chambers, crystal causeway terraces, nested dune rings, woven hedge lanes, and offset aurora terraces. Required objectives are reachable on ordinary paths in both realms. Realm shortcuts and looms add alternatives instead of removing the only route to an objective.

## Guardians

The Bellkeeper, Tempest Roc, and Dawn Hart belong to regions 9, 11, and 14. Each has a fully open 11 × 11 arena outside the ordinary enemy population. The player explicitly starts the encounter at its entrance after gathering three heartseeds. An introductory dialog explains the guardian and preparation benefits. Hearts and focus refill at the start, and the player faces the guardian.

Guardian simulation is independent of player actions. Each encounter cycles through a preparation delay, a marked wind-up, impact, and a 2.9–3.4-second recovery. Warnings show the full footprint, countdown, and realm restriction. The arena camera shows the entire fight and reserves space for the HUD and touch controls. Every pattern leaves reachable safe ground. Ordinary creatures pause during a guardian encounter and cannot enter its arena.

Normal attacks cannot cancel guardian patterns. Guard blocks and counters; movement, dashing, and folding provide alternatives. Realm attacks only affect the named realm. The shell takes at most one damage per hit while guarded; recovery exposes the heart for double damage. Health thresholds enforce three distinct phases, with a short protected transition before the next pattern. Strong equipment cannot erase all phases with one burst.

Bellkeeper patterns use alternating rows/columns, inner/outer tides, and realm-marked bell echoes. The roc targets a three-tile flight lane, lands near the keeper's old position, scatters feather marks, and makes crossing wind lanes. The Hart grows branching roots, makes inner/outer light rings, and sweeps the arena in one realm with a safe lane.

If the keeper falls, the encounter resets at its entrance. Inventory is restored from the snapshot taken on entry; the guardian heals, and expedition findings remain. Voluntary retreat uses the same reset. Retry supply snapshots are bounded and saved. Victory refills hearts/focus, grants a tonic, adds starlight and score, and records the guardian rank.

A first awakening unlocks the corresponding art, charm, and direct trial. Trials use compact arenas without a maze or heartseed hunt. Tier I–III increase guardian health and shorten warnings. Winning a tier opens the next; each first-earned rank adds 40 starlight when rewards are banked. Repeated wins cannot duplicate seal bonuses. Trials cannot award region clears, exploration percentages, landmarks, or survey medals.

## Maze encounters and lasting rewards

Every new-generation exploration maze adds a trader and lost firefly. Maps with realm shortcuts also receive a fold loom. The trader offers one expedition-currency purchase: healing/tonics, bombs/thread, or objective discovery plus guiding thread and focus. Purchases validate proximity, inventory limits, affordability, and the one-purchase state.

A firefly travels with the keeper and is delivered at the waygate for starlight, a tonic, and healing. The guiding thread prioritizes its return. Carried, delivered, total rescued, and already-recorded rescue counts survive saves; synchronization and banking cannot count a rescue twice. Three rescues unlock the Firefly promise charm.

A loom reverses the phase of up to eight nearby shortcuts and reveals them on the atlas. Permanently opened paths remain open. A loom cannot close the keeper's current tile. Orientation is persisted, and restoration applies loom changes before validating the keeper's saved position. Mushroom landmarks provide an additional reusable travel network; other new landmarks open routes or restore the regional secret.

The expansion adds 36 memories, 18 relics, 18 survey medals, three equipped arts, four collectible charms, and nine guardian ranks. Unknown discoveries retain priority. One art and one charm are selected at camp for the next journey; ongoing journeys retain their loadout. Daily journeys standardize both slots and all camp bonuses.

## Compatibility and security

The feature remains fully public and entirely client-side under the existing [security contract](SECURITY.md). No server route, dependency, account feature, environment variable, database operation, or runtime outbound request is added. All generated art is deliberately public.

The storage key remains `lumenwild.garden.v1`; the schema version is 3. Versions 1 and 2 remain readable. The original generator stays in core.js, and the exact previous generator is frozen in world-v2.js. Existing expeditions retain their routes, maps, entity order and discoveries. Version 3 records the new encounter state and uses the new generator. The synthetic version-two fixture includes a digest of its original map for migration regression checks.

The largest map is 43 × 35; guardian patterns have at most 121 cells. Region, guardian, charm, art and trade identifiers come from allowlisted content. State parsing bounds timers, numeric progress, arrays, retry inventory, and save length. Restored boss positions and footprints must belong to the generated arena. Content is rendered with Canvas or DOM textContent; no save data supplies URLs, markup, executable text, or external resource paths.
