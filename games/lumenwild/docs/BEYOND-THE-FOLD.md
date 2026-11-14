# Beyond the Fold expansion

## Scope

Extend the existing game to nine visually and structurally distinct regions: the original three gardens, Tideweave Marsh, Saffron Orchard, Clockwork Cloister, Frostglass Grotto, Cinderroot Caldera, and Astral Canopy. Three regional chapters lead to a nine-region pilgrimage. Completed chapters unlock optional revisits and harder survey expeditions. Existing victories unlock the frontier immediately.

Long-term discoveries include 54 journal pages, 27 regional relics, 27 survey medals across nine regions, regional landmark restoration, six equipped arts, additional expedition blessings, and five camp upgrade paths with 27 total levels. High upgrade tiers require exploration achievements as well as starlight. Unknown relics and journal pages are preferred when preparing a new expedition, so progress rewards exploration without relying on rare random drops.

## Combat

Exploration remains on a tile grid. Enemies now move and resolve visibly telegraphed attacks on a bounded real-time simulation while play is active. Normal sweeps have a brief cooldown and do not interrupt attacks. Dash, guard, a timed counter, folding, bombs, and equipped arts provide deliberate defenses. Enemy attacks cannot overlap damage during the player's recovery grace period. Pausing, dialogs, focus loss, and hidden tabs freeze the simulation; no offline time is replayed on resume.

New creatures have distinct attack footprints: river crabs, thorn mantises, clockwork scarabs, frost owls, ember salamanders, and starmoths. The world presents attack areas and countdowns. Gentle journeys extend warnings and lower damage.

## Compatibility and security contract extension

The feature remains fully public, entirely client-side, and uses the existing security contract. No new server routes, account records, external runtime calls, secrets, uploads, or HTTP mutations are introduced. All new art is intentionally public.

The existing storage key is retained. Version 1 profile fields keep their meanings; purchased upgrades and the first nine memory identifiers remain stable. A frozen legacy map generator restores in-progress version 1 expeditions before the new generation rules apply to new runs. Saves explicitly record generation version, route, discovery selections, and bounded combat timers. Unknown or malformed fields are discarded or rejected. Saves never contain image URLs or executable text. All rendering uses Canvas or DOM textContent.

Maps, content arrays, entity counts, save length, numeric values, cooldowns, and simulation deltas are bounded. Repeated reward collection and loading a completed result cannot award again. Tests cover old saves, invalid new saves, generation and route reachability, chapter gates, progression, genuine one-on-one damage, defensive abilities, pause/resume, and independent enemy clocks.
