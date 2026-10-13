# ADMIN EmbeddingGemma2 playground

## Security contract

- Feature/zone: isolated EmbeddingGemma2 experiment, logged-in only.
- Interactive principals: admin bundle only; no machine principals or per-user grants.
- Capability: `embeddinggemma2.pilot.manage`, assigned only to the admin bundle using shared capability middleware. Object scope: owner (validated principal `_id`); no administrator override.
- Classification: private test content. No app content integration, imports, RAG, queues, existing embedding collections, or analytics.
- All mutations (including search) require shared session CSRF header and POST/DELETE. Authorization precedes parsers and file access.
- Limits: one globally leased operation, 6 mutation requests/minute/owner, 8 MiB/file, 64 KiB text JSON, 16,000 text characters, 256 title characters, one file, bounded fields/parts, 30s upload. Fixed model identity, 768 finite nonzero normalized floats. Defaults: 200 records/owner, 500 global, 256 MiB/owner, 512 MiB global; top K 1–50, complete cursor scan capped at configured global capacity (fail explicitly if exceeded), batch 32.
- Output: escaped Pug/textContent; private authorized media with nosniff, sandbox CSP, no-store, opaque paths and range support. Files outside public; symlinks forbidden.
- Outbound: only configured trusted AI Gateway origin, fixed paths, no redirects or user URLs; no application secrets forwarded. Existing `AI_GATEWAY_BASE_URL` connection convention has no inference token. Reverse-proxy authentication must be provided by the same trusted network boundary as existing Site Gateway clients; do not use the Gateway admin token for inference.
- Diagnostics: shared logger, stable messages and status/error class only, no bodies, filenames, text, vectors, or provider diagnostics.
- Retention: until owner deletion; query uploads exist only during local validation and are always removed, never inserted. Failed/pending ingests and interrupted deletes are reconciled under the feature lease on the next operation.
- Negative tests: unauthorized/role/owner/CSRF, strict contract/space, file/path/limits, cleanup, capacity/ranking and generic errors.
- Migration: none. Lazy separate `useDb` on the existing managed connection; feature errors stay local. No production provisioning by development session.

## Authoritative Gateway contract

On 2026-10-13 this workspace successfully fetched (HTTP success, `curl --fail` exit 0)
[the live Gateway usage document](http://192.168.0.20:8080/documentation/embeddinggemma2-gateway-usage.md).
No inference, worker health, container start, discovery mutation, or GPU request was made.
The deployed Gateway release supplied by the operator is `b5df9d2cd58a2551b63eabfabb7f031ec0b0f355`.

- Model: `google/embeddinggemma-2`; revision `914f7f89142e33e77833254d9c9b90c3cef7303b`.
- Exact space: `google/embeddinggemma-2@914f7f89142e33e77833254d9c9b90c3cef7303b:768:l2:pilot-v1`.
- Text: `POST /embed/embeddinggemma2`, `{dimensions:768,items:[{text,role,title?}]}`. Site sends one raw document/query item, never `texts`; title only on stored text documents. Gateway applies prefixes, rejects overflow rather than truncating, context maximum 8,192 expanded tokens. Site JSON cap includes escaped text overhead.
- Media: `POST /embed/embeddinggemma2/media?kind=image|audio|video&dimensions=768`, one original file as `application/octet-stream`. No multipart to Gateway, filenames, URLs, base64, OCR/transcript substitution or direct worker calls.
- Outputs: exactly one vector and parallel chunk, both item indexes zero; exact model/revision/space/dimensions/normalization/preprocessing version are checked. L2 norm must be within 0.02 of one, then normalized precisely in Site. Float32 and BF16 are accepted as declared compatible by the Gateway; no quality guarantee.
- Images: PNG/JPEG/WebP, one frame/page, ≤4,000,000 pixels and edge ≤4,096. A generic application/octet-stream upload declaration is accepted only when extension, magic bytes and decoding independently validate the actual safe format. Originals preserved; server fully decodes via Sharp before serving the original in a constrained native image context. They are not re-encoded because original-source preservation is part of this experiment.
- Audio: WAV/MP3/FLAC/Ogg/Opus, or first audio stream of MP4/MOV/MKV/WebM/M4A/MKA. ≤10s. Local validation decodes mono 16kHz float32 with overflow sentinel.
- Video: MP4/MOV/MKV/WebM, first video stream, ≤8s, ≤2,073,600 source pixels, edge ≤2,048, ≤4 streams. Local 1 fps sentinel rejects >8 frames. Gateway samples visual frames, reduces long edge to 768, ignores rotation metadata and soundtrack. No automatic segmentation.
- Local FFmpeg/ffprobe use a signature-selected demuxer allowlist, only file/pipe protocols, MOV external references disabled, 20-second process deadlines, one decoder thread, Linux `prlimit` (1 GiB address space, 20 CPU seconds, 16 MiB file output) and capped stdout. Gateway remains final decoder/token authority. Browser codec support varies; compatible originals can be opened/downloaded and played locally.

## Configuration and isolated storage

All keys are in `env_sample`. No dependency changes are required. Runtime needs the pinned Node from `package.json`, existing Sharp, and host `ffmpeg`, `ffprobe`, `prlimit` (`ffmpeg` and `util-linux` packages on Debian/Ubuntu).

| Variable | Default | Accepted bounds |
| --- | --- | --- |
| `EMBEDDINGGEMMA2_ENABLED` | `false` | literal `true` or `false` |
| `EMBEDDINGGEMMA2_DB_NAME` | `embeddinggemma2_pilot` | exact default or prefix plus `_` and 1–32 lowercase letters/digits/underscores |
| `EMBEDDINGGEMMA2_STORAGE_DIR` | `<checkout>/private_data/embeddinggemma2` | dedicated private absolute directory, no symlinks, outside public and its ancestors |
| `EMBEDDINGGEMMA2_TIMEOUT_MS` | `1800000` | 1800000–3600000 |
| `EMBEDDINGGEMMA2_USER_ITEMS` | `200` | 1–2000 |
| `EMBEDDINGGEMMA2_GLOBAL_ITEMS` | `500` | 1–5000 |
| `EMBEDDINGGEMMA2_USER_BYTES` | `268435456` | 8388608–4294967296 |
| `EMBEDDINGGEMMA2_GLOBAL_BYTES` | `536870912` | 8388608–8589934592 |
| Existing `AI_GATEWAY_BASE_URL` | `http://192.168.0.20:8080` | operator-controlled HTTP(S) origin only; no path, credentials, query or fragment |

Byte capacities account for original content (UTF-8 text/title or file bytes). Mongo vectors, indexes and metadata add overhead, bounded separately by record count. Global limits also apply when per-owner limits are higher. Lowering limits below existing usage blocks adds; lowering global record limits below usage blocks searches explicitly instead of silently skipping old records. Owner lists remain paginated, and delete remains available.

`connection.useDb(name, {useCache:true})` reuses the already authenticated managed Mongoose client and therefore **preserves its original authSource, credentials, TLS, topology and reconnection lifecycle**. No second URI, new global connection, primary database change, automatic migration or existing vector model is used. A database name equal to the primary connection name is rejected. Models/indexes are lazy, with failure returning feature-local 503 and payload-free application logs. The page itself requires no pilot DB operation; its dataset request reports unavailable storage.

Collections are exclusively `eg2_records` and `eg2_control` in the dedicated database. `eg2_records` stores owner ObjectId, state, modality, original text/title OR opaque private asset name/canonical MIME/sanitized display filename, original byte count, capture date, vector, model/revision/space/dimensions/normalization/precision, preprocessing metadata/version and chunk mapping. Index `eg2_owner_space` covers owner/state/space/dimensions/date; normal `_id` indexes also exist. `eg2_control` contains a single operation lease, with a random fencing token and expiry. It contains no query content. The generic Site DB viewer remains on the primary database; no private pilot collections are registered there.

Files have 48-hex random names, mode 0600, directories created mode 0700. Reads/deletes check root realpath, opaque names, regular files, no symlink/hardlink and bounded size; reads use `O_NOFOLLOW`. Filesystem access is only through the feature-owned service. Do not point storage at another feature's directory or share it between different pilot database names. Back up this database and directory together if test data matters.

### Mongo permissions — human provisioning only

A DBA must grant the **existing Site Mongo principal**, in its existing authentication database, permissions on the separate pilot database. Do not change `MONGOOSE_URL`'s selected database or `authSource`. The narrow custom-role privileges are:

```javascript
// Run only by the DBA in an authenticated mongosh session; no credentials in scripts.
const pilot = db.getSiblingDB('embeddinggemma2_pilot');
pilot.createRole({
  role: 'embeddinggemma2Pilot',
  privileges: ['eg2_records', 'eg2_control'].map(collection => ({
    resource: { db: 'embeddinggemma2_pilot', collection },
    actions: ['find', 'insert', 'update', 'remove', 'createCollection', 'createIndex', 'listIndexes']
  })),
  roles: []
});
// Substitute the actual existing principal/auth DB; grant, do not replace its roles.
db.getSiblingDB('<EXISTING_AUTH_DB>').grantRolesToUser('<EXISTING_SITE_USER>', [
  { role: 'embeddinggemma2Pilot', db: 'embeddinggemma2_pilot' }
]);
```

A database-scoped built-in `readWrite` grant is a simpler, broader alternative; no cluster administration or rights to other databases are needed. These commands were **not run** in development. Verify permissions and lazy index creation during the human smoke test; Mongo behavior/topology has not been exercised here.

## API and operational behavior

All paths below are under `/admin/embeddinggemma2`. Page and APIs require an authenticated principal with the admin-only `embeddinggemma2.pilot.manage` bundle capability. Assigning an arbitrary role document grant to a nonadmin does not enable this experiment. Even administrators cannot access one another's records. Long operations recheck the persisted session and current account capability before inference, after inference and before returning results.

| Method/path | Input / output |
| --- | --- |
| `GET /` | Two forms with shared CSRF token, no analytics |
| `GET /api/records?before=<ObjectId>` | Own recent 20 records, next cursor, total/compatible counts and owner capacity; no vectors or disk paths |
| `POST /api/records` | JSON `{kind:"text",text,title?}` OR multipart `kind` + one `file`; persists one original and embedding |
| `POST /api/search` | Same modalities, no title; optional `topK` 1–50, `filter` all/text/image/audio/video; ranked original records + scanned/eligible/excluded counts |
| `GET/HEAD /api/records/:id/media` | Own original image/audio/video, private no-store, safe MIME, nosniff, sandbox CSP; single byte range/suffix supported, invalid/multiple ranges 416 |
| `DELETE /api/records/:id` | Own record and file; browser asks confirmation first |

POST/DELETE require `X-CSRF-Token` from the current session. Origin checks use shared `CSRF_ALLOWED_ORIGINS` conventions. Content-Length is mandatory for uploads (ordinary browser FormData and JSON provide it); chunked uploads are intentionally rejected. Total multipart length ≤8 MiB +64 KiB, one file ≤8 MiB, ≤5 fields/6 parts, field size ≤64 KiB, 30-second upload wall time. Unknown fields, client ownership/model/URL/path choices, text prefixed with task/title, query titles and malformed IDs are rejected. No GET mutates user content or calls inference; first authorized data access may lazily create indexes.

The supported deployment is **one Site process**, consistent with its current in-memory session store. Mutation rate is 6/minute/owner; all API reads/writes share 120/minute/owner. The local limiter rejects overlaps before parsing files; the database lease additionally fences accidental second-process mutation admission. Do not deploy multi-replica service behind these local rate limits. Host clocks must agree if replacing processes on different hosts.

One global lease covers recovery, upload/validation, Gateway inference, persistence/search/delete. Its lifetime is client cold timeout +180 seconds. No automatic retry or health call is made. HTTP response/socket inactivity budgets are timeout +120 seconds. On disconnect, already-submitted inference is awaited; it cannot safely be presumed cancelled. An uncertain Gateway result (502/timeout/invalid response) retains the lease until its deadline as a conservative cooldown. Reload the dataset and inspect Gateway monitoring before resubmitting; a lost successful HTTP response can still mean the add committed. The browser prevents double clicks but this is not cross-tab content deduplication.

Search applies owner + exact identity + ready state + optional modality before scanning **every** eligible record in cursor batches of 32. Only top K records remain in memory; no newest-N approximation, no vector engine. A corrupt vector fails visibly. Raw dataset counts and search coverage/exclusions are visible. Text is rendered with escaped Pug or DOM textContent, including script-like test strings.

### Recovery and retention

Ingest performs inference before creating a durable `pending` record; then writes/fsyncs its private file and marks it ready. On write/commit failure it removes file and record; if cleanup is unavailable the intent remains for reconciliation. No file exists before its DB intent, avoiding untracked persistent files. Delete marks `deleting`, removes file, then deletes record; missing file is idempotent. A crash leaves a recoverable pending/deleting row. The next admitted mutation reconciles incomplete rows and orphaned query staging after the previous lease expires, with bounded cursors and actionable recovery logs. Recovery is feature-internal cleanup, not an admin read override.

Query validation files live in `staging` and are removed in `finally`; bytes sent to Gateway are held only for the request. A hard process crash can leave staging until the next admitted operation. There is deliberately no new background worker. Unexpected paths or unsafe links fail closed and require operator investigation; recovery never recursively deletes arbitrary content. A successful query is never inserted. Stored records remain until explicitly deleted; disable preserves them. No bulk-clear endpoint exists.

## Human deployment handoff

This release stops at preparation. Do not run production deployment, restart, live inference or DB provisioning from the development session. The coordinating assistant should ask Lennart to do the following after receiving the exact pushed SHA.

1. In the **actual production checkout**, record its branch/SHA/status. Preserve unrelated dirty work. Inspect the single scoped release commit before cherry-picking; do not reset, clean or blanket-stash production files. Example commands (replace `RELEASE_SHA` with the handoff SHA):

   ```bash
   git status --short
   git branch --show-current
   git rev-parse HEAD
   git fetch origin feat/admin-embeddinggemma2-pilot
   git show --stat RELEASE_SHA
   git diff --name-only RELEASE_SHA^ RELEASE_SHA
   # If local edits overlap these files, reconcile them first; do not force this.
   git cherry-pick RELEASE_SHA
   ```

   A conflict is a human reconciliation point, not permission to discard changes. If the commit is already an ancestor, skip cherry-pick. No npm dependency/lockfile change is needed; for a fresh release environment use normal `npm ci` with the pinned Node.

2. Install/verify host decoders using the host's normal package management:

   ```bash
   command -v ffmpeg
   command -v ffprobe
   command -v prlimit
   # Debian/Ubuntu only, if missing:
   sudo apt-get install ffmpeg util-linux
   ```

3. Have the DBA perform the permission grant above. Configure the Site's existing environment source (do not overwrite `.env` or print secrets). Recommended initial values:

   ```dotenv
   EMBEDDINGGEMMA2_ENABLED=true
   EMBEDDINGGEMMA2_DB_NAME=embeddinggemma2_pilot
   EMBEDDINGGEMMA2_STORAGE_DIR=/home/lennart/Programming/lentmiien-site/private_data/embeddinggemma2
   EMBEDDINGGEMMA2_TIMEOUT_MS=1800000
   EMBEDDINGGEMMA2_USER_ITEMS=200
   EMBEDDINGGEMMA2_GLOBAL_ITEMS=500
   EMBEDDINGGEMMA2_USER_BYTES=268435456
   EMBEDDINGGEMMA2_GLOBAL_BYTES=536870912
   AI_GATEWAY_BASE_URL=http://192.168.0.20:8080
   ```

   The example storage path assumes that is the actual production checkout; otherwise choose a stable dedicated absolute directory outside public. Create it as the Site service user, or let the feature create it with restrictive permissions. Do not change existing Gateway authentication/proxy or Mongo authSource.

4. Ensure browser ingress permits ≥1,920 seconds with the default timeout (HTTP headers/body upload still have short budgets). For a configurable Nginx location, `proxy_read_timeout 1920s; proxy_send_timeout 1920s; client_max_body_size 9m;` are the relevant values, while retaining existing authentication and TLS. These do not override an upstream Cloudflare plan's hard request deadline. If that deadline is shorter, use the existing authenticated LAN/VPN Site origin for the pilot; do not expose an unauthenticated bypass. Disable caching for `/admin/embeddinggemma2*`, do not add analytics, preserve Access/WAF rules, and keep server-side controls authoritative.

5. Let active Site/Gateway work finish, then restart only the Site using its existing supervisor. The repository has **no verified production unit/container name**; this session did not inspect/change the running supervisor. For a systemd deployment, Lennart must supply the existing unit name:

   ```bash
   SITE_UNIT='<existing-site-unit.service>'
   sudo systemctl restart "$SITE_UNIT"
   sudo systemctl is-active "$SITE_UNIT"
   git rev-parse HEAD
   ```

   For another supervisor use its corresponding existing single-process restart command. The runtime entrypoint is `node app` under that supervisor. Do **not** use `npm start` as a smoke test: prestart performs setup/database/Dropbox maintenance. A standalone `node app` also starts normal background services; do not launch a second instance. No Gateway restart or worker/provisioning operation is required by this Site release.

### Browser acceptance — Lennart after release

Use only deliberate public/synthetic test content. Record deployed Site SHA, browser/origin, Gateway release SHA, timestamps and outcomes; redact cookies and tokens.

1. Log in as admin, open Tools → Administration → AI Admin → EmbeddingGemma2 playground, or `/admin/embeddinggemma2`. Verify dark theme, accessible labels, initial zero/count state, no analytics and no Gateway inference on load. Check lazy DB indexes/permissions and private directory permissions. A disabled or unavailable feature must leave other Site pages working.
2. Add **all four**: a short titled text describing a red square; a PNG/JPEG/WebP red square; a ≤10s audio clip; a ≤8s MP4/WebM visual clip. Wait for each cold request; verify spinner, disabled buttons, original previews, titles/filenames, counts, provenance and exact space. Video's audio is deliberately ignored. No existing Site collection/content should change.
3. Query **all four modalities against the same mixed corpus**, default all modalities, without clearing records between tests. Verify complete scanned/eligible coverage and descending cosine scores; compare intuitive cross-modal matches without treating scores as probabilities or expecting perfect quality. Try top K and explicit modality filter. Query uploads must not change counts or survive in `staging` after completion.
4. Play and seek stored audio/video; inspect 206/Content-Range, image originals, private/no-store/nosniff headers. Unsupported browser codecs may need original download/local playback. Check source text including a harmless `<script>` string remains inert.
5. Delete a text and a media record with confirmation. Refresh and verify both disappear, original media returns 404, and the corresponding private asset is gone. Confirm other records remain.
6. Log in as another admin: dataset/list/search/media/delete must not expose the first admin's records. As `user`, `family`, and logged out, directly request page/list/add/search/delete/media URLs: 403/401, including copied media URLs. Missing/invalid CSRF or a foreign Origin must reject mutations before inference.
7. Reject >8 MiB, wrong extension/MIME/signature, SVG, animated images, long audio/video, excessive dimensions and prefixed/query-titled text. Check application diagnostics contain no payloads. Test admission/double-submit in two tabs without repeatedly submitting GPU jobs. Exercise account/session revocation while a deliberately approved test request waits.
8. If a cold request exceeds proxy limits or loses its response, do not immediately retry. Check Gateway monitoring, wait for reclaim/lease expiry, refresh records, and confirm there was no unintended duplicate. No automated live smoke was performed by this release.

### Rollback / disable

Set `EMBEDDINGGEMMA2_ENABLED=false` in the existing environment source and restart only the Site through its normal supervisor after active work finishes. The link may remain visible to admins, but every feature route returns disabled without DB or Gateway work. Data remains isolated for later review. Reverting the single Site commit is optional; no downgrade/migration of existing app vectors is necessary. Do not delete the directory/database or revoke credentials as part of ordinary rollback. If permanent removal is requested later, a human should stop feature traffic, back up if needed, then explicitly remove only the named pilot DB and dedicated media directory after checking realpaths.

## Development verification and provenance

Focused command:

```bash
npm test -- tests/unit/embeddingGemma2Contract.test.js tests/unit/embeddingGemma2Files.test.js tests/unit/embeddingGemma2Service.test.js tests/unit/embeddingGemma2Routes.test.js --coverage=false --runInBand
```

Tests use mocked Gateway/DB operations, local HTTP test servers and temporary synthetic media decoded locally. They cover role/CSRF/owner boundaries, exact request/response identity, dimension/zero/nonfinite guards, private storage/symlinks/traversal, duration/pixel/size bounds, query cleanup, cosine ordering/coverage/filters/capacity, rollback/recovery, lease admission, privacy and range playback. There was no connection to a live Mongo database or inference endpoint. Full-suite results and exact commit/push status are recorded in the release handoff.

Related persisted context: [Gateway deployment session](/codex/sessions/tool-session-a41490a70e51cf8cc940e342cf935b83a66564444ff86d3d859496970bb17fc1), [prior Site read-only inspection](/codex/sessions/tool-session-8a3b23bc7b0b5ed82e06ca8bbf29148436f583c762f68288486a0b8211ccff1e). These are supplied coordinator session links; this session did not fetch their contents.

Verification recorded 2026-10-13: the full Jest run passed 383 suites / 4,904 tests with 8 suites / 117 tests skipped; configured coverage thresholds passed (71.78% statements, 50% branches, 80.79% functions, 72.64% lines). The final focused run passed 4 suites / 52 tests after additional review hardening. No known failing suite was observed. Existing VM Modules / router Promise-like-handler warnings appeared in the broader run. JavaScript syntax checks, Pug compilation/render tests and `git diff --check` passed. Real Mongo permissions/behavior, live Gateway inference, production proxy timing and browser playback remain human acceptance items.
