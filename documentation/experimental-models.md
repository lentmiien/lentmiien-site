# Experimental Models admin lab

## Delivery status: foundation only, not finished

The permanent entry is `/admin/experimental-models`, registered in the account Tools
navigation for administrators. This stage implements private local staging, not
inference. Both registry entries explicitly return `contract_pending`. No Gateway
requests, capability probes, model loading, voices, jobs, generated audio, or
simulated results exist in this stage. Existing OCR allowlists, model defaults,
batch/global auth and normal Site features are unchanged.

Inspected conventions: `requireCapabilities`/`authorization`, `sessionCsrf`,
Passport database deserialization, `accountSurfacePolicy`, Pug/layout/theme tokens,
GPT Image storage/ACL/static guards, Local AI journals and Gateway clients,
EmbeddingGemma2 leases, and database-independent log-retention scheduling. The
existing job implementations carry feature-specific persistent data and provider
semantics; they are not reused as a generic lab queue.

## Security contract

- Feature: Experimental Models local staging foundation.
- Zone: logged-in; interactive principal: **true admin only**; machine principals: none.
- Data: private synthetic test inputs; environment/provider credentials are secret.
- Capability: `experimental.models.manage`; admin bundle only, family/user empty;
  per-user grants cannot bypass the explicit authoritative admin role gate.
- Scope: owner account ID **and** server-side browser session binding; no admin override.
- CSRF: shared session token, required in `X-CSRF-Token` before all mutations/parsing;
  GET/HEAD only issue session/CSRF bindings and read existing lab objects.
- Abuse: 120 API requests/minute/admin; 12 mutations/minute/admin; one upload parser
  and one storage/decode operation at a time; contention returns 429, no memory queue.
- Upload limits: one part/file, no fields, Content-Length required, 30-second receive
  deadline, 8 MiB file plus 8 KiB multipart overhead. PNG/JPEG/WebP extension and MIME
  must match decoder format. Sharp decodes/re-encodes a single frame into PNG,
  strips metadata, limits 8 million pixels / 4096-pixel edges and decode to 10 seconds.
  Original filenames are not persisted; output must also fit 8 MiB.
- Quotas: 8 files / 32 MiB per session; 2 sessions / 64 MiB per account (across logins);
  16 sessions / 256 MiB globally. Metadata and scratch are separately bounded.
- Output: escaped Pug and DOM textContent; fixed local download paths; no model HTML.
- Storage: `private_data/experimental-models`, 0700 directories / 0600 files,
  UUID names, symlink/ancestor/ownership checks using existing storage helpers,
  bounded regular single-link file reads, static mount guard, no public uploads.
- Downloads: both authorization scopes, attachment PNG, nosniff, sandbox CSP,
  private/no-store. At most two concurrent file streams with backpressure,
  30-second idle timeout and disconnect cleanup; files are at most 8 MiB.
- Outbound services: **none in this stage**; no browser-selected URL/path or token.
- Cache: all page/API/error/download responses private/no-store; analytics disabled.
- Logs: stable storage/recovery/cleanup failures with category `experimental_models`;
  no file names, images, request objects, provider exceptions or credentials.
- Retention: 24-hour **absolute** TTL, not sliding; 60-second sweep independent of DB.
  Reads immediately deny expired sessions. Clear marks delete-pending before purge;
  failed cleanup retries. No page-exit cleanup promise. Login changes do not grant
  access to old data; old sessions count against quotas until expiry.
- Restart: bounded manifests restore local sessions/quotas; orphan/invalid staging
  sessions and files are removed, and expiry resumes. No remote state exists yet.
- Tests: HTTP auth/role/CSRF/ownership/method/size/type/traversal denial, privacy,
  rendering, actual CPU decode, quotas, explicit/TTL/restart/orphan cleanup and races.
- Legacy migration: none; no DB records or production config are modified.

The store is a **single-process local filesystem** facility, matching `node app`.
Multiple Site processes must not share this directory. A distributed store/lease
would be required before that deployment topology is supported. On Windows the
existing GPT Image ACL validator must accept the private tree; failures disable
storage without exposing its path. No new environment variables are needed yet.
Application authorization remains required behind Cloudflare; no cache/WAF/public
access exceptions are added. Rollback removes the route/navigation/scheduler;
delete this feature's private directory separately if abandoning staged test data.

## Implemented routes

All paths below are relative to `/admin/experimental-models` and share the same guards.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Permanent lab page; unavailable model cards and working staging UI |
| GET | `/api/experiments` | Static public registry metadata and limits; no provider discovery |
| GET / POST | `/api/sessions` | List owned browser sessions / create session (no body) |
| GET / DELETE | `/api/sessions/:id` | Inspect / clear owned session (DELETE takes no body) |
| POST | `/api/sessions/:id/files` | One multipart `file`, image only |
| GET | `/api/sessions/:id/files/:fileId` | Private normalized PNG download |
| POST | `/api/sessions/:id/experiments/:experimentId/runs` | Fail closed: known model → 503 `contract_pending`; unknown → 404; no body |

Unknown routes, query parameters, fields and body-bearing create/delete/run requests
are rejected. Session/file identifiers never become caller-selected filesystem paths.

## Adapter boundary and next stage

`services/experimentalModels/registry.js` owns model ID/title/status, capability
source, warnings, deferred features and reserved field-schema/renderer/serializer
metadata. The fields are empty and serializers/renderers null until verified.
Adding a model must not add an arbitrary JSON forwarder or Gateway proxy.

Verified adapters will provide strict input schemas (including unknown-key rejection),
fixed allowed endpoints, passive bounded capability discovery, a safe request
serializer and allowlisted text/JSON/binary result renderers. Discovery must distinguish
contract pending, missing configuration, backend offline and unsupported controls,
and must never load a model. Authentication and transport headers stay server-side.
Do not serialize HTTP client configuration, provider errors or token hashes.

Before enabling any adapter, implement bounded asynchronous jobs with owner/session
status and results, authorization revalidation at dispatch, durable remote operation
IDs, elapsed/queue states, bounded raw previews with full sanitized downloads and
binary status/safe headers. Browser disconnect is not remote cancellation. Clear/TTL
must stop admission, mark delete-pending, then wait for terminal or confirmed cancel
and remote reference cleanup before local purge. Restart/timeout must reconcile
remote jobs; **the local-only orphan deletion in this stage must not be used for
in-flight jobs**. No upstream job may acquire local staging files in this stage.

Remote voice cleanup must be limited to namespaced IDs created and durably tracked
by the owned session; never enumerate/export private catalog identities or delete
pre-existing voices. Cloning remains unavailable if this lifecycle cannot be guaranteed.

## Exact contracts still required

1. WeVis `/ocr` (`model=wevisone-vl`) and `/perception/wevisone-vl`: exact content
   types, image transport, task enum and per-task required/optional fields, limits,
   auth, capability endpoint/schema, success/error schemas and sync/job semantics.
2. Ming `/tts/ming/tasks`: exact modes, field schemas/ranges/defaults, text/language
   constraints, voice-design/clone behavior, capability endpoint/schema, polling,
   cancellation, terminal states, idempotency, timeout and binary result contracts.
3. Ming auth is known only as server-side `MING_ADMIN_TOKEN` → `X-Ming-Token`;
   confirm its required scope on each capability/task/result/voice route. Preserve
   existing global/batch auth; never substitute `LLM_ADMIN_TOKEN` for Ming.
4. `/tts/ming/voices`: reference file formats/limits, transcript and consent rules,
   creation naming/IDs, returned lifecycle/expiry, exact DELETE semantics, retries,
   ownership and when references stop being used by jobs. Clarify `voice_id=ming:id`
   on `/tts`, including whether that route is needed at all for the lab.
5. For both: HTTP status/safe headers, output content types/maximum bytes, whether
   returned locations are fixed same-origin identifiers, remote retention and
   restart reconciliation. Provide synthetic request/response examples for mocked
   adapter tests; no credentials, private voices or personal sample content.

Reported context is shown as unverified experiment warnings: WeVis OPEN → FEH OCR
quality failure; Ming English voice design passed. Neither is a Site adapter test.
Masks/matting/streaming remain deferred. No live inference or deployment is needed
to finish the next source-and-mocked-test stage once these contracts arrive.

## Foundation validation (2026-10-30)

- Focused lab, browser, authorization, CSRF, navigation and private-storage suites:
  **122 tests passed** across 7 suites, using temporary storage and synthetic images.
- Full `npm test -- --maxWorkers=2 --workerIdleMemoryLimit=256MB` in a temporary
  source-only snapshot (pending source changes included, clean environment, no
  `.env`, credentials or runtime data): **6,054 passed, 261 skipped, 5 failed**;
  439 suites passed, 17 skipped, 5 failed. Coverage thresholds passed.
- The five failures are existing game asset checks in `lentmancGame`,
  `galaxyCenterJourneyGame`, `dinosaurHistoryGame`, `deepOceanJourneyGame` and
  `kardashevGame`: their ignored WAV masters are absent from a source-only copy.
  Those tests and generated assets were not changed. An initial serial full run
  exhausted Node's heap; recycling workers allowed the full run to finish.
- `git diff --check` passed. No dependencies or curated OpenAPI specs changed.
- Visual screenshot validation was unavailable because no browser was connected;
  real Express HTTP, Pug rendering and jsdom browser interaction tests passed.
- No live Gateway requests, GPU inference, production app startup, deployment,
  database mutation, voice registration or personal test content were used.
