# Lantern Commons — first release

**v1.2 development:** see [delivered features and release steps](V1.2.md),
[extended security contract](V1.2-SECURITY.md), and [validation](V1.2-VALIDATION.md).
The v1/v1.1 material below is retained as historical context; v1.2 supersedes its sealed
Shelter, Hall portal, empty family/user diary bundles, and world-only index statements.

A private, peaceful village at **`/commons`**. This change is prepared for the normal release process; it does not deploy, run setup, restart services, provision a GPU, or change any real account grants.

## v1.1 corrections — release handoff

The correction branch is **`feature/lantern-commons-v1.1`**, based on fetched `origin/dev` at `591eb138192828d3c3807e66d470d79cd3df840b`. Release through the normal feature → dev → main review process; this work does not merge, deploy, restart production or write live data. The expanded v1 feedback below is retained as historical evidence, including its hypotheses. The additional report that the **pond's right edge is cut off** is confirmed by the source atlas and corrected here.

| Feedback / observation | v1.1 disposition |
| --- | --- |
| Pond clipped on its right; repeated cottage marks; flower/stone/pot fragments | **Fixed.** All 16 sprites have individually reviewed integer source windows, including donor overflow. Drawing keeps the original source scale and cell-relative placement; no stretched trims, hidden right edge, regenerated art or changed WebP bytes. Both atlases have before/after sheets on grass, dark and light backgrounds. |
| Pond/fountain permit entry from north and block grass to the south | **Fixed.** Offset ground ellipses cover the water/rim rather than transparent cells or the fountain pillar. Depth sorting uses their ground centers. Cardinal and diagonal shared-movement tests and real-socket browser approaches exercise the boundaries. |
| Hall collider reused smaller house dimensions | **Fixed for the Hall.** Its foundation has a wider, taller rectangle. Other building footprints were checked and retained; their roofs and awnings may occlude a player. Entrances, exits and interactions remain reachable. No blanket silhouette collision. |
| Benches and small props need checking | **Fixed bench base alignment.** Its narrow ground ellipse follows its feet. Lamp/pot/flower source crops were corrected; their small existing circular blockers remain. These are simplified point-collision footprints, not per-pixel silhouettes. |
| Trunks on roads; crowded pond shoreline | **Fixed locally.** Seven road-intersecting trees, three pond-edge trees and one tree obscuring the relocated Sage bed were repositioned. All 45 trees remain. Outer-loop corners bypass the end cottages; the avenue bypasses Hall/fountain; inner paths bypass Gallery/Workshop foundations. Shared road definitions now drive rendering and clearance tests. |
| Gardens, pots, lamps and benches on lanes | **Fixed placements.** The three existing beds sit beside the lane, clear of the avenue. Roadside pots/lamps and plaza benches are offset from the through-routes; one flower group moves aside. Full road widths and centerline travel are tested. No prop or interaction was removed. |
| Discovery stones and cultivation beds traversable | **Checked; intentional v1 behavior retained.** No new blockers. All 24 interaction locations and 12 cottage exits connect to spawn in a quarter-unit navigation audit. Grass remains traversable. Plaza rings are decorative paving, not promises of unobstructed circular travel. |
| Feet detached from gold contact ring | **Fixed.** Visible soles anchor to the authoritative player point. Body bob no longer lifts the feet; ambient lights still animate and reduced motion still applies. Movement remains point-based at four units/second with the same axis sliding and limits. |
| Mori resembles the player | **Checked; new character art deferred as feature/design scope.** Both deliberately retain the accepted sprite. Mori's keeper label, player name and colored contact ring distinguish them; labels now keep their screen text size across game zoom. No avatar system added. |
| Completed loop still instructs gathering/crafting; zero petals | **Fixed guidance.** Made lanterns point home; decorated cottages acknowledge completion. Zero petals after crafting is expected consumption, not inventory loss. The compact mobile journal still prioritizes progress; the fuller paragraph is visible in the desktop journal. |
| Own home / distant location labels | **Fixed own-home visibility.** Its label no longer has the 16-unit cutoff when it is within the viewport. Other distant names retain the existing cutoff to avoid clutter; Field guide retains lane/number directions. No new navigation action or map feature. |
| Empty “Within reach” / orange disabled button | **Fixed presentation.** Empty lists show the existing instruction; disabled primary actions use Graphite and say “Nothing in reach.” Disabled semantics remain intact. |
| Dark strip at camera edge; clipped boundary crowns | **Fixed camera framing.** Follow is clamped to map bounds; views larger than the whole map center it with balanced margins. Perimeter canopy clipping at the map edge and offscreen objects are intentional; no missing terrain tile was found. |
| Vegetation density / small text | **Localized correction only.** Road and shoreline clearance improves specific crowded areas without removing trees. Journal/progress text is larger and world labels stay 12 CSS pixels at all game zooms. General vegetation density is subjective and retained. Physical-phone accessibility still needs Lennart's later verification. |
| Production GET 500 / unavailable probe | **No confirmed Commons defect.** The supplied read-only evidence does not establish an outage or the TypeError's cause. Local real HTTP/session/socket routes pass; no infrastructure or unrelated log investigation was added. |

**Save compatibility:** `World.VERSION`, schema 1, `_id: lantern-commons-v1`, collection, account/plot allocation, inventory, progress, receipts and interior model are unchanged. There is no bulk migration or reset. Admission leaves valid positions (including private interiors) unchanged. An outdoor point invalidated by corrected geometry moves to the nearest clear quarter-unit sample within four units, ordered by squared distance, then y, then x for deterministic ties. Only x/y change. Facing and all other fields survive. If there is no local solution, the existing village spawn fallback is used with facing preserved; it logs `commons.position` without account/position data. Invalid interior transforms retain the previous village fallback. Repair is persisted through the existing admission transaction, not a separate maintenance job.

**Cache/release:** world, renderer, client and CSS URLs all use `?v=1.1.0`. This revision is independent of persistence version 1; snapshots carry `clientRevision`, and a mismatched corrected client asks for a reload. Ship the Pug, server and client changes together and reload existing tabs after the normal release. `.v1.webp` files retain their exact bytes, hashes and one-year immutable policy; ordinary code retains its one-hour static policy. There are no new dependencies, environment variables, credentials, routes, capabilities, mechanics or feature removals. The existing [security contract](SECURITY.md) remains applicable.

Evidence, reproduction, current test totals and remaining real-device/Mongo checks are recorded in [V1.1-VALIDATION.md](V1.1-VALIDATION.md). The [art record](ART.md) describes the crop-only correction and unchanged hashes. After the eventual reviewed release, Lennart should perform the existing smoke checklist plus water/Hall approaches and saved-position continuity through the coordinator's normal verification workflow; this Codex turn performs no production verification or deployment.

## What ships

- A 64 × 48 tile village: Lantern Hall, Conversation House, sealed Shelter, Amber Gallery, Willow Workshop, three garden beds, three woodland stones, twelve cottages and Mori the lantern keeper. The smaller finite map keeps landmarks within a short walk.
- Original generated building/character and scenery atlases, gallery painting and cottage interior. All raster art ships locally; no runtime image generation. Graphite/Ember/Golden Amber chrome, responsive field notes, keyboard and on-screen directions, DPR/resize support, reduced ambient motion, daylight and legible night lighting.
- Server-authoritative position, facing, scene, collisions, actions and inventory; nonblocking players, 20 Hz simulation, 10 Hz snapshots, 300 ms input expiry. The server never accepts client positions, rewards, owner IDs, URLs or arbitrary code.
- Up to ten online residents, **one active connection per immutable account ID**, twelve permanently assigned plots, one member per cottage. The first successful admission reserves the lowest unused plot. Existing residents retain their plot after being offline or losing a grant; plots are not silently reassigned.
- A complete first-lantern loop: discover three stones, water three beds for petals, make a lantern at the workshop, then decorate your private cottage. Each bed rewards each resident once per Tokyo calendar day. Petals cap at twelve; community care at 9,999. Progress and decorations persist.
- Chat5 opens its normal page only after its existing `chat5` permission check. Hall diagnostics require `commons.operations.read` **and** admin identity. The Shelter never reads stock, household records or statuses. Gallery displays only shipped artwork, not the private image library.
- Optional real nonstreaming Gateway text adapter for Mori, disabled by default; clearly labelled scripted dialogue when disabled and fallback dialogue when unavailable. No tools, personal retrieval, ASR, TTS or cross-player memory.

## Access and configuration

The short mandatory security contract is in [SECURITY.md](SECURITY.md).

| Capability | Admin bundle | Family bundle | User bundle |
| --- | --- | --- | --- |
| `commons.world.play` | Yes | Explicit grant | Explicit grant |
| `commons.npc.talk` | Yes | Explicit grant | Explicit grant |
| `commons.operations.read` | Yes | No diagnostic access, even if granted | No diagnostic access, even if granted |

The existing **`/admin/manage_roles`** catalog includes the three capabilities. Under **Update permission → Select role to modify**, choose the account in **Users** (or the intended bundle in **Groups**), verify **Role type** is `user` (or `group`), retain existing checked permissions, check the required Commons capabilities, and click **Update**. The form replaces the selected record’s permission list; it does not append implicitly. Its existing typed user/group grant forms can assign `commons.world.play` and, optionally, `commons.npc.talk` to selected residents or groups. No grants are inserted by this release. Admin works without a role-record migration. Removing an assigned play grant revokes access within the realtime audit window; an admin's built-in grant requires demotion/deletion, session revocation, or disabling the feature. The site’s existing validated principal supplies identity. The normal navigation catalog discovers Commons under **Documents & utilities → Village & play** for authorized accounts. The route enforces access independently of navigation.

| Variable | Default | Behavior |
| --- | --- | --- |
| `COMMONS_ENABLED` | `true` | Exact `true` / `false`. `false` closes entry and does not install the game socket transport on next normal application start. |
| `COMMONS_MAX_ONLINE` | `10` | Integer 1–10. Does not change twelve lifetime plots. |
| `COMMONS_ALLOWED_ORIGINS` | `https://home.lentmiien.com` | Exact comma-separated browser origins, no trailing slash/path. Must include the actual Site origin. Development origins must be explicitly added. |
| `COMMONS_NPC_ENABLED` | `false` | Exact `true` / `false`. Does not provision or reserve a GPU. |
| `COMMONS_NPC_MODEL` | empty | Required when NPC enabled; an already available Gateway text-model ID. No dynamic user model selection. |

Invalid game configuration fails closed and logs `commons.config`. Existing Mongo/session settings still apply (see the setup table below). No dependencies or lockfile changes are required. Node remains the Volta-pinned version in `package.json`.

NPC uses the same `/llm/chat` protocol inspected in `utils/Ollama_API.js`, at the existing `OLLAMA_BASE_URL`, otherwise `AI_GATEWAY_BASE_URL`, otherwise `http://192.168.0.20:8080`. Both URL variables must be an `http://host:port` or `https://host` origin, optionally ending in `/`, without credentials, query, fragment or another path. There is no separate Commons service-name variable: `COMMONS_NPC_MODEL` is a Gateway model-catalog key, and the existing Gateway maps it to its provider/service. Commons sends no service lifecycle requests. The ordinary inference request can invoke the Gateway’s existing scheduler/cold-start behavior; Commons does not control that behavior or guarantee a warm model within twelve seconds. Enabling it is an explicit operator choice to use that configured Gateway. The request contract was also checked read-only against `ai-services/ai-gateway/app.py`: `prepare_llm_chat_request` accepts model/messages/stream/max_tokens/temperature, and `/llm/chat` returns an Ollama-style message (OpenAI providers are normalized there). No live inference was performed. The narrow adapter avoids importing Chat5’s tool manager, debug prompt logging, model refresh, conversation history and job callbacks. Only safe fictional lore plus that connection's own six recent messages (three user/assistant exchanges) are sent. Input is 400 characters; output is capped to 1,200 characters/180 requested tokens; timeout twelve seconds; cooldown fifteen seconds/user; one request/user and two globally; no retries or redirects. It cancels the local request on disconnect and discards stale replies after takeover or revocation. A provider may continue work remotely after HTTP cancellation; Commons makes no GPU cancellation/reservation guarantee. Provider work holds neither the room queue nor the normal action lane. Responses are private plain text and cannot perform game or site actions. Users without talk capability still receive a scripted local note from Mori.

## Persistence, sessions and process ownership

`CommonsWorld` is registered in `database.js`, stored in Mongoose’s **`commonsworlds`** collection, record `_id: lantern-commons-v1`. It contains schema version 1, revision, lease owner/expiry, last successful save, bounded resident records and the community bloom count. Resident fields are immutable account ID, plot, scene/position/facing, petals, lantern/decorated flags, discoveries, daily care receipts and the last 64 action receipts. No account names, private tool state, model conversation or credentials are persisted in this record. Public presence uses `Villager N` aliases. Only visible outdoor transforms, lantern appearance and fixed emotes are shared; inventories and cottage interiors remain owner-only. Players inside homes disappear from the outdoor snapshot. The aggregate online count includes residents in cottages.

A single atomic world document permits garden actions and per-player rewards to commit together without Mongo multi-document transactions. Writes use majority acknowledgement, a revision predicate, owner token and unexpired lease predicate. Mongo’s built-in unique `_id` index is sufficient; no index migration or startup database maintenance is required. The first authorized join lazily creates the record. Invalid/unsupported saved schemas fail closed; do not relabel a newer record as v1. Future geometry/schema changes need an explicit version/migration decision. Geometry is fixed in `public/commons/world.js`.

**Supported deployment: one Express app worker/replica serving the Site and its in-memory session store.** Repository inspection found the normal `node app` entrypoint and no checked-in cluster/process-manager deployment manifest; the live service topology was not queried or changed. There is no claim that production’s current process count was verified. A second Commons process contends for the same 20-second Mongo lease and refuses admission while occupied. This is a safety guard, not active-active clustering or load-balancer support. **There is no startup worker-count detector and no single-worker opt-in variable. `COMMONS_ENABLED` defaults to `true`.** The guard is lazy on the first join, not an application-start failure. A contender logs `commons.lease` and that game connection receives `ROOM_UNAVAILABLE`; the normal Site stays up. If topology is unknown or incompatible, keep `COMMONS_ENABLED=false` until a single app worker is selected. Merely using sticky routing is insufficient for this release’s one-connection guarantee. Keep host clocks synchronized; lease deadlines use application wall-clock time. Cross-host skew-tolerant leadership and distributed sessions are outside v1.

Every successful save renews the lease. Movement checkpoints run every five seconds while inhabited, and disconnect writes the most recent accepted transform. Gameplay actions, initial plot allocation and interior changes are saved before success is acknowledged. A crash may lose movement since the **last successful checkpoint** (normally up to five seconds, longer if the process/database stalls); acknowledged durable actions rely on Mongo’s configured durability. No browser-unload event is needed. Simulation pauses while a save holds the room queue. Inputs expire; no catch-up movement is applied after a long stall. Lease expiry stops snapshots and closes the room even if a save is hung; late save responses cannot resurrect it.

The last disconnect checkpoints and releases the lease. Empty rooms hold no active resident state and perform no background world simulation; lightweight unref'ed timers remain. On process crash the lease can take up to twenty seconds to expire before re-entry elsewhere. Save failure closes all game connections with an explicit recovery message and drops unconfirmed memory. A fresh join reloads durable state. Mongo operations have a two-second server operation budget; driver connection/selection timeouts may be longer, so admission or failure reporting can take longer. Normal application shutdown will close sockets; browser unload and graceful shutdown are not durability requirements.

Sessions use the existing **Express MemoryStore**, not Mongo. A process restart invalidates all browser sessions even though game progress survives. Residents must sign in again, reload `/commons` for a new CSRF token, then enter; account ID restores the same cottage. The default cookie lifetime is 24 hours; game socket activity does not refresh the browser cookie. A normal network interruption can reconnect automatically while the session remains valid. Explicit takeover does not reconnect the old tab automatically.

Duplicate admission replaces the connection only after saving. Old disconnects carry a connection token and cannot remove or overwrite a replacement. Action receipt IDs are remembered across restart (last 64/resident); the client retries an uncertain action acknowledgement once with the same ID. Older receipts can age out; daily garden guards and the one-time crafted-lantern flag independently prevent repeated reward farming. There are no trading or consumable transfers.

The game has its own **Socket.IO namespace `/commons` on transport path `/commons/socket.io`**, with its unused default namespace denied, WebSocket only, 4 KiB incoming frame limit and Origin check before session work. The legacy `/socket.io` server and its chat authorization remain unchanged. The game reloads the existing session store and current principal/capabilities on handshake, on every command and every three seconds. Movement/snapshots require authority no older than five seconds, measured from the beginning of the authorization lookup and never outlive the cookie expiry. There are at most four concurrent handshake authorization tasks and four room admissions (active sockets also have separately bounded command/audit checks), twenty admission attempts/second, a 1.5-second per-account admission cooldown, twenty input events/second/socket and two normal action attempts/second/socket. No arbitrary rooms or broadcast chat are accepted.

## Time, privacy and retention

All daylight and daily garden rewards use server Unix time interpreted at **Asia/Tokyo (UTC+09:00, no DST)**. Night tint is capped at 40%; lantern lighting and labels remain readable. This is a full real day, not an accelerated game day. Client clocks never decide rewards. Scheduled fireworks/event windows are deferred.

World records persist indefinitely, capped at twelve residents. No in-game deletion/reallocation ships. Administrative retirement/reset requires a deliberate maintenance change with the feature stopped and the private collection backed up; avoid manually editing active lease/revision fields. Removing the whole world loses all progress and plot reservations. NPC memory disappears with the socket/process. Shipped art is intentionally public; world/page/diagnostic responses are private/no-store, noindex and analytics-free. Do not expose the Mongo record, logs or private image storage through static routes.

## Deployment handoff (no deployment performed)

1. Release the pushed feature revision through the usual reviewed process. In a clean deployment checkout, fetch `origin/feature/lantern-commons-v1.1`, select the reviewed commit, use Node **24.20.0** from `package.json`, and run `npm ci` for a fresh install. This feature adds no packages and changes no lockfile. Retain existing deployment secrets and private storage; do not copy synthetic preview settings into production. No `npm start`, `setup.js`, database migration or service restart was run for this implementation. Existing normal pages and games continue to work.
2. Use the supported one-worker configuration and durable Mongo storage. Preserve the collection through future releases. No automatic data migration is needed. For multi-worker hosting, this version is not an active-active option; the lease rejects competing owners.
3. Match `COMMONS_ALLOWED_ORIGINS` to the public Site origin. Proxy `/commons/socket.io` WebSocket upgrades to the same app that owns the browser session. Retain the normal `/socket.io` route for existing chat. No special WAF bypass, public cache of `/commons`/diagnostics, or private-media exception is needed. Cache only shipped `.v1.webp` art (one year immutable) and ordinary static code (one hour); change asset versions when replacing immutable files.
4. Admin access works by default. Existing grant UI controls additional residents. Do not grant legacy `chat5` merely to enable the game. The shelter deliberately needs no stock permissions because it reads no stock.
5. Leave NPC disabled for a dependency-free first opening, or enable only with an already configured compatible Gateway model. AI availability is not a game readiness requirement. No external art generation or Gateway work remains necessary for the shipped artwork.
6. Read `/commons/diagnostics` as an authorized admin for runtime ownership, online count, save revision/time and failed-save flag. This report intentionally contains no resident list. Check production categories `commons.config`, `commons.authorization`, `commons.lease`, `commons.persistence` and `commons.npc` for actionable failures.
7. After the eventual normal release, the smoke checklist below covers the actual reverse proxy, database and devices. These environment checks were not performed against production during development.

Existing Site setup values (do not replace working secrets for this feature):

| Variable | Required format / existing default |
| --- | --- |
| `MONGOOSE_URL` | Existing durable database URI: `mongodb://host:port/database` or `mongodb+srv://host/database`, with the deployment's authentication if required. Commons uses the existing connection; no separate game database URL. |
| `SESSION_SECRET` | Existing strong random nonempty secret; no default. Preserve it, but MemoryStore sessions still require relogin after restart. |
| `NODE_ENV` | `production` for production cookie defaults. |
| `PORT` | Existing app listen port; default `8080`. |
| `TRUST_PROXY` | Existing reverse-proxy setting: hop count (e.g. `1`), `false`, or trusted proxy expression; defaults to `1` in production and false otherwise. Preserve the correct deployment value. Required for secure cookies behind TLS termination according to the normal Site setup. |
| `SESSION_COOKIE_NAME` | Default `lentmiien.sid`. |
| `SESSION_COOKIE_SECURE` | Boolean; defaults to true in production. Public production origin should be HTTPS. |
| `SESSION_COOKIE_SAMESITE` | Default `lax`. Keep the normal same-origin setup. |
| `SESSION_COOKIE_MAX_AGE_MS` | Positive integer milliseconds; default `86400000` (24 hours). |
| `OPENAI_API_KEY` | Existing Site/prestart setup requirement, **not** used by Commons or its shipped art. No new key is needed for this feature. |

Do not use `npm start` as a smoke test: it runs the existing mutating `setup.js` prestart pipeline. The eventual normal application launch is `node app` under the existing one-worker supervisor with the configured environment; that launches the normal database lifecycle and background services. This review did not execute it. No world migration or manual collection/index creation is required. Only the first successful game join creates the v1 record.

Rollback: disable `COMMONS_ENABLED` in the deployment configuration on the next normal release/restart or revert the feature commit through the normal process; retain `commonsworlds` and its private backup. Existing routes/permissions were not rewritten. Wait for the old lease to expire before opening a different owner. Do not delete the collection as a routine rollback.

## Validation and local reproduction

Focused tests: `npm test -- tests/unit/commons --coverage=false --runInBand`. Related regression checks include account surface policy and socket authorization. Broader check: `npm test -- --runInBand`.

The optional browser harness is **synthetic only**: `node scripts/preview-commons.js` binds loopback port 8089, reads no `.env`, connects to no database/provider, and starts no app schedulers. POST `/__preview/login` with JSON `{ "resident": 1 }` using that browser context before visiting `/commons`; numbers 1–12 are synthetic fixtures. This login endpoint exists only in the standalone local harness and is not mounted by the Site. `COMMONS_PREVIEW_PORT` can select another loopback port.

`node scripts/review-commons-browser.js` starts/stops its own harness and records screenshots plus results. It requires an available external Playwright installation/browser; use `PLAYWRIGHT_MODULE` and `COMMONS_CHROMIUM` to point to existing installations if needed. They are developer-only tooling variables, not runtime dependencies. `COMMONS_SCREENSHOTS` overrides the output folder. No Playwright dependency was added to production.

See [VALIDATION.md](VALIDATION.md) and [validation/browser-results.json](validation/browser-results.json). The browser run used actual HTTP, Express sessions and WebSocket connections with two synthetic accounts, Chromium desktop 1440×1000, touch-emulated 390×844 and 844×390 landscape, DPR 2. It tested keyboard/touch, takeover including delayed old close, garden persistence acknowledgement, cottage entry, fallback, revocation and save failure. Some interaction paths reposition the **synthetic server fixture** to reach landmarks; that is not a claim to have walked every path manually. `desktop-daylight.png` forces only the renderer's time presentation for visual QA; server time/date rules have unit tests. The other screenshots use actual test-time Tokyo night. No physical phone, ten-browser load, real Mongo crash/failover or live Gateway response was tested.

Browser smoke checklist for the eventual deployment:

- Confirm normal `/mypage`, existing Chat5 HTTP pages and `/socket.io` notification/chat connections still work.
- Authorized resident can enter; anonymous/no-grant users and invalid Origin/CSRF cannot. Chat5 access remains independently checked.
- With separate accounts, remove an active user’s **only** play grant and verify movement/snapshots stop within five seconds; try an action immediately. Remove talk alone during a pending reply: the reply must not arrive. Group grants still authorize even after a user grant is removed; admin bundles require demotion/session revocation to remove built-in authority.
- Two real devices see each other outdoors; a duplicate tab/device takes over cleanly, and closing the old tab preserves the replacement.
- Walk, release controls, rotate/resize, background/reconnect, close and return; location/facing resume within the documented checkpoint limit.
- After a normal test-environment server restart, sign in again and confirm the same cottage, decorations, inventory and last checkpoint restore. A crash may require waiting twenty seconds for the old lease.
- Owner can enter their cottage; another resident cannot. Inventory, private interiors and tool information do not appear in other snapshots.
- All three stones and beds work; workshop creates one lantern; decoration survives re-entry. Daily reset follows Tokyo midnight.
- On desktop and a physical phone, check portrait/landscape, browser bars, notches/home indicator, DPR/zoom, keyboard focus, touch release/cancel/backgrounding, dialogs, reduced motion, night contrast and art-loading failure. Simulated viewports cannot verify real safe areas or touch behavior.
- The full-room and lost-storage states are clear. If AI is enabled, test one real model reply, timeout/fallback, and that another player never receives it.

## Deliberate v1 limits and extension points

### Live acceptance and reported follow-ups (2026-10-09)

Lennart reports that v1 looks really good and seems to work fine, and explicitly accepts it as-is: “We'll keep the first version, so let's merge it into the main branch.” The accepted implementation is reviewed commit `4f8f2f49a277cd9973800e7fbeeaaec7199c5ca3`; see the [prior final review](/codex/sessions/tool-session-808c30498228cb4601d4e07ca0d02a952f73a41ce7ae9e024302a3f8ad345660). The merge/push task makes no gameplay or visual fixes and performs no deployment.

#### Evidence and scope of this investigation

The follow-up analysis uses Lennart's supplied **2556 × 1440 daytime screenshot**, showing **09:18 · Tokyo**, one resident online, Cottage 1, three discoveries, zero petals, a made lantern and three community-care actions. The player is west of the fountain; Mori is north of it. The screenshot was supplied in the conversation and is not copied into this repository. It shows the outdoor village at a wide desktop view; its browser zoom, device pixel ratio and deployed Git revision were not independently recorded. It cannot establish motion, exact collision boundaries, save durability, mobile behavior or the sequence that produced the displayed progress.

Source inspection uses merged revision `591eb138192828d3c3807e66d470d79cd3df840b`, whose runtime files match accepted commit `4f8f2f49a277cd9973800e7fbeeaaec7199c5ca3`. References: [world geometry](../../public/commons/world.js), [renderer](../../public/commons/renderer.js), [client/UI state](../../public/commons/client.js), [page copy](../../views/commons.pug), [room admission](../../services/commons/room.js), and [art provenance](ART.md). Read-only local checks called the shared `walkable()` function and inspected the shipped atlases' dimensions/alpha. No game code, art, saved world, production configuration or running service was changed. No new live walk-through or browser regression run is claimed.

Use these evidence distinctions throughout:

- **Reported:** Lennart's live observations, preserved even where a still image cannot prove them.
- **Visible:** something identifiable in this screenshot.
- **Source-confirmed:** a property of the checked-in implementation or shipped asset, not proof of the exact deployed revision.
- **To verify:** interpretation, desired behavior or a proposed check that needs a later controlled walk-through.

The accepted v1 release remains accepted. The priorities below order future investigation; they do not reopen its release gate.

#### 1. Collision anchors and the rendered ground footprint — investigate first

**Reported:** collision shapes seem displaced downward relative to the art. The pond permits walking entirely under the picture when approached from above; the fountain has a similar, less pronounced problem. **Visible:** the pond is a broad, low water-and-rock shape southeast of the square, while the fountain has a broad basin beneath a raised central lantern. These need a ground footprint that differs from a tall building or tree. Neither collider is visible in the supplied image.

**Source-confirmed coordinate contract:** one world unit is 32 unzoomed canvas pixels. World `x/y` is the player's tested position; movement does not use an avatar-sized collision shape. `sprite()` draws upward from its supplied bottom anchor. Scenery is drawn with bottom anchor `(x * 32, y * 32 + 6)`, but its collision is a circle centered at `(x, y)`. Thus the circle center is six pixels above the **bottom of the whole atlas-cell rectangle**, rather than the middle of the object's ground footprint. Transparent padding further separates this anchor from the visible art. The same basic arrangement is used for flowers, benches, lamps and pots, so inspect those too rather than assuming the two water features are isolated cases.

The following are renderer/source dimensions, before zoom or DPR; the art rectangles include transparent padding and are **not** proposed collision outlines:

| Object | World anchor | Art rectangle, unzoomed pixels `(left, top, width, height)` | Current blocking circle | Consequence to investigate |
| --- | --- | --- | --- | --- |
| Pond, scenery sprite 4 | `(51, 33)` | `(1549.5, 897, 165, 165)` | Center `(1632, 1056)`, radius `51.2 px` (`1.6` units); vertical extent `31.4–34.6` units | Art-cell vertical extent is about `28.03–33.19`; much of its upper area lies north of the circle, while the circle extends south beyond the entire art rectangle. |
| Fountain, scenery sprite 0 | `(32, 27.8)` | `(968, 783.6, 112, 112)` | Center `(1024, 889.6)`, radius `35.2 px` (`1.1` units); vertical extent `26.7–28.9` units | Art-cell vertical extent is about `24.49–27.99`; there is the same directional mismatch, at a smaller scale. |

The current circle diameters are `102.4 px` for the pond and `70.4 px` for the fountain, versus art-cell widths of `165 px` and `112 px`. That comparison supports investigating **both size and offset**, but transparent margins, rocks, reeds and the fountain's raised pillar mean it does not specify the correct final radius. A projected ground ellipse or other outline may be more appropriate than a circle; decide from the basin/water/rock base, not the full silhouette.

Read-only probes of the actual shared `walkable()` function produced:

| Probe `(x, y)` | Result | Interpretation |
| --- | --- | --- |
| Pond `(51, 30)` | Walkable | The player point can occupy the upper rendered pond area. |
| Pond `(51, 31.39)` / `(51, 31.41)` | Walkable / blocked | North approach starts blocking around the circle's `31.4` boundary. |
| Pond `(51, 34)` | Blocked | Blocking continues below the entire rendered pond cell. |
| Fountain `(32, 25.6)` | Walkable | A point within the fountain's rendered upper area is permitted; inspect basin versus pillar coverage visually. |
| Fountain `(32, 26.69)` / `(32, 26.71)` | Walkable / blocked | North approach starts blocking around `26.7`. |

These are static point checks, not recorded player trajectories. Collision uses strict comparisons, so an exact boundary is not equivalent to a point just inside it. Other nearby objects can also block a test point.

**Later reproduction:** approach each object from north, south, east, west and diagonally. Record the authoritative player point, visible feet/contact ring, and first blocked position. In a development-only diagnostic view, show the atlas rectangle, opaque artwork, intended ground footprint, collision outline and anchor separately. Check whether the character is walking on water, legitimately behind a raised part, or stopping on empty grass. Acceptance should require a consistent, explainable shoreline/basin boundary from every direction, with no hidden extension into the surrounding route.

#### 2. Lantern Hall and building footprints

**Reported:** the Hall collider seems too small for its larger building; Lennart suggested it might reuse a smaller house collider. **Source-confirmed:** that reuse is real. Every location with `sprite < 6`, including all cottages and the Hall, blocks the same rectangle: `abs(x - location.x) < 2.2`, from `location.y - 2.4` to `location.y + 0.35`. That is **4.4 × 2.75 world units**, or **140.8 × 88 pixels**. The Hall is drawn in a **188 × 188** cell, while other buildings use **146 × 146**. The Hall art is therefore about 29% larger in each dimension without a corresponding change to the collider.

This confirms the shared dimensions, **not** that the correct remedy is to scale every collider to every sprite. Roofs, upper stories and awnings can legitimately overlap a player standing behind or beside a building. The small cottage's visible body is also narrower than its full padded cell, so its existing rectangle may already exclude extra ground at the sides. Compare foundations, steps and entrance apron for the Hall, Conversation House, Shelter, Gallery, Workshop and a cottage individually. The open workshop may need a different visual interpretation from a closed house.

**Visible:** the Hall straddles the north–south avenue and its front steps face the approach. The side buildings sit over the ends of the inner paths. Those may be intended destination entrances, whereas a foundation cutting through a through-road would be a layout defect. The screenshot alone does not settle the intended route behind the Hall.

**Later checks:** trace all four sides and corners of each building; distinguish acceptable roof occlusion from entering a wall/base. Verify that the entrance action remains reachable from a walkable position. `nearby()` centers building interactions at `(x, y + 1.2)` with radius `2.5`, independently of the collision rectangle; cottage exit places the player at `(x, y + 1.6)`. A footprint adjustment must be checked against both, rather than enlarging the rectangle and inadvertently blocking entrances or exit spawns.

#### 3. Roads, vegetation and garden placement

**Reported:** some buildings, trees and flowerbeds overlap roads. **Visible examples and source locations:**

| Area in the screenshot | Observation and source evidence | What needs deciding/checking |
| --- | --- | --- |
| Northern road between the first two cottages | Trees cover the road; generated tree anchors include `(13, 9)` on the road centerline and `(12, 10)` just south of it. | These are not solely canopy overhang: the `(13, 9)` trunk collider is centered on the road itself. Establish the intended clear walking lane. |
| Eastern outer road, above the horizontal crossing | Several crowns obscure the lane; one tree anchor is exactly `(57, 17)` on the east road centerline. | Separate permissible overhead foliage from trunk/root obstruction. Test walking down the road beneath the cluster. |
| Southwestern cottage area and southeastern pond/road area | Dense overlapping crowns crowd cottages and the pond; trees near `(6, 36)` and `(58, 32)` also approach the outer lanes. | Inspect actual ground clearance and cottage approaches. Canopy overlap alone does not establish that a route is blocked. |
| Three rectangular cultivation beds south of the square | All three visibly occupy the east–west garden lane. Their centers `(29, 33)`, `(32, 33)`, `(35, 33)` share the path's `y = 33` centerline; the middle bed also lies on the central avenue. | Decide whether these should be walkable beds, roadside plots or an intentional interruption with a bypass. Currently the garden itself adds no collision; `(32, 33)` is walkable. |
| Small terracotta plant groups on the upper/lower inner lanes | Several are drawn on or across the pale paths, rather than beside them. Scenery includes pots at `y = 20` and `y = 33`, including `(24, 20)`, `(41, 20)`, `(24, 33)` and `(41, 33)`. | These pots do have `0.3`-unit collision circles. Check whether small props cause unexpected stops on an otherwise continuous-looking path. Distinguish them from the nonblocking cultivation beds. |
| Western diagonal woodland path | The three discovery stones sit along the path itself at `(7, 21)`, `(10, 27)`, `(13, 33)`. | Stones currently have no dedicated collider; `(10, 27)` is walkable. Determine whether standing on the stone is intended before treating it as a defect. |
| Hall and side-building approaches | Hall covers part of the central avenue; buildings visually terminate portions of the inner lanes. | Preserve intentional entrance approaches; identify through-routes before moving any building or road. |

**Source-confirmed structural cause:** road strokes exist only in `renderer.makeGround()`. Tree placement in `world.js` excludes locations by center-distance for generated trees, but has no road-width/road-clearance test. Twelve additional trees are appended without that location exclusion. Gardens and scenery are also positioned independently of the path drawing. The world has 45 tree entries at this revision; this is a finite layout that can be audited systematically. Decorative ground flecks/flowers likewise do not share a complete road mask; not every colored mark on a road is an atlas fragment.

**Later audit:** inventory road centerlines and full stroke widths, object ground footprints, canopy overhang and required approach space. Check the outer loop, central avenue, east–west crossing, inner garden loop, woodland trail and all twelve cottage entrances. Agree which paths promise uninterrupted movement. Do not infer that roads are the only walkable terrain—grass is currently traversable too. Preserve recognizable landmarks and the accepted village composition while resolving specific clearance problems.

#### 4. Atlas contamination, cut edges and apparent stray pixels

**Reported and visible:** narrow detached marks repeat just left of several identical cottages, especially across the north row. Repetition at the same relative offset is consistent with a reusable sprite/crop defect rather than random terrain decoration. Inspect the stone and small flower/pot sprites as well; not every suspected speck is distinguishable in the overview.

**Source/asset-confirmed:** both shipped atlases measure **1774 × 887 pixels**. The renderer assumes a uniform 4 × 2 grid, giving **443.5 × 443.5-pixel cells** and fractional source boundaries. It uses each full cell without object-specific crop rectangles or anchor metadata. Only the scenery lamp (index 3) has a special 12% horizontal inset. Fractional sampling and scaling deserve checking, but they are not the only explanation: nontransparent disconnected fragments already exist inside nominal cells.

A read-only alpha inspection (alpha at least 32/255, four-connected components, ignoring components smaller than 20 pixels) found the following examples. Bounds are approximate integer source pixels relative to the nominal cell, using floored cell edges for measurement; these are diagnostic measurements, **not approved replacement crop coordinates**:

| Atlas / cell | Main connected object bounds `(left, top)–(right, bottom)` | Separate left-edge fragment evidence |
| --- | --- | --- |
| Village / cottage, index 1 | `(51, 81)–(419, 424)` | A 561-pixel component at `(0, 327)–(10, 404)` and a smaller 77-pixel component at `(0, 217)–(7, 232)`. The larger fragment's expected lower-left placement matches the repeated cottage marks. |
| Scenery / flowers, index 1 | `(34, 46)–(442, 427)` | A 254-pixel component at `(0, 185)–(6, 237)`, plus another smaller fragment. |
| Scenery / standing stone, index 5 | `(58, 3)–(426, 415)` | A substantial 4,941-pixel component at `(0, 145)–(37, 345)`, consistent with neighboring pond artwork intruding into this cell. |
| Scenery / potted plants, index 7 | `(74, 21)–(407, 397)` | A 337-pixel component at `(0, 313)–(11, 350)`, plus smaller pieces. |

The lamp cell also contains a left-edge component, which the existing inset excludes; that one-off workaround is not a general atlas cleanup. Several neighboring main objects touch a nominal cell's right edge, suggesting that the requested equal-cell padding was not consistently achieved. Review the full silhouettes on both sides of every boundary: removing fragments alone may leave the donor object's own edge clipped.

**Later validation:** inspect all eight cells in each atlas on grass, dark and light backgrounds, at minimum/default/maximum game zoom and DPR 1/2. Separate (a) real neighboring artwork included in a crop, (b) a legitimate detached element/shadow, and (c) filtering at fractional boundaries. Cropping, trimming, repacking or extracting sprites may be options, but preserve complete artwork, apparent size and ground anchors. Do not blindly apply the lamp inset to every cell, delete every disconnected component, disable smoothing globally or regenerate the accepted art as a first step. If immutable `.v1.webp` assets are replaced later, use the documented asset-version/cache process.

#### 5. Depth sorting, contact points and player readability

**Visible:** the player's gold ground ring is below the character's feet, and the character resembles Mori. **Source-confirmed:** both use village sprite 7, drawn at 67 pixels for players and 73 for Mori. In that atlas cell, the main visible character occupies roughly rows 72–402 of a 443.5-pixel cell. With the player's bottom anchor at `y - 2 + bob`, the visible bottom is about eight unzoomed pixels above the logical player point, varying with the small idle bob. This explains why the ring can look detached; it also matters when judging where collision stops. It is not evidence of a network position error.

All trees, scenery, locations and players are depth-sorted by their raw world `y`. Rendering then applies different bottom offsets and padded art sizes. A player north of a pond's low anchor is drawn before the whole pond, so the pond can cover that player while the current collision still permits entry. This mechanism is consistent with the reported walking-under-art experience, but needs a moving reproduction. Sorting by ground contact is sensible for tall objects; filling the entire roof/canopy silhouette with collision would remove legitimate behind-object movement.

**Later checks:** walk behind and in front of the pond rim, fountain basin/pillar, Hall, tree trunks/canopies, benches and lamps. Record the player point, visible feet, collider and draw-order transition together. Decide which low objects require a different footprint or layering treatment without changing the accepted art style. Keep the local player's ring/name readable; evaluate the Mori/player resemblance as a lower-priority identification question, not a demonstrated multiplayer bug from a one-resident screenshot.

#### 6. Secondary presentation observations — lower priority, not verified defects

- **Completed-loop guidance:** the screenshot says `3 / 3`, `0 petals` and `Made with care`, but the quest paragraph still instructs the player to gather and craft. Zero petals is consistent with crafting consuming three petals; it is not evidence of lost inventory. The quest paragraph is static in Pug. Consider whether later copy should acknowledge completion or point to cottage decoration; this screenshot does not show whether the cottage is already decorated.
- **Finding home and named places:** Cottage 1/North lane appears in Field notes, but cottages have no labels in this distant view. The renderer intentionally limits building labels to anchors within 16 world units of the player. The unlabelled Shelter is also consistent with that cutoff. Check whether a resident can readily locate their home at overview zoom before deciding to show more labels everywhere.
- **Interaction affordance:** `Within reach` is empty while `Explore nearby` remains orange-looking. The client disables it when nothing is nearby and CSS reduces opacity; a screenshot cannot establish whether it is clickable. Review disabled-state clarity at this scale rather than diagnosing broken interaction from appearance alone.
- **Camera framing:** there is a broad dark-green strip along the left edge and some boundary trees are clipped at the top/bottom. The camera follows the player without clamping to map bounds; uncovered canvas uses the flat background color. Check framing at all map edges and zoom levels before treating the visible strip as a missing terrain tile.
- **Visual balance:** the clear central square, distinct roof styles, warm lighting and consistent journal framing are strengths to preserve. Some edge vegetation is much denser than the center and obscures route/cottage silhouettes. Treat density adjustments as localized readability work, not a reason for an unrelated redesign. Text appears small in this wide screenshot, but its scaling/browser context is unknown; no accessibility contrast or physical-device conclusion was measured here.

#### Investigation order and evidence required before a fix

1. **Establish ground anchors and footprints first.** Reproduce pond/fountain approaches and Hall/cottage edge behavior in the existing synthetic preview. Capture exact coordinates and distinguish collision, sprite padding and depth-order problems. Do not change geometry just to match a full sprite rectangle.
2. **Inventory atlas cells and road clearance.** Confirm which pieces are neighboring-art contamination and which objects obstruct intended lanes. Any crop changes must be assessed for their effect on visible anchors/scale before final collider tuning.
3. **Agree the intended behavior.** Define where the water rim/foundation/trunk blocks movement, whether gardens/stones are traversable, which roads remain clear, and how entrances are approached. Then scope the smallest implementation changes that satisfy those decisions.
4. **Verify movement and interactions together.** For each affected object, test cardinal/diagonal approaches, corners and travel past it; compare authoritative positions with rendered feet at zoom `0.5`, `1` and `1.5`, DPR 1/2, desktop and a narrow/touch viewport. Check occlusion from both sides and that all stones, garden beds, workshop, cottages and applicable portals remain reachable. Do not use teleport-only interaction checks as proof of navigable routes.
5. **Protect persisted positions and compatibility.** Geometry changes may make an existing saved position invalid. Admission currently resets a non-walkable saved position to `World.SPAWN`; consider and test that behavior explicitly. Keep plot ownership, progress and inventory intact, review the documented world-version/migration decision, and verify client/server geometry agree after any future asset/code update. No migration or reset is performed by this analysis.

Existing Commons tests validate a blocked Hall point, movement bounds and the gameplay/security/persistence loop; the browser runner also uses explicit fixture repositioning for several landmarks. Their passing results do not establish art/collider alignment, obstacle-free route traversal or clean crop edges. A future fix should add targeted behavioral regressions for confirmed boundary/route failures and visually review the affected cells/approaches, then run the focused Commons suite and appropriate broader regressions. This documentation-only investigation ran read-only geometry/asset probes and a diff check; it did not rerun Jest or the browser suite.

### Deferred capabilities

No offline avatars, guest cottages, household adapter, shared inventory, player text broadcast, terrain editing, ASR/TTS, cross-player memories, scheduled events, real Kitchen Week/Memory Shelf tools, or 3D rendering are presented as working. Offline characters are removed from presence; their durable transform remains paused, with no penalties.

The public location registry and transforms live in `world.js`; `registry.js` owns authorized fixed portal adapters. Future interiors/NPCs need explicit capability and object scopes, and cannot put private metadata into the public facade. The `CommonsRoom` owns rules/persistence; `CommonsRenderer` consumes snapshots. A future 3D renderer can consume the same x/y/facing/scene transforms after a reviewed coordinate/version contract. Time/event hooks can use `World.clock` without involving rendering or AI. A household shelter adapter must first establish a real immutable household membership boundary in its underlying feature; the legacy permission alone is insufficient. Voice and consent-based cross-player memories need separate grants, bounded jobs and retention/delivery rules.

Fresh v1.2 critical review, fixes, access/index handoff and acceptance limits:
[V1.2-RELEASE-REVIEW.md](V1.2-RELEASE-REVIEW.md). Client revision: **1.2.1**.
