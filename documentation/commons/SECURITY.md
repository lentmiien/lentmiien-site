# Lantern Commons security contract

**v1.2 development:** see [delivered features and release steps](V1.2.md),
[extended security contract](V1.2-SECURITY.md), and [validation](V1.2-VALIDATION.md).
The v1/v1.1 material below is retained as historical context; v1.2 supersedes its sealed
Shelter, Hall portal, empty family/user diary bundles, and world-only index statements.

- Feature: Lantern Commons v1. Zone: logged-in. Interactive principals: admin, family, user with explicit semantic capabilities; machine principals: none.
- Data: public shipped map/art/lore; private account IDs, saved transforms, house decorations, discoveries and inventory; ephemeral private NPC text. No household, chat-history, role or private-media data enters world snapshots or model context.
- Capabilities: `commons.world.play`, `commons.npc.talk`, `commons.operations.read`. Admin bundle has all three; family and user bundles empty, assigned through existing typed group/user role grants. Diagnostics additionally require the admin bundle identity; no admin override of houses.
- Scope: one fixed member world, bounded to 12 immutable account IDs, first successful join reserves the lowest free plot permanently. Houses and inventory are owner-only. Outdoor presence uses plot aliases, never account names/IDs. No invitations, arbitrary rooms, trading or member management in v1.
- Mutations: Socket.IO `/commons` namespace with validated existing session, current principal/capabilities, explicit Origin allowlist, shared session CSRF token equality. Page GET only issues shared CSRF token. Session store reload and capability checks precede actions, periodically renew movement authority (maximum 5 seconds from lookup start), and gate all snapshots. No browser unload dependency.
- Limits: 10 online maximum (configurable 1–10), 12 lifetime plots, bounded single world document, 20 movement inputs/second, 2 actions/second, one pending normal command and one pending talk per socket, 400-character NPC input, one NPC call/user and two globally, 15-second cooldown, 12-second timeout, six recent messages (three exchanges). Unknown fields, nonfinite coordinates, arbitrary IDs/URLs/commands denied.
- Rendering: local Pug/CSS/Canvas, DOM textContent for all model/server messages. No rich model output, active URLs, eval or model tools. Renderer consumes entity transforms independently of server simulation.
- Media: shipped original generated assets intentionally public/cacheable. No private media adapters. All page/private state responses private/no-store, no analytics.
- Outbound: optional existing configured local LLM provider origin through a narrow adapter; no caller-selected model, URL or tools. Disabled by default, deterministic explicitly labelled fallback. No voice or cross-player memory.
- Logging: shared logger for database/lease/config/provider failures, fixed categories and error names only, no prompts, session IDs, credentials or private records. Rejections are bounded and not logged per input.
- Retention: world records persist until operator removes/reset world with Commons stopped; bounded receipts (64/player), NPC memory only during connection. No automatic deletion/reallocation; back up private Mongo data normally.
- Process/migration: one lease owner and one schema-v1 world document; atomic revision/owner/unexpired-lease predicates fence every save. Unsupported versions fail closed. No production migration/run is performed during implementation. Existing chat sockets, tool routes and standalone games unchanged.
- Negative tests: anonymous/missing grant/Origin/CSRF, session revocation/expiry, foreign houses, private snapshot exclusion, bounded malformed inputs, room/plot capacity, lease contention/loss, stale disconnect/takeover, failed writes/idempotent retries, scoped portals, NPC isolation/output/fallback, time and collision.
