# Emberwake Together

This is the browser client and shared voxel code for the logged-in cooperative game at `/emberwake-online/`. Future multiplayer changes belong here and in `services/emberwake/`. The standalone game under `games/emberwake-isles/` has its own code and save format.

| Change | Start here |
| --- | --- |
| New islands, reefs, treasure sites | `js/data.js`, `expansions.js`, `spectrum.js`, `sky-isles.js`, `soundings.js`, then `world.js` and `cartography.js` |
| New blocks, items, recipes or furniture | `js/data.js`, `mesher.js`, `scripts/generate-assets.cjs` |
| Movement, interactions or player rewards | `js/game.js` and `services/emberwake/voyager.js` |
| Shared rules, ownership or persistence | `services/emberwake/simulation.js`, `state.js`, `room.js` and `repository.js` |
| Controls, menus, chart and crew avatars | `js/boot.js`, `renderer.js`, `crew-avatars.js`, `css/` and `views/emberwake/` |
| Authenticated requests and realtime messages | `routes/emberwake.js`, `socket_io/emberwake.js`, `services/emberwake/policy.js` and `protocol.js` |

Keep existing numerical block IDs, item keys, personal treasure IDs and seeded geometry stable once a multiplayer world has been created. Add a migration in the checkpoint decoder when changing a persisted layout. A new object type needs an explicit owner or sharing rule, an authoritative action and a round-trip test. Natural treasure belongs in the base-exclusion list. Gate interactive storage at transfer time as well as on opening. Treat the browser as a renderer and input device.

Rebuild illustrations with `node multiplayer/emberwake/scripts/generate-assets.cjs`. Run `npm test -- tests/unit/emberwake --coverage=false` from the repository root. The operations guide covers the database, the harbormaster, the local multi-browser test and its screenshots. [Operations and verification](../../documentation/emberwake/README.md)
