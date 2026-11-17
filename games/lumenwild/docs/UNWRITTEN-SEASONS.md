# The Unwritten Seasons

## Scope

Six regions continue beyond Where Dawn Begins: Honeyglass Apiary, Paperwind Reach, Singing Quarry, Lanternwake Bazaar, Mirrorsea Observatory, and Lastlight Orchard. Two three-region chapters and a six-region expedition extend the campaign without changing existing routes. Three guardians introduce clearly telegraphed two-strike sequences before an open-heart recovery. Optional realm-key vaults and plantable wishbeds reward exploring both worlds and returning to a place after walking the maze.

## Chapters and exploration

The Hidden Seasons (`seasons`, regions 15–17) opens after Where Dawn Begins. The Unwritten Sky (`unwritten`, 18–20) follows it. The Long Tomorrow (`tomorrow`, 15, 18, 16, 19, 17, 20) unlocks after both chapters and offers five blessing choices. The original nine- and fifteen-region expeditions retain their routes.

| Region | Map shape | Landmark interaction |
| --- | --- | --- |
| Honeyglass Apiary | Staggered, connected wax chambers | Nectar fountains open shortcuts and prepare the guardian |
| Paperwind Reach | Diamond islands with a winding connected route | Restored paper cranes carry the player between islands |
| Singing Quarry | Long fault galleries and side chambers | Sound resonance chimes in numbered order |
| Lanternwake Bazaar | Covered market lanes and connected courtyards | Market lanterns open shortcuts |
| Mirrorsea Observatory | Concentric orbits and seeded radial paths | Restore moon dials in numbered order |
| Lastlight Orchard | A maze around a branching central root road | Evening saplings restore shortcuts and prepare the guardian |

Each region adds six memories, three relics, a creature with four poses, and three survey medals. Six new-region vault discoveries add a persistent atlas count. Region generation stays seeded; ordinary objectives remain reachable in both realms without relying on an optional shortcut or vault.

Every new region contains a Bloom key, an Echo key, a vault, and a wishbed. Keys are collected only in their matching realm; either marks the vault's location on the atlas. Opening the vault needs both keys and grants 24 expedition starlight, 200 score, two bombs, two hearts, full focus, and up to four nearby shortcuts. The reward occurs once per visit; the persistent discovery records each region once.

Wishbeds cost four expedition starlight to plant. They grow one step per actual tile walked or dashed outside an active arena, up to 24. Waiting, casting, blocked movement, and crane travel do not advance them. Harvesting once grants five starlight, 60 score, a tonic, three hearts and full focus. The near-camp placement creates a reason to return after exploring. Neither vaults nor wishbeds gate chapter completion.

## Guardian sequences

| Guardian | Three attack patterns | Persistent gifts |
| --- | --- | --- |
| Honey Regent | Staggered honeycomb; vertical then horizontal flight; targeted nectar then a surrounding ring | Summer shelter art and Nectar locket charm |
| Resonant Warden | Inner then outer shockwave; vertical then horizontal faults; a sweep that changes realm on its aftershock | Mountain song art and Listening stone charm |
| Night Gardener | Crossing diagonals; safe islands on opposite sides; opposite realms with separate safe lanes | The evening light art and Light for later charm |

Each encounter has three health-gated phases and three optional trial tiers. Tier I health is 42, 48 and 54 respectively, with ten extra health per tier. Phase transitions cannot be skipped with a single burst. The first warning has a base 2.25 seconds; its follow-up has 1.55 seconds. Later phases and tiers shorten these slightly; landmarks, Gentle journeys and the patience blessing lengthen both warnings. After both strikes the guardian rests for 3.9–3.4 seconds and takes double damage.

Both footprints are committed together. The current strike uses the existing solid warning and countdown. Dotted lavender outlines with a small 2 preview the next strike. The guardian banner names the current attack, strike number, current realm and follow-up realm. On impact, the second strike becomes the current warning with its own countdown; the guardian does not recover between them. Each strike leaves safe ground, including realm-specific patterns. Ordinary attacks, folding, bombs and arts cannot cancel a committed sequence; crossing a health threshold can end it in a phase transition.

Portrait screens reserve space above the arena for both warning lines. Short landscape screens place the banner to the left of the arena and reserve the right side for the objective, keeping the full board clear of the direction pad and buttons.

Retries refill hearts and focus and restore the exact arena-entry supplies. Voluntary retreats preserve expedition progress. All three guardians support direct rematches, tier seals and the existing reward banking. The older guardians retain their original patterns and timing.

## Security contract

The expansion remains a fully public, entirely local browser game under [the existing security contract](SECURITY.md). Anonymous and signed-in visitors have identical access. There are no machine principals, capabilities, object scopes, admin overrides, HTTP mutations, accounts, uploads, private media, external runtime services, server logs, or database operations. Static art is deliberately public; progress remains in the existing browser storage key and is deleted through the existing reset control.

World sizes, ordinary enemy populations, save length, and the simulation step retain their existing limits. Each guardian strike has at most 121 cells; a sequence has at most two strikes. Save parsing bounds both footprints and realm markers, garden growth, vault progress, and collection IDs. Content uses Canvas and DOM textContent; saved fields cannot select URLs, scripts, or markup. Tests cover invalid sequences and encounter progress, reward replay, old saves, and connected objectives.

## Persistence and artwork

Version four retains the version-three maps and daily routes for in-progress expeditions. New encounters are confined to the six new regions. Old guardian behavior and the original chapter routes remain compatible. A synthetic version-three checkpoint and fifteen map digests capture the previous generator before implementation. The version-one and version-two generator modules remain frozen.

Saves include both guardian footprints, their independent realms, the current strike, key pickups, opened vaults, and wishbed growth. A harvested bed must have reached 24 steps; an opened vault must have both collected keys. Invalid strike indices, outside-arena previews and old-generation routes into new regions are rejected. New daily expeditions sample three bands of seven regions; a continuing version-three daily retains its original three bands of five.

The imagegen skill's built-in tool produced ten source illustrations: two terrain sheets, two creature sheets, two prop sheets, three guardian sheets, and an atlas. Grid extraction and resizing preserve alpha and package 101 WebP assets in `assets/`, adding about 2.49 MiB. No existing asset was overwritten. See [the complete prompt and asset record](../assets/SEASONS-ASSETS.md) and [validation results](VALIDATION.md).
