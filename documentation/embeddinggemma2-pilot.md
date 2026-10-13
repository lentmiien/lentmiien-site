# EmbeddingGemma2 admin-only test dataset

Update the Site normally, restart **LennartWeb**, and open **`/admin/embeddinggemma2`** (Tools → Administration → AI Admin → EmbeddingGemma2 test dataset). It is enabled for authorized admins by default. Each admin sees only their own entries.

In PowerShell from `C:\Projects\lentmiien-site`, check that the checkout is clean and on `main`, then pull and restart only after a successful pull:

```powershell
if ((git branch --show-current) -ne 'main' -or (git status --porcelain)) { throw 'Check branch and preserve local changes before updating' }
git pull --ff-only origin main; if ($LASTEXITCODE -ne 0) { throw 'Pull failed; do not restart' }
Restart-Service -Name 'LennartWeb'
```

The existing WinSW service runs `app.js` directly. Do not use `npm start`. No new environment values, credentials, database grants, directory preparation, ACL commands, packages, FFmpeg or other host binaries are required. The existing Gateway default is `http://192.168.0.20:8080`.

## Isolated test data

- **Collection:** `embeddinggemma2_test`, inside the Site's existing primary MongoDB database. The primary database selection, URI, authentication and lifecycle are unchanged. Entry documents (`recordType: entry`) and the durable operation lease (`recordType: control`, string ID `operation`) share this one collection. All entry queries and counts exclude control records; the owner/space index is partial to entries. No tool writes target other collections or existing embedding queues, backfills or RAG data.
- **Folder:** `<checkout>/private_data/embeddinggemma2_test`, explicitly gitignored recursively, including `staging` and dotfiles. Created automatically on the first authorized operation needing storage, using the ordinary service account. Originals remain private and are delivered only by authenticated, owner-scoped admin routes. Query media stays in bounded memory and is never saved.
- Windows uses the checkout's existing inherited filesystem permissions. POSIX modes restrict newly created files/directories; those modes do not promise equivalent Windows ACL restrictions. Existing path, junction/symlink, hardlink and open-handle checks remain enforced. An actual write/index permission failure is logged and makes this feature unavailable, without preventing the rest of the Site from running. Existing primary Mongo permissions normally suffice.
- Earlier `EMBEDDINGGEMMA2_DB_NAME` and `EMBEDDINGGEMMA2_STORAGE_DIR` settings are no longer used. Earlier databases or folders are neither migrated nor deleted automatically. There is no alternate Mongo connection.

## First acceptance after the human update

Open the page as admin. Add a small text, image, ≤10-second audio and ≤8-second visual video (each media file ≤8 MiB). Query with each of the four modalities against that mixed dataset, preview originals, play/seek audio and video, then delete selected entries and confirm they disappear. Video embeddings ignore the soundtrack. Full retrieval quality evaluation can follow later.

Cold inference may take 30 minutes. Busy/rate errors mean wait before retrying; after a timeout or lost response, check Gateway monitoring and refresh the dataset before resubmitting. Browser/proxy deadlines can still interrupt a long request. The durable lease remains closed through its original deadline after uncertain Gateway outcomes. No automatic inference retries occur.

Native Windows execution, actual Mongo permissions/index creation, live Gateway inference, proxy timing and browser playback remain live acceptance checks. Development verification does not deploy or restart the Site, change live MongoDB, or call inference.

## Future clean start (not performed by this release)

First stop new tool traffic, let active requests finish, and check Gateway monitoring for any uncertain outstanding request. Then set the optional `EMBEDDINGGEMMA2_ENABLED=false` and restart the Site to block all tool operations; keep it disabled throughout cleanup. If an uncertain request remains, wait for its completion/reclamation and lease deadline before removing the control record.

After verifying the existing primary database and exact real folder path, a human may drop **only its `embeddinggemma2_test` collection** and delete **only `<checkout>/private_data/embeddinggemma2_test` and its contents**, including staging. Reject symlinks/junctions instead of following them. Never drop the primary database or clean any shared/public upload directory. Removing both exact targets clears every tool entry, vector, original and durable control record. Remove the optional disable setting and restart when ready; collection/indexes and folder are recreated lazily. No reset button or automatic reset exists.

## Optional advanced settings

No overrides are needed for normal use. `env_sample` lists commented examples. Invalid optional configuration disables only this feature. `AI_GATEWAY_BASE_URL` remains the existing fixed trusted HTTP(S) origin setting.

| Setting | Default | Bounds / behavior |
| --- | --- | --- |
| `EMBEDDINGGEMMA2_ENABLED` | `true` | Set `false` to disable; absent/empty means enabled |
| `EMBEDDINGGEMMA2_TIMEOUT_MS` | `1800000` | 1800000–3600000 |
| `EMBEDDINGGEMMA2_USER_ITEMS` | `200` | 1–2000 |
| `EMBEDDINGGEMMA2_GLOBAL_ITEMS` | `500` | 1–5000 |
| `EMBEDDINGGEMMA2_USER_BYTES` | `268435456` | 8388608–4294967296 |
| `EMBEDDINGGEMMA2_GLOBAL_BYTES` | `536870912` | 8388608–8589934592 |

## Security contract

- Feature/zone: isolated EmbeddingGemma2 experiment, logged-in only.
- Interactive principals: admin bundle only; no machine principals or per-user grants.
- Capability: `embeddinggemma2.pilot.manage`, assigned only to the admin bundle using shared capability middleware. Object scope: owner (validated principal `_id`); no administrator override.
- Classification: private test content. No app content integration, imports, RAG, queues, existing embedding collections, or analytics.
- All mutations (including search) require shared session CSRF header and POST/DELETE. Authorization precedes parsers and file access.
- Limits: one globally leased operation, 6 mutation requests/minute/owner, 8 MiB/file, 64 KiB text JSON, 16,000 text characters, 256 title characters, one file, bounded fields/parts, 30s upload. Fixed model identity, 768 finite nonzero normalized floats. Defaults: 200 records/owner, 500 global, 256 MiB/owner, 512 MiB global; top K 1–50, complete cursor scan capped at configured global capacity (fail explicitly if exceeded), batch 32.
- Output: escaped Pug/textContent; private authorized media with nosniff, sandbox CSP, no-store, opaque paths and range support. Files outside public; symlinks forbidden.
- Outbound: only configured trusted AI Gateway origin, fixed paths, no redirects or user URLs; no application secrets forwarded. Existing `AI_GATEWAY_BASE_URL` connection convention has no inference token. Reverse-proxy authentication must be provided by the same trusted network boundary as existing Site Gateway clients; do not use the Gateway admin token for inference.
- Diagnostics: shared logger, stable messages, status/error class and allowlisted permission/storage error codes only, no bodies, filenames, text, vectors, or provider diagnostics.
- Retention: until owner deletion; query uploads remain only in bounded request memory, never written to disk or inserted. Failed/pending ingests and interrupted deletes are reconciled under the feature lease on the next operation.
- Negative tests: unauthorized/role/owner/CSRF, strict contract/space, file/path/limits, cleanup, capacity/ranking and generic errors.
- Migration: none. Lazy model/index initialization on the existing primary managed connection; feature errors stay local. No automatic migration or cleanup of earlier experimental storage.

## Authoritative Gateway contract

On 2026-10-13 this workspace successfully fetched (HTTP success, `curl --fail` exit 0)
[the live Gateway usage document](http://192.168.0.20:8080/documentation/embeddinggemma2-gateway-usage.md).
The follow-up re-fetched this document and the static `/embed/embeddinggemma2/info` and `/openapi.json` via safe GET. No inference, worker health, container start, discovery mutation, or GPU request was made. Exact response fields were also inspected read-only in [`embeddinggemma2/media.py`](https://github.com/lentmiien/ai-gateway/blob/b5df9d2cd58a2551b63eabfabb7f031ec0b0f355/embeddinggemma2/media.py) and `app.py` at the operator-supplied release. OpenAPI alone has an untyped response and is insufficient to invent metadata fields.
The deployed Gateway release supplied by the operator is `b5df9d2cd58a2551b63eabfabb7f031ec0b0f355`.

- Model: `google/embeddinggemma-2`; revision `914f7f89142e33e77833254d9c9b90c3cef7303b`.
- Exact space: `google/embeddinggemma-2@914f7f89142e33e77833254d9c9b90c3cef7303b:768:l2:pilot-v1`.
- Text: `POST /embed/embeddinggemma2`, `{dimensions:768,items:[{text,role,title?}]}`. Site sends one raw document/query item, never `texts`; title only on stored text documents. Gateway applies prefixes, rejects overflow rather than truncating, context maximum 8,192 expanded tokens. Site JSON cap includes escaped text overhead.
- Media: `POST /embed/embeddinggemma2/media?kind=image|audio|video&dimensions=768`, one original file as `application/octet-stream`. No multipart to Gateway, filenames, URLs, base64, OCR/transcript substitution or direct worker calls.
- Outputs: exactly one vector and parallel chunk, both item indexes zero; exact model/revision/space/dimensions/normalization/preprocessing version are checked. L2 norm must be within 0.02 of one, then normalized precisely in Site. Float32 and BF16 are accepted as declared compatible by the Gateway; no quality guarantee.
- Images: PNG/JPEG/WebP, one frame/page, ≤4,000,000 pixels and edge ≤4,096. A generic application/octet-stream upload declaration is accepted only when extension, magic bytes and decoding independently validate the actual safe format. Originals preserved; server fully decodes via Sharp before serving the original in a constrained native image context. They are not re-encoded because original-source preservation is part of this experiment.
- Audio: WAV/MP3/FLAC/Ogg/Opus, or first audio stream of MP4/MOV/MKV/WebM/M4A/MKA. ≤10s. Gateway decodes mono 16kHz float32 with overflow sentinel. Site requires `duration_seconds` in (0,10], `samples` 160–160000 matching duration, `sampling_rate:16000`, and `channels:1`. Site does not independently verify duration.
- Video: MP4/MOV/MKV/WebM, first video stream, ≤8s, ≤2,073,600 source pixels, edge ≤2,048, ≤4 streams. Gateway’s 1 fps sentinel rejects >8 frames. Gateway samples visual frames, reduces long edge to 768, ignores rotation metadata and soundtrack. No automatic segmentation.
- Site never invokes FFmpeg, ffprobe, prlimit or any media subprocess on any platform. Site validates ≤8 MiB, signature/extension/allowlisted MIME agreement and bounded container structure, then forwards raw bytes only to the fixed Gateway. Sharp remains the local image decoder with pixel/page/edge bounds and a 20-second processing timeout. MIME is never the sole evidence, including `application/octet-stream` uploads. Ambiguous/truncated signatures, unknown BMFF major brands, untyped EBML, ID3 without two Layer III frames, unsupported Ogg codecs and mismatched container extensions are rejected. Accepted MP4 major brands are isom/iso2/mp41/mp42/avc1/M4V; M4A requires its M4A brand, MOV its `qt  ` brand, and WebM/Matroska require the matching EBML DocType. This deliberately rejects some otherwise decodable files. BMFF box inspection is depth/count/byte bounded and rejects reference movies and non-self-contained data references before originals can be served.
- Gateway alone enforces audio/video decoder/process/time/memory limits, all source video dimensions and stream counts, duration/overflow sentinels, and expanded token budget. Its decoder allowlists exclude playlists/network protocols and external MOV data references. Invalid media can consume queue/job time before rejection. Site keeps one operation lease, the byte/upload limits and uncertainty cooldown; it does not retry automatically or save anything on a rejected/incompatible response.
- Site requires exact `batch_size:1`, `truncation:false`, `text_prefixes:"role-specific; text only"` and `tokens` 1–8192 for every modality, in addition to identity/vector/mapping checks. Image mapping requires width/height within image limits, `exif_orientation_applied:true`, `vision_soft_tokens_max:280`. Video requires duration ≤8, frames 1–8, decoded width/height ≤768, `sample_fps:1`, exact `[0,...,frames-1]` sample grid, the source's literal `sampling` policy, `rotation_applied:false`, `soundtrack:"ignored"`, `vision_soft_tokens_per_frame_max:140`, `processor_resampling:false`, `model_timestamp_tokens:false`. Audio fields are listed above. Only these allowlisted metadata fields are retained; missing/wrong metadata is a 502 with no persistence and a retained uncertainty lease. The current contract does **not** return source video dimensions or stream counts: do not claim independent Site verification of those. A future requirement to audit those values needs a Gateway contract enhancement first.

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

Search applies entry record type + owner + exact identity + ready state + optional modality before scanning **every** eligible record in cursor batches of 32. Only top K records remain in memory; no newest-N approximation, no vector engine. A corrupt vector fails visibly. Raw dataset counts and search coverage/exclusions are visible. An empty eligible corpus returns an empty search without Gateway inference/decoding; that result is not proof that audio/video passed decoder limits. Text is rendered with escaped Pug or DOM textContent, including script-like test strings.

### Recovery and retention

Ingest performs inference before creating a durable `pending` record; then writes/fsyncs its private file and marks it ready. On write/commit failure it removes file and record; if cleanup is unavailable the intent remains for reconciliation. No file exists before its DB intent, avoiding untracked persistent files. Delete marks `deleting`, removes file, then deletes record; missing file is idempotent. A crash leaves a recoverable pending/deleting row. The next admitted mutation reconciles incomplete rows and any staging remnants after the previous lease expires, with bounded cursors and actionable recovery logs. Recovery is feature-internal cleanup, not an admin read override.

Query bytes are held in bounded request memory and cleared in the route’s `finally`; no new query staging files are created. Any staging remnants inside this test folder are cleaned on the next admitted operation; old storage locations are never traversed. There is deliberately no new background worker. Unexpected paths or unsafe links fail closed and require operator investigation; recovery never recursively deletes arbitrary content. A successful query is never inserted. Stored records remain until explicitly deleted; disable preserves them. No bulk-clear endpoint exists.

## Development verification

```bash
npm test -- tests/unit/embeddingGemma2 --coverage=false --runInBand
npm test -- --runInBand
```

Tests use synthetic media, mocked database/Gateway calls and local HTTP test servers. Windows path and filesystem tests simulate Win32 on Linux; they are not native Windows acceptance. Coverage includes one-collection entry/control separation, indexes, counts/ranking, durable leases, owner isolation, default startup, lazy private storage, gitignore, memory-only queries, all four modalities, CSRF, response validation, cleanup and private range delivery. Exact results and release SHAs are in the release handoff.

Release verification (2026-10-14): focused **6 suites / 133 tests passed**; full **385 suites / 4,991 tests passed**, with **8 suites / 117 tests skipped**. Configured coverage thresholds passed (71.78% statements, 50% branches, 80.79% functions, 72.64% lines). JavaScript syntax checks, Pug rendering/shared theme, navigation JSON and `git diff --check` passed. Existing VM Modules/router deprecation warnings appeared. Tested on Linux with Node 24.12.0/npm 11.17.0; production's Node 24.20.0 and native Windows remain live acceptance checks. No dependency changes, deployment, live database changes or inference were performed.
