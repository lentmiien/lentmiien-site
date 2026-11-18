# The Returning Light

## Design and security contract

Two final regions (Dawnroot Approach and Heart of the Garden) conclude the campaign after The Unwritten Sky. The First Keeper guards the heart with three-strike sequences. Completing the final chapter brings an illustrated ending, a permanent camp record, and an ending replay.

Collecting every memory, regional relic, lantern art and collectible charm reveals The Unlit Between. Its Hollow Star has four phases, four-strike sequences, a closed heart that cannot be damaged, faster warnings, shorter openings, and a limited arena supply kit. Camp upgrades and selected equipment still matter. This explicitly optional mastery encounter uses fixed difficulty rather than Gentle mode. Retries restore the entry kit, and combat can still be paused or saved. Its reward is a completion title, excluded from the collection gate to avoid a circular requirement. Consumables, currency, survey medals, vault visits and upgrade levels are not collection items.

The feature remains fully public under the existing security contract: anonymous/admin/family/user have identical access; no machine principals, capabilities, object scope, admin override, server mutations, HTTP APIs, uploads, private media, outbound runtime requests, database or server logging. All new assets are deliberately public in this game directory. Progress stays in the existing localStorage key until reset or browser data deletion. DOM textContent and Canvas render shipped text and validated data. Existing static caching applies to assets only.

Save schema version five accepts the earlier versions. Earlier map generators and daily routes retain their behavior. Bounds remain 43 by 35 maze tiles, 180,000 save characters and 0.1 seconds per simulation step. Boss sequence queues contain at most two additional 121-cell footprints beyond the current and previewed strikes. Save parsing validates strike counts, realms, phase ranges, hidden-stage mode, and optional states. The collection gate is checked when launching and loading a hidden run. Negative tests cover incomplete/duplicate collections, attempts to launch through surveys/dailies/trials, malformed queues, incompatible older generators, reward duplication and invalid hidden checkpoints.

No new dependencies, configuration, deployment operations or application routes are required. Previous artwork and save identifiers remain intact.


## Finished content

- Two distinct layouts, two ordinary enemy species, twelve memories and six relics. Beacons open root shortcuts; heart blossoms require their realm and numbered order. Both regions retain optional paired-key vaults and growing wishbeds.
- First Keeper: 66 base resolve, three phases and three strikes; three standard rematch tiers. Gifts: First light and The home lantern.
- Hollow Star: 152 resolve, four phases and four strikes, no damage outside recovery. Warnings/openings tighten and damage increases in its last phase. Fixed kit and difficulty; chosen equipment and camp upgrades remain.
- Illustrated story ending and camp replay; collection checklist, missing-region filter and visit shortcuts; automatically revealed hidden-stage entry; permanent completion title and personal records.
- 45 new WebP images packaged from built-in imagegen output. See [prompts and file ranges](../assets/FINALE-ASSETS.md).

The hidden guardian is separate from the regional biome list and normal guardian trials. It has no collection pages or relics. Its title does not count toward the unlock gate. The First Keeper remains available as a conventional regional encounter and rematch.
