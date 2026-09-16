# Music Phase 4: permanent YuE2 full-song option

## Status and release contract

The user has confirmed successful live ACE and YuE2 generation and persistence
in the shared library from the prior phases. Those confirmations are accepted;
Phase 4 does not require repeating prior-phase acceptance. The user authorized
removing the 30-second ceiling, permanent availability, full rollout and a small
benchmark. **Phase 4 deployment, longer generation and benchmarks remain pending.**
This Site task performs CPU-only development/testing and commit/push; no
production deployment, restart, production tests or GPU generation is performed.
Approvals and operator coordination stay in the coordinating chat.

**Deploy SITE FIRST, then Gateway.** The prior Site rejects the expanded catalog
as a whole, blocking ACE too. This Site accepts both contracts:

| YuE2 discovery | Existing Gateway | Expanded Gateway |
| --- | --- | --- |
| Integer `max_duration` | 8–30 seconds | 8–300 seconds (5 minutes) |
| Default ceiling | 20 seconds | 300 seconds |
| Execution bound/default | 1830 seconds | 3630 seconds |
| Queue budget | 900 seconds | 900 seconds |

`max_duration_seconds` remains an input alias; both aliases must agree when
supplied together. Defaults and any smaller discovered bounds are authoritative.
Missing duration capabilities fall back to 8–30/default 20 and missing execution
to 1830, never silently enabling a longer run. Malformed, inconsistent or
out-of-reviewed-range catalogs fail before dispatch or display. Unknown models
cannot dispatch; additive metadata cannot authorize unknown request settings.
Unavailable/disabled YuE2 is never substituted with ACE.

300 seconds is an operational ceiling, not a promise of exact output length or
an official recommended model maximum. The coordinating assistant's prior
upstream review found a default 9000 semantic tokens (about 360 seconds) and an
official five-minute example, but no official recommended maximum. No new
upstream lookup, runtime/model pin upgrade or dependency change is part of this
release. Songs may finish naturally before the selected ceiling.

Gateway's parallel change plans `GENERATION_TIMEOUT_SECONDS=3600`, with 3630
seconds exposed for YuE2 execution/upstream overhead. Site computes transport
from **actual discovery execution + queue + preparation + cleanup + 60 seconds**,
not from audio duration. Preparation/cleanup fallbacks remain 900/600 seconds;
explicit discovery values are bounded and used. With the stated default budgets,
YuE2 transport is 4290 seconds on old Gateway and 6090 on expanded Gateway.
ACE remains the default provider and keeps its existing settings and 7200-second
execution budget; an expanded YuE2 contract does not inflate ACE budgets.

Permanent means YuE2 is durably enabled in Gateway code/Compose by default, with
`YUE2_ENABLED=false` retained as an operator kill switch. It remains managed by
the shared scheduler, starts lazily and auto-stops; it is not GPU-resident.

## Site behavior and security review

The [Phase 3 security contract](music-phase3.md#security-contract) applies in full:
logged-in zone; no inbound machine principal; private prompts, lyrics and audio;
`music.library.read/write`, `music.generation.create`, `music.gateway.manage`;
explicit role grants; shared library membership and owner-scoped jobs with the
documented administrator inspection override. There are no new routes,
capabilities, storage locations or authorization exceptions.

The Phase 4 delta is bounded longer YuE2 generation through the same manual,
AI-assisted, Infinity and admin flows. Server validation checks discovery and
selected settings before AI or Gateway work. AI receives the normalized ceiling,
can write full song sections for longer selections, and can only supply caption
and lyrics. Provider settings remain normalized user choices. Shared forms show
discovered min/max/default, explain the ceiling and preserve per-provider
snapshots, blank/random seeds, zero and exact large decimal seed strings. Input
seeds above the existing safe integer bound still fail server validation.
Programmatic AI/Infinity submission also checks the ceiling before sending.

Security checklist reviewed against `security-framework.md`:

- Session capability, shared collection, job ownership/admin and revoked-principal
  checks retained; no request-supplied owner or arbitrary provider selection.
- Non-GET browser mutations, shared CSRF/Origin checks, private/no-store responses
  and no analytics retained. Negative integration tests cover unauthorized and
  forged requests, foreign jobs, malformed catalogs/settings and disabled models.
- Existing input/text/byte bounds, five requests/user/minute, three global active
  jobs, one active job/user, one background job and 200 retained jobs remain.
  Execution/queue/preparation/cleanup and total five-hour transport bounds apply.
- Pug escaping, safe inline JSON and DOM text rendering retained; shared layout
  supplies the Graphite/Ember/Golden Amber theme. No new external UI assets.
- Private Gateway files remain outside Site public storage; persisted-library
  authorization, constrained output paths/host, no redirects and GET/HEAD/Range
  proxy behavior remain. Historic missing model metadata stays unknown.
- Shared logger reports discovery/preparation/dispatch/finalization failures with
  concise status/stage metadata, without prompts, credentials or provider bodies.
- Terminal jobs retain their existing one-hour retention; active jobs do not
  expire on that timer. Library records and Gateway files retain existing policy.

Jobs remain in memory, are lost on Site restart and cannot be replayed or resumed.
There is no cancellation API; disabling Infinity stops future submissions, not
an in-flight Gateway operation. Timeout/disconnect outcomes may be uncertain:
inspect finalized outputs/logs before manually resubmitting. No automatic retry,
orphan import or job redesign is added.

## Operator deployment steps (pending; coordinating-chat approval)

1. Let active jobs settle. Deploy the finished Site commit first through the
   existing Site checkout/process management workflow, using pinned Node
   **24.20.0**. Use the existing process definition; do not guess service/unit
   names. No schema migration, build, environment or dependency change is needed.
   Do not use `npm start`/`setup.js` as a smoke test: prestart can mutate data and
   synchronize Dropbox. The operator handles any approved restart using the
   existing production procedure.
2. Before expanding Gateway, check the Site against old discovery: YuE2 still
   shows 8–30/default 20 and ACE remains usable. A stale browser page is safe:
   every submission revalidates current discovery. Reload pages after rollout
   to pick up the new default; stale long settings after a downgrade fail closed.
3. Deploy the approved parallel Gateway release through its existing handover,
   retaining scheduler/queue/startup/cleanup behavior, runtime/model pins,
   installed batching override, output manifests and mounts. Verify durable YuE2
   enablement and the false kill switch. Preserve ACE enabled and the default.
4. Verify discovery now advertises 8–300/default 300 and execution 3630. Check
   `/music`, `/admin/music-test` and `/admin/ai-gateway` display the actual limits,
   startable/disabled state and model-aware endpoint subtitle. Reverse-proxy
   timeouts must accommodate the discovered transport budgets; timeout does not
   authorize replay. Preserve private caching and Range/If-Range forwarding.
5. Complete the approved longer-generation acceptance and small benchmark below
   on the shared live GPU as a human/operator task after deployment. This is
   new Phase 4 evidence, not a request to reconfirm successful prior dual-provider
   generation and persistence. Review sanitized production failures if any.

No new secrets or rotation steps are required. Existing server-only Gateway
configuration and private output/Cloudflare policy remain in effect.

## Benchmark and ETA (deferred)

No actual new benchmark data is available. No UI ETA is shown or inferred from
execution limits, token budgets or upstream hardware. Keep ETA deferred until
measurements from this deployment are supplied.

The approved small benchmark is **human-run** after rollout, sequentially on the
shared live GPU: one 60-second ceiling and one 300-second ceiling. Record the
selected ceiling, actual output audio length (including early completion),
observed elapsed time, cold/warm state, success/failure and crop/truncation flags.
If available, record actual queue/preparation/generation/cleanup timings with
clearly stated measurement boundaries; no additive timing response contract is
assumed. Verify the resulting long output persists and plays/seeks through the
existing private library. Supply sanitized reports later without prompts, lyrics,
credentials, private URLs or personal data. Do not invent results or expand this
into autonomous GPU work.

## Rollback and historical outputs

Prefer **compatible disable-flag rollback**: retain the expanded Gateway parser
and this Site, set Gateway `YUE2_ENABLED=false` through the approved operator
workflow, keep ACE enabled, and retain all manifests/mounts/outputs. The old
30-second Gateway artifact parser cannot read new long-artifact metadata; do not
revert to it after producing longer outputs. Dispatch disablement must retain
compatible output listing/playback for already saved tracks.

Avoid reverting Site to its old catalog validator while expanded discovery is
served, because that also breaks ACE discovery. Do not delete/backfill MongoDB
fields, change the unique output-path index or rewrite historical paths. Releases
older than Phase 2 cannot be relied on to serve YuE2 namespaces; old Site proxies
also lack the current mixed-model/Range/HEAD support. Keep compatible readers
when preserving historical ACE and YuE2 playback matters.

## Verification

Tests use mocked Gateway/OpenAI/database responses, local HTTP fixtures, Pug and
JSDOM only. No production or GPU tests, browser/device playback claim, deployment,
restart or benchmark is part of this development run.

Final verification on Node 24.20.0 (2026-09-16):

- Focused: **14 suites, 477 tests passed**, zero failures/skips.
- Full: **300 suites passed, one skipped; 3401 tests passed, four skipped**,
  zero failures. All configured coverage thresholds passed.
- The unchanged skip is `tests/unit/gptImageWindowsStorage.test.js`, the opt-in
  Windows private-media ACL suite; this environment is Linux.
- 215 tests were added. Existing seed, authorization, CSRF, private output/range,
  job retention and persistence regressions remain covered. Both runs emitted
  only the expected experimental VM modules warning.
- `git diff --check` passed; implementation, tests, fixtures and security/release
  notes were reviewed before commit. No contract deviation or blocker identified.

Exact commands:

```sh
volta run --node 24.20.0 npm test -- --runInBand --coverage=false tests/unit/musicGatewayService.test.js tests/unit/musicUi.test.js tests/unit/musicIntegration.test.js tests/unit/musicJobs.test.js tests/unit/musicOutputProxy.test.js tests/unit/musicDashboard.test.js tests/unit/adminRoleManagement.test.js tests/unit/sessionCsrf.test.js tests/unit/authorization.test.js tests/unit/openaiApiConversion.test.js tests/unit/templateService.test.js tests/unit/aiGatewayLiveGpu.test.js tests/unit/aiGatewayLogStats.test.js tests/unit/aiGatewayReservationAdmin.test.js
volta run --node 24.20.0 npm test -- --runInBand
git diff --check
```

Implementation paths: `services/musicGatewayService.js`,
`controllers/musiccontroller.js`, `public/js/music_controls.js`,
`public/js/music_library.js`, `views/partials/music_controls.pug` and
`views/admin_ai_gateway.pug`. Tests are in `tests/unit/music*.test.js`;
`tests/fixtures/music/models.json` models the agreed expanded contract, while
`models-legacy.json` preserves the former fixture byte for byte. These fixtures
are contract data, not evidence of new live generation.

Prior read-only coordinating session:
`/codex/sessions/tool-session-4353d371f871ffa3425f2209990e09ed9540e748a61ec9af0b641cc31fc1f535`
(initial clean Site HEAD `2b02b7a86e0a2ee8d66eb303edeca1a748cc2093`).
