# Emberwake Together

Sign in and choose **Emberwake Together · Multiplayer** on the Games page, or open `/emberwake-online/`. The harbormaster lives at `/emberwake-online/harbormaster`. The cooperative client is maintained in its own directory. The original single-player game remains at `/emberwake-isles/` with its browser saves. [Multiplayer source guide](../../multiplayer/emberwake/README.md)

## Playing together

One fresh, seeded archipelago spans 3,072 × 3,072 horizontal blocks and 80 vertical layers. Mossbell Reach, Saffron Atoll, Cloudrest, Prism Crown, Reedglass Haven and Honeycomb Isle have greater footprints and wider channels. The chart includes eleven sea islands, four islets and the two floating islands. The crew shares buildings, rafts, resources, crops, restoration projects, animals and portals. Each sailor keeps their inventory, provisions, discoveries and treasure receipts.

- WASD moves, the mouse looks, Space climbs or swims up, and C dives. Hold the left mouse button to mine. The server awards the block to the first player to finish it. Right click places the selected item. E opens a chest, boards a vessel, fishes or tends a garden. Player avatars take no combat damage from one another.
- B opens the 117-recipe book, I the pack, M the chart and J the journal. Each player has a permanent crew callsign and coat color. The world advances while anyone is aboard, including when field notes are open.
- Each account can collect all 31 treasure sites once. The five new sites include three flooded reef passages and two sealed land chambers. The journal gives clues. Shared storage contains actual item counts. A successful withdrawal immediately changes the contents for everyone using the box.
- A new character has one harbor pennant in slot 8. Place it on a dry floor with headroom. It protects a 64-block horizontal radius at every elevation. Keep markers over 128 blocks apart, over 76 blocks from any treasure and over 84 blocks from the shared landing. Mine your pennant to move home. Visitors can enter and use portals. The owner controls blocks, stations, gardens and storage inside the claim.
- At the outer storm line, a short disaster returns the sailor to their pennant with their pack. The shared landing is the fallback for a sailor without a base. A disconnect during a storm carries the same consequence. An abandoned vessel drifts back to the warning ring on its original bearing. Shared portal exits appear on the chart when a player stands on a placed pad.

## Authority and access

The security classification is **logged in**. The site session identifies the character. The `emberwake.world.play` capability is bundled for the standard account types. The additional `emberwake.world.manage` capability is bundled for admins. Both accept explicit site role grants. The game route, status, assets and maintenance page enforce their capabilities and private/no-store headers. The maintenance mutation is a CSRF-protected POST.

The dedicated Socket.IO engine uses the path `/emberwake-online/live` and namespace `/voyage`. It checks an allowed same-host Origin, the current session, its CSRF token, the current user, required two-factor verification and the play capability. Access is refreshed every six seconds and expires after at most twelve seconds without renewal, or sooner on session expiry. A later authorized join for the same account takes over its existing character. Every command and outgoing state update belongs to a current connection. The old client returns to the harbor screen without automatically reconnecting.

Clients send bounded input and action requests. The server computes movement, reach, collisions, resource awards, claims and ownership. Inventory and personal progress go only to their owner. Storage contents go only to a viewer with a current, unobstructed interaction. Peers receive crew callsigns and poses. The maintenance capability gives no special gameplay access to another sailor’s pack or base. The app supplies its existing login and Mongo connection. Configure exact allowed game origins with `EMBERWAKE_ALLOWED_ORIGINS`; defaults are documented in `env_sample`. A reverse proxy serving the app must pass WebSocket upgrades and preserve the original Host on the dedicated path.

## Checkpoints and maintenance

One app process runs the shared world at up to 20 simulation steps per second and sends updates up to ten times per second. The room starts on the first join. World time, crops and creature timers stop on the last departure. A disconnected character’s food and warmth stop even if others keep sailing.

The Mongoose model uses collection `emberwake_worlds` and document `shared-archipelago`. One validated, schema-versioned checkpoint holds the seed, changed voxels, constructed objects, farms, storage, vessels and all character records. A single majority-acknowledged update commits them together. A revision and renewable 90-second writer lease guard competing processes. An operation ID allows a retry after a lost write acknowledgement. An invalid existing payload closes the harbor for investigation.

Active play checkpoints every 30 seconds. Leaving saves the character’s location and shared changes. The last departure releases the writer. After an abrupt stop, the latest confirmed checkpoint is the recovery point. A new process may wait for the previous writer lease to expire. Vessels from a crash checkpoint remain at their saved positions and can be boarded again. A storage failure freezes play, sends the crew ashore, logs the problem and retries the pending checkpoint. The game retains the prior durable revision until a subsequent write succeeds. Database backups provide historical recovery.

Before planned maintenance, choose **Pause and save** in the harbormaster and wait for the confirmed checkpoint time. This stops simulation, removes all players and saves the paused flag with the world. The flag survives an app restart. **Reopen harbor** admits players again. A failed write is shown as unconfirmed.

The small-crew design supports eight concurrent players and 64 persistent accounts in one world. Limits include 45,000 changed voxel cells, 12,000 placed objects, 512 planted beds, 64 storage chests, 64 vessels and an 8 MiB checkpoint. The interface targets desktop keyboard/mouse and WebGL 2. It has no distributed simulation or client-side movement prediction.

## Local verification

Use the Node version in the repository’s Volta configuration. The focused command is `npm test -- tests/unit/emberwake --coverage=false`. Run the isolated browser scenario from the repository root with Playwright, Chromium and a disposable loopback Mongo. The harness binds a random loopback HTTP port, uses synthetic site sessions, creates a unique test database and drops only that database on exit.

```sh
docker run -d --rm --name emberwake-test-mongo --tmpfs /data/db -p 127.0.0.1:37028:27017 mongo:8.0 --bind_ip_all
NODE_ENV=test EMBERWAKE_TEST_MONGO_URI=mongodb://127.0.0.1:37028 \
  PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome \
  node tests/browser/emberwake/multiplayer.cjs
docker stop emberwake-test-mongo
```

Set `EVIDENCE_DIR` to write screenshots and a JSON report. The browser scenario starts with a pennant, walks to natural driftwood, mines it, crafts planks and places a block observed by a second browser. A separate fixture stages distant locations, two platforms, chest stock and portal pads to exercise the underwater coffer, contested withdrawal, base protection, shared travel and storm respawn. It then tests account takeover, an active checkpoint, maintenance across a reconstructed host, restored progress, permission revocation and the final departure save. The simulation suite also tests mining races at different tool speeds. [Recorded run](validation/results.json)

[Harbor](validation/harbor.jpg) · [Two sailors on Sunwake](validation/two-sailors.jpg) · [Shared chart](validation/shared-chart.jpg) · [Flooded coffer](validation/drowned-coffer.jpg) · [Portal to a protected base](validation/protected-portals.jpg) · [Confirmed maintenance checkpoint](validation/maintenance.jpg)

The release check on Node 26.13.0 passed 7,479 Jest tests, including 41 multiplayer tests. The repository skipped 297 tests under its configured conditions. The four standalone game suites passed all 242 checks, including 128 for the original Emberwake Isles. The Chromium run used two simultaneous players and a disposable MongoDB 8 instance. It rendered one remote sailor at 71 draw calls in the sampled beach frame and recorded zero page errors. The eight-player admission limit was tested in the room model.
