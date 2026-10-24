# Local Disaster Watch v3

Security contract: logged-in; interactive admin and explicitly granted users; no machine HTTP principals. Public provider data plus private configured location; admin-managed fixed Asahi-ku scope, no request-selected objects or coordinates. Capabilities `disaster.local.read` and `disaster.sources.refresh`; admin gets both, family/user get neither by default. Existing /admin gate remains. Browser refresh is POST with shared session CSRF, one request/minute and ingestion concurrency guard. GETs are side-effect free, private/no-store, analytics disabled. No uploads; query parameters rejected on summary API; refresh body only CSRF. Escaped Pug/textContent, static allowlisted artwork. Coordinates/raw payloads never enter summary DTOs. Outbound providers remain ingestion-only; no generation at runtime. Operational failures use utils/logger without payloads. Fixed summary slots retain last known state; legacy history retention unchanged. Negative tests cover capabilities, CSRF, XSS, bounded reads and absent/stale local evidence.

JMA references (verified 2026-10-25):
- https://xml.kishou.go.jp/20251222_jmaxml_info.pdf — weather city split, 1410000 → 1410011/1410012.
- https://www.jma.go.jp/jma/kishou/know/yougo_hp/shichoson_ichiran.html — current areas.
- https://www.jma.go.jp/jma/press/2604/14b/20260414_taikeiseiri.html — transition begins May 28, 2026 at approximately 13:00 JST. Legacy VPWW53/54 city code is accepted only before this boundary; uncertain transition records fail closed.
- https://www.jma.go.jp/jma/kishou/know/shindo/kaisetsu.html — qualitative shaking cues; illustrations are explanatory, never damage reports or predictions.

Implementation and release verification instructions are completed below with the tested commands and limitations.

## Behavior and boundaries

Both `/admin/disasters` and `/mypage/api/cards/disaster` consume `buildSummary`; `/admin/disasters/api/summary` exposes the same DTO behind the same read capability. Each summary read is one projected primary-key query, limited to six versioned slots with a 1.5-second server deadline (the shared account adapter uses its existing 2-second deadline). No archive counts, regex scope searches, aggregation, provider calls, generated art, or GET writes remain in these paths. Archive pages are separate, deadline-limited, projected, and capped at 20 pages; they explicitly describe historical reports across all areas.

The six slots are measured weather, forecast estimate, authoritative local warnings, latest measured local earthquake, latest relevant typhoon context, and ingestion health. Their `_id` values contain an opaque digest of the configured weather location; coordinates and location configuration never enter the DTO. Weather, proximity geometry, and record selection use the existing `DISASTER_WEATHER_LOCATION_NAME`, `DISASTER_WEATHER_LATITUDE`, and `DISASTER_WEATHER_LONGITUDE` settings through one module. The public label and JMA administrative areas remain Asahi-ku. No new secrets or environment variables are required.

- Weather: actual OpenWeather current values take precedence while fresh (60 minutes). A separate forecast slot prevents a future forecast point from blocking a later measured reading. Forecast estimates require a point within 90 minutes and a provider snapshot received within 60 minutes. OpenWeather forecast steps are three hours; precipitation is labelled with its period. Unknown day/night does not assume sunlight. Old values are visibly last-known/stale; response `fetchedAt` never substitutes for `observedAt`.
- Warnings: only VPWW53/54 municipality `Body.Warning` evidence for Yokohama North qualifies. Numeric codes are product-specific. Prefecture names, headlines, South, nearby prefectures and generic bulletin titles are excluded. A full local state replaces its predecessor by source report/control time, serial and correction rank. Cancellations remove local hazards, bulletin retractions make coverage unknown, and conflicting same-revision variants remain unknown until a newer revision. No-warnings requires local coverage younger than six hours plus a successful, non-deferred source poll within 45 minutes. This deliberately becomes unavailable on quiet days when no fresh authoritative local bulletin is available; successful HTTP retrieval alone does not renew an old bulletin's freshness.
- Earthquakes: JMA city/station observations and P2Pquake local points are normalized to measured `0,1,2,3,4,5−,5+,6−,6+,7` or unknown. Distant earthquakes do not displace the latest local observation. Corrections/retractions of that local event can make its intensity unknown. Magnitude and nationwide maximum are secondary. Reports older than 24 hours are explicitly historical. Legacy archive records with unrepaired local intensity are labelled unknown rather than claiming zero.
- Typhoons: centres must retain their own validity time, lie in a window from three hours ago through 24 hours ahead, and pass an actual 900-km great-circle test. Latest reports older than 24 hours do not qualify. A later report moving the same storm away removes proximity context. Local probabilities require explicit North/Asahi area names and a valid time; global maximum probability never determines local severity. All normalized probability areas are retained. Fresh local wind advisories/warnings can label the typhoon context, without claiming the typhoon caused them. Unsupported area identities/time structures remain unknown. The compact panel shows the latest relevant storm, not a multi-storm tracker.

Weather has a separate concurrency guard and is scheduled alongside alert processing, so an active alert run cannot block the next weather tick. Current weather is saved before forecast fetching. The alert run flag is reset even if initial database state access fails. Failed summary writes are retried from stored records, and old parser records in feeds can be refreshed for all categories, not just typhoons. HTTP payloads are capped at 8 MiB. Operational errors and bootstrap caps are logged through the shared logger.

## Artwork

`public/i/disaster/v3/manifest.json` lists 26 original standalone SVGs (720×480, under 12 KiB each):

- Nine weather scenes: clear day/night, cloud, rain, snow, thunderstorm, fog, unknown and stale.
- Eleven room scenes: unknown and all ten JMA local intensity classes. Shaking cues progress from slight vibration to swinging objects and moving/toppling furniture. These illustrate classes, not observed damage.
- Six typhoon contexts: unknown, proximity, local probability, local wind advisory, warning and emergency. Unknown has no asserted storm path; alert levels have distinct indicators.

Artwork is public original vector content, with no private-gallery references, external resources, scripts, animation or runtime generation. Visible text carries the authoritative condition; embedded images are decorative (`alt=""`). Responsive CSS uses Graphite/Ember/Golden Amber tokens and respects reduced motion. Regenerate deterministically with `node scripts/build-disaster-artwork.js`.

## Release and rollback instructions (operator actions; not performed here)

1. Deploy the committed application and static assets together using your normal release process. Do not run `npm start` just to test this change: its prestart is mutating. No dependency changes, database destructive migration, or new secret setup is required.
2. Existing indexes needed by bounded bootstrap are `disaster_alerts {category:1,reportAt:-1}` and `disaster_weather_observations {locationName:1,bucketStartAt:-1}`. The new `disaster_local_summaries` collection uses only MongoDB's built-in unique `_id` index; there is no expensive new archive index or startup index build. If an older environment lacks the source indexes, the following additive command creates them (it never drops indexes):

   ```sh
   node --env-file=.env scripts/check-disaster-local.js --indexes
   ```

3. On the next normal scheduler run after database readiness, ingestion bootstraps the new version/location once. It reads at most 200 records per category across five categories from the last 72 hours, using the existing category/reportAt index and a two-second query deadline. It projects only required evidence, re-normalizes local warnings/earthquakes and old typhoon structures from stored raw subtrees, and reads one matching recent weather record. Writes compare source revisions, so old candidates cannot displace newer state. It does not set source health or fabricate observation timestamps. The versioned completion marker records whether the cap was hit. Missing/capped evidence stays unavailable until normal ingestion supplies it.
4. Optional offline bootstrap, if the scheduler is disabled or you want to populate before normal polling:

   ```sh
   node --env-file=.env scripts/check-disaster-local.js --bootstrap
   ```

   This is idempotent and only reads stored source records/writes compact summaries. It does not start the application, fetch providers, or invoke ingestion/generation endpoints. The normal parser upgrade may take several scheduled bounded batches to catch up. Watch `Local disaster bootstrap incomplete`, `Local disaster bootstrap candidate cap reached`, and feed errors in production logs.
5. Read-only index/query verification after summaries exist:

   ```sh
   node --env-file=.env scripts/check-disaster-local.js --check
   ```

   Expect `hasCollectionScan:false`, at most six returned/examined summary documents, and `_id_` index access. This tool prints index keys and execution counters, never coordinate or source payload values. Then open `/admin/disasters` and the `/mypage` card as an authorized user: confirm matching temperature, provider observation timestamp, freshness, and local warning list. Empty/stale coverage must say unavailable, not all-clear. GET reloads only stored data. A manual source refresh, if separately desired by the operator, requires its capability and CSRF and returns immediately with an accepted message; it was not invoked in production for this work.
6. Rollback: restore the prior application/static release through your normal process. Existing archive records remain compatible; the additive local-state fields and separate summary collection can be left in place. No collection/index deletion is required. The old code would restore its known slow and broad regional behavior, so rollback is an operational fallback rather than a data migration.

Cloudflare/private-response rules should continue to bypass caching for logged-in routes; static versioned illustrations may be publicly cached. No Cloudflare change is needed.

## Validation evidence

The development browser preview uses synthetic records only and never imports the application/database startup. Run `node scripts/preview-disaster-local.js`, then inspect `http://127.0.0.1:4179/admin/disasters`, `/mypage`, and `/art`. The preview refresh button is a synthetic no-op. Desktop 1440px and mobile 390px checks found no overflow, broken images, missing image alt attributes, unlabeled buttons, or JavaScript errors; the refresh status update worked. External layout CDN requests were blocked during this offline check. A full automated accessibility audit was not run.

An isolated loopback MongoDB 8.0.15 benchmark contained **114,000 synthetic archive records plus 114,006 summary records** (six realistic local slots and 114,000 unrelated noise slots). Across 200 real service reads: p50 **0.393 ms**, p95 **0.626 ms**, max **1.542 ms**; executionStats showed **six keys and six documents examined**, `_id_` IXSCAN, no SORT/COLLSCAN, and **zero archive queries**. Real MongoDB duplicate-key/conflict and out-of-order checks also passed. These are warm local development service timings, not production response times, HTTP/render timings, or a prediction of deployed performance.

Reproduce with a disposable MongoDB on `127.0.0.1:27189` and run `node scripts/benchmark-disaster-local.js`. The script intentionally hard-codes a separate synthetic database, resets only that database, does not load `.env`, and cannot select the application's configured database. Do not point production forwarding at that dedicated test port.

Production investigation references supplied for this change:
- Deployed baseline: `81b6ebbf0a6f5150209cf886dddc333f937acb1e`.
- [Session](/codex/sessions/tool-session-60996129cf8b6f4f65eb621147972131fb8aa048079d49bd47f27fe537927571)
- [Turn](/codex/turns/tool-turn-60996129cf8b6f4f65eb621147972131fb8aa048079d49bd47f27fe537927571)

Final verification: `npm test -- --runInBand` passed **435 suites / 5,826 tests**; the repository's existing **17 suites / 261 tests were skipped**. Configured coverage thresholds passed (overall statements 71.78%, branches 50%, functions 80.79%, lines 72.64%). Focused Disaster Watch/account/security validation passed 10 suites / 179 tests, including the final time-qualified typhoon validity regression. All 31 changed/new JavaScript files passed `node --check`; four relevant Pug templates compiled; all 26 SVGs passed XML validation (116,349 bytes combined); `git diff --check` passed. No curated OpenAPI specifications or dependencies changed, so no OpenAPI lint/dependency install was needed.

Synthetic screenshots: [desktop dashboard](images/disaster-local-v3/dashboard-desktop.webp), [mobile dashboard](images/disaster-local-v3/dashboard-mobile.webp), [mobile account card](images/disaster-local-v3/account-mobile.webp), [artwork contact sheet](images/disaster-local-v3/artwork-desktop.webp). These contain invented observations, not private or production data.
