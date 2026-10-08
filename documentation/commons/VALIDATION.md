# Release validation

Validated locally on 2026-10-08 UTC / 2026-10-09 Asia/Tokyo. No production app, setup pipeline, provider, live database or account was accessed.

- Fresh critical review read the actual room/repository/schema, HTTP and Socket.IO bootstrap, authorization helpers, client/renderer, existing Chat5 permission contract and local Gateway source. It did not rely on the previous report.
- Focused Commons coverage now includes real loopback HTTP/session/Socket.IO tests for two accounts, private cottage snapshots, takeover/rejoin, removal of a previously held play grant, session-store revocation, and removal of talk access during a pending provider reply. The normal Site transport and client script coexist with the production Commons transport constructor; a wrong Origin/CSRF and the unused game default namespace are denied. Actual Chat5 authorization/handler setup remains separately covered by the repository regression suites, not live Chat5 inference.
- Room tests exercise simultaneous last-slot joins, overlapping same-account takeovers with a delayed save and stale disconnect, max ten online/twelve lifetime residents, restart restoration, receipt replay, private inventory, collision, Tokyo dates, ownership loss and delayed save responses. Persistence still uses an injected repository. The actual Mongoose schema/casting is checked with a stubbed collection write; no Mongo server is used.
- Client VM regression tests prove an old timeout cannot retry an action through either a replacement or reconnected socket, and old NPC replies cannot overwrite a new connection. Markup is assigned to textContent, not innerHTML.
- A local HTTP stub exercises the real Axios adapter and a multilingual request larger than the old 16 KiB limit. This checks wire format and bounded serialization, not model inference. Provider unit tests cover privacy, cancellation, tools rejection, two-call concurrency, twelve-second timeout, cooldown and honest fallback.
- Final focused Commons run: **56 tests passed across 6 suites**. Related navigation, socket authorization and socket initialization suites also passed. Final full repository run: **4,668 passed tests, 110 skipped; 371 passed suites, 7 skipped; zero failures** (160.527 seconds). Coverage thresholds passed: statements 71.78%, branches 50%, functions 80.79%, lines 72.64%. Node was the repository-pinned **24.20.0**. Coverage measures the repository's configured critical files, not a Commons coverage percentage. Existing experimental VM-module and Promise-like router-handler warnings were non-failing.
- Browser runner: **19 assertions passed**, zero browser JavaScript errors. Real loopback HTTP/session/WebSocket transport and production transport construction; synthetic accounts and in-memory repository. In addition to the original 14 checks, it verifies automatic transport rejoin, reduced-motion preference, DPR 2 backing resolution, orientation resize and missing-art recovery. The expected injected persistence-failure log confirms the actionable logger path. The browser's revocation fixture removes the principal; actual grant-only and session-store revocation are separate transport tests.
- Refreshed screenshots were visually inspected for desktop welcome/village, mobile portrait welcome/village, landscape, cottage, NPC dialogue and storage failure. The daylight screenshot changes only the renderer's time presentation. Mobile gestures are dispatched pointer events under Chromium emulation; DPR/resize assertions are automated, while physical safe areas and device behavior remain manual checks.
- JavaScript syntax, Pug rendering through real HTTP tests and `git diff --check` passed. No curated OpenAPI spec or dependency manifest changed.

## Fixes from the fresh review

- Count authorization freshness from lookup start and deny/log overlong lookups, so delayed database replies cannot renew stale authority or an expired cookie.
- Fence browser retries/results by connection generation, including automatic reconnect; stale action/NPC callbacks cannot affect a replacement session.
- Deny the unused default namespace on the game transport; reuse the exact guarded transport in the preview and tests.
- Clear simulation/snapshot/checkpoint timers on HTTP server shutdown. Engine.IO Server.close() does not emit the previously expected close event.
- Raise the bounded NPC JSON body allowance to 32 KiB so a valid multilingual history fits; retain the 32 KiB response bound and twelve-second timeout.
- Apply safe-area padding to the full page and update canvas backing resolution on DPR changes.


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
