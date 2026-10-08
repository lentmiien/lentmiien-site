# Release validation

Validated locally on 2026-10-08 UTC / 2026-10-09 Asia/Tokyo. No production app, setup pipeline, provider, live database or account was accessed.

- Focused Commons Jest suites: **43 tests passed, 4 suites**. Includes simulation/collision/input expiry; single/ten-resident admission and twelve permanent plots; takeover/stale disconnect; restart/checkpoints; private-house/snapshot scope; concurrent/idempotent persisted garden actions; full exploration/crafting/decorating loop; database failure, late write/lease expiry; malformed input; auth, capability, origin and CSRF denials; removed principal/session expiry; portal scope; repository revision/lease predicates; invalid schema/config; NPC lore isolation, malicious text as plain text, bounds, cancellation, timeout and fallback; Tokyo clock; HTTP cache/anonymous/admin controls.
- Related account-navigation and socket-authorization regression suites passed (68 tests across 6 suites including the final Commons tests).
- Full repository Jest run: **369 passed suites; 7 skipped suites; 4,655 passed tests; 110 skipped tests; 0 failed**. Coverage thresholds passed: overall statements 71.78%, branches 50%, functions 80.79%, lines 72.64%. Skips are repository-defined; no preexisting failing suite was observed. Existing VM-modules experimental and Promise-like router-handler deprecation warnings appeared; neither was a test failure.
- JavaScript syntax, Pug compilation and `git diff --check` passed. No curated OpenAPI spec or dependency manifest was changed, so OpenAPI/dependency migration checks were not applicable.
- Browser runner: **14 assertions passed**, zero browser JavaScript errors. Real loopback HTTP/session/WebSocket transport; synthetic accounts and in-memory repository. It verifies movement, touch controls, two sessions, takeover/stale tab close, action acknowledgement, cottage entry, NPC fallback, principal revocation and storage-failure recovery UI. The expected injected persistence-failure log confirms the actionable logger path.
- Screenshots were captured and visually inspected for desktop welcome/village, mobile portrait welcome/village, landscape, cottage, NPC dialogue and storage failure. A separate daylight screenshot uses a renderer-only clock override to inspect daylight art. Final raster art and sprite silhouettes were also visually inspected.

## Evidence

[Browser assertions](validation/browser-results.json)

- [Desktop welcome](validation/desktop-welcome.png)
- [Desktop village at night](validation/desktop-village.png)
- [Desktop daylight visual check](validation/desktop-daylight.png)
- [Mobile welcome](validation/mobile-welcome.png)
- [Mobile portrait](validation/mobile-village.png)
- [Mobile landscape](validation/mobile-landscape.png)
- [Private cottage](validation/private-cottage.png)
- [NPC fallback dialogue](validation/npc-dialogue.png)
- [Storage unavailable](validation/save-failure.png)

## Boundaries of this evidence

No live Mongo integration, database crash/failover drill, production process-count/reverse-proxy validation, real Gateway/model inference, physical phone or ten-browser load test was performed. Repository tests exercise persistence and fencing through injected repositories/model command assertions; browser persistence uses a synthetic in-memory repository. These results must not be described as live production multiplayer, real-device or real-provider verification.

The optional NPC is real implemented provider support but remains disabled by default; screenshots show the explicitly labelled scripted fallback. Voice, cross-player memories, household integration, offline avatars, events and 3D are deferred. The feature is ready for the documented single-worker deployment with default NPC fallback; the environment-specific checks in README remain part of the eventual deployment, which this task deliberately does not perform.
