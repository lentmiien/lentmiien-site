# Lantern Commons — first release

A private, peaceful village at **`/commons`**. This change is prepared for the normal release process; it does not deploy, run setup, restart services, provision a GPU, or change any real account grants.

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

1. Release the pushed feature revision through the usual reviewed process. In a clean deployment checkout, fetch `origin/feat/lantern-commons-v1`, select the reviewed commit, use Node **24.20.0** from `package.json`, and run `npm ci` for a fresh install. This feature adds no packages and changes no lockfile. Retain existing deployment secrets and private storage; do not copy synthetic preview settings into production. No `npm start`, `setup.js`, database migration or service restart was run for this implementation. Existing normal pages and games continue to work.
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

No offline avatars, guest cottages, household adapter, shared inventory, player text broadcast, terrain editing, ASR/TTS, cross-player memories, scheduled events, real Kitchen Week/Memory Shelf tools, or 3D rendering are presented as working. Offline characters are removed from presence; their durable transform remains paused, with no penalties.

The public location registry and transforms live in `world.js`; `registry.js` owns authorized fixed portal adapters. Future interiors/NPCs need explicit capability and object scopes, and cannot put private metadata into the public facade. The `CommonsRoom` owns rules/persistence; `CommonsRenderer` consumes snapshots. A future 3D renderer can consume the same x/y/facing/scene transforms after a reviewed coordinate/version contract. Time/event hooks can use `World.clock` without involving rendering or AI. A household shelter adapter must first establish a real immutable household membership boundary in its underlying feature; the legacy permission alone is insufficient. Voice and consent-based cross-player memories need separate grants, bounded jobs and retention/delivery rules.
