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
- Retention: until owner deletion; query uploads remain only in bounded request memory, never written to disk or inserted. Failed/pending ingests and interrupted deletes are reconciled under the feature lease on the next operation.
- Negative tests: unauthorized/role/owner/CSRF, strict contract/space, file/path/limits, cleanup, capacity/ranking and generic errors.
- Migration: none. Lazy separate `useDb` on the existing managed connection; feature errors stay local. No production provisioning by development session.

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

## Configuration and isolated storage

All keys are in `env_sample`. No dependency changes are required. Runtime needs only the pinned Node from `package.json`, existing Sharp and access to the trusted Gateway. No added dependency or host media binary is required.

| Variable | Default | Accepted bounds |
| --- | --- | --- |
| `EMBEDDINGGEMMA2_ENABLED` | `false` | literal `true` or `false` |
| `EMBEDDINGGEMMA2_DB_NAME` | `embeddinggemma2_pilot` | exact default or prefix plus `_` and 1–32 lowercase letters/digits/underscores |
| `EMBEDDINGGEMMA2_STORAGE_DIR` | POSIX: `<checkout>/private_data/embeddinggemma2`; Windows: explicit setting required when enabled | dedicated stable local absolute directory, no symlinks/junctions, outside public and its ancestors; pre-create with protected ACL on Windows |
| `EMBEDDINGGEMMA2_TIMEOUT_MS` | `1800000` | 1800000–3600000 |
| `EMBEDDINGGEMMA2_USER_ITEMS` | `200` | 1–2000 |
| `EMBEDDINGGEMMA2_GLOBAL_ITEMS` | `500` | 1–5000 |
| `EMBEDDINGGEMMA2_USER_BYTES` | `268435456` | 8388608–4294967296 |
| `EMBEDDINGGEMMA2_GLOBAL_BYTES` | `536870912` | 8388608–8589934592 |
| Existing `AI_GATEWAY_BASE_URL` | `http://192.168.0.20:8080` | operator-controlled HTTP(S) origin only; no path, credentials, query or fragment |

Byte capacities account for original content (UTF-8 text/title or file bytes). Mongo vectors, indexes and metadata add overhead, bounded separately by record count. Global limits also apply when per-owner limits are higher. Lowering limits below existing usage blocks adds; lowering global record limits below usage blocks searches explicitly instead of silently skipping old records. Owner lists remain paginated, and delete remains available.

`connection.useDb(name, {useCache:true})` reuses the already authenticated managed Mongoose client and therefore **preserves its original authSource, credentials, TLS, topology and reconnection lifecycle**. No second URI, new global connection, primary database change, automatic migration or existing vector model is used. A database name equal to the primary connection name is rejected. Models/indexes are lazy, with failure returning feature-local 503 and payload-free application logs. The page itself requires no pilot DB operation; its dataset request reports unavailable storage.

Collections are exclusively `eg2_records` and `eg2_control` in the dedicated database. `eg2_records` stores owner ObjectId, state, modality, original text/title OR opaque private asset name/canonical MIME/sanitized display filename, original byte count, capture date, vector, model/revision/space/dimensions/normalization/precision, preprocessing metadata/version and chunk mapping. Index `eg2_owner_space` covers owner/state/space/dimensions/date; normal `_id` indexes also exist. `eg2_control` contains a single operation lease, with a random fencing token and expiry. It contains no query content. The generic Site DB viewer remains on the primary database; no private pilot collections are registered there.

Files have opaque 48-hex server-generated names; original filenames are display-only. On POSIX, new files/directories request 0600/0700. On Windows those mode bits do **not** establish privacy: a pre-created protected NTFS root and trusted ancestors are mandatory (SYSTEM + Administrators only for the verified LocalSystem service). No chmod/UID equivalence is claimed; see the [Node filesystem platform caveats](https://nodejs.org/docs/latest-v24.x/api/fs.html#fschmodpath-mode-callback). Windows configuration rejects UNC/device namespaces, drive-relative paths, ADS, reserved names, trailing dots/spaces, short-name aliases and traversal; containment is drive/component/case aware. Never use a public root, another feature's root, a release junction or the same root for different pilot DB names.

Every filesystem access rechecks ancestors with lstat, root realpath and pinned root identity. Files must be regular, single-link and bounded; reads open read-only and compare pre/post lstat/realpath and handle device/inode/size. Writes are exclusive and fsynced, then verified. Windows omits O_NOFOLLOW; platforms that report EINVAL/ENOTSUP/EOPNOTSUPP retry without it, retaining all verification and logging a payload-free warning. Other open failures do not trigger fallback. Deletion verifies a read handle, closes it for Windows, rechecks identity, then unlinks; sharing failures preserve the DB deletion intent for reconciliation. Query bytes are memory-only. Old staging is recovered only if present, with a maximum of eight opaque files and no recursive deletion.

These checks reject symlinks/junctions exposed by Node and realpath redirects; they are **not** exhaustive Windows reparse-tag protection or an atomic openat/unlinkat sandbox. Checks and unlink have race windows; the effective ACL/ancestor trust assumption prevents untrusted local replacement. Local administrators/SYSTEM and compromised service code are outside this protection boundary. An operator must inspect effective ACLs and reparse points; Node cannot prove them. Back up this database and dedicated root together if test data matters.

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

Search applies owner + exact identity + ready state + optional modality before scanning **every** eligible record in cursor batches of 32. Only top K records remain in memory; no newest-N approximation, no vector engine. A corrupt vector fails visibly. Raw dataset counts and search coverage/exclusions are visible. An empty eligible corpus returns an empty search without Gateway inference/decoding; that result is not proof that audio/video passed decoder limits. Text is rendered with escaped Pug or DOM textContent, including script-like test strings.

### Recovery and retention

Ingest performs inference before creating a durable `pending` record; then writes/fsyncs its private file and marks it ready. On write/commit failure it removes file and record; if cleanup is unavailable the intent remains for reconciliation. No file exists before its DB intent, avoiding untracked persistent files. Delete marks `deleting`, removes file, then deletes record; missing file is idempotent. A crash leaves a recoverable pending/deleting row. The next admitted mutation reconciles incomplete rows and orphaned query staging after the previous lease expires, with bounded cursors and actionable recovery logs. Recovery is feature-internal cleanup, not an admin read override.

Query bytes are held in bounded request memory and cleared in the route’s `finally`; no new query staging files are created. Legacy staging from the initial implementation, if any, is cleaned on the next admitted operation. There is deliberately no new background worker. Unexpected paths or unsafe links fail closed and require operator investigation; recovery never recursively deletes arbitrary content. A successful query is never inserted. Stored records remain until explicitly deleted; disable preserves them. No bulk-clear endpoint exists.

## Human deployment handoff — native Windows / WinSW

**Preparation only: no production install, deployment, restart, DB provisioning or inference was performed.** Operator-supplied read-only evidence identifies native Windows x64 build 26300.9550, checkout `C:\Projects\lentmiien-site`, clean `main` at `571350cc1d0334159acbf73d38fc61aa4d3fff0f`, Node 24.20.0/npm 12.1.0. WinSW 2.12.0 service **LennartWeb**, running as **LocalSystem**, uses `C:\Services\LennartWeb\LennartWeb.xml`, executable `C:\Program Files\nodejs\node.exe`, argument `C:\Projects\lentmiien-site\app.js`, working directory the checkout. Keep that single-process setup. There is no Linux UID, WSL, local FFmpeg/ffprobe/prlimit, or new Node dependency requirement.

1. Review the complete release on the development branch. In production PowerShell, replace `RELEASE_SHA` with the exact pushed SHA in the handoff; these commands deliberately stop on a changed base or dirty checkout. **Fast-forward the complete history, including initial `702f710dec78655f1231792273137cfc77083833`; do not cherry-pick only the follow-up.** If production has moved, reconcile deliberately without reset/clean/force/stashing unrelated work.

   ```powershell
   Set-Location 'C:\Projects\lentmiien-site'
   $release = 'RELEASE_SHA'
   if ((git branch --show-current) -ne 'main') { throw 'Unexpected branch' }
   if (git status --porcelain) { throw 'Preserve and reconcile dirty work first' }
   if ((git rev-parse HEAD) -ne '571350cc1d0334159acbf73d38fc61aa4d3fff0f') { throw 'Production base changed' }
   git fetch origin feat/admin-embeddinggemma2-pilot
   if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
   if ((git rev-parse origin/feat/admin-embeddinggemma2-pilot) -ne $release) { throw 'Release SHA mismatch' }
   git merge-base --is-ancestor HEAD $release
   if ($LASTEXITCODE -ne 0) { throw 'Not a fast-forward' }
   git merge-base --is-ancestor 702f710dec78655f1231792273137cfc77083833 $release
   if ($LASTEXITCODE -ne 0) { throw 'Initial pilot missing' }
   git log --oneline HEAD..$release
   git diff --stat HEAD $release
   # Review the full diff before this human deployment action.
   git merge --ff-only $release
   if ($LASTEXITCODE -ne 0) { throw 'Fast-forward failed' }
   git rev-parse HEAD
   ```

2. Prepare **a new dedicated local NTFS root**, e.g. `C:\ProgramData\Lentmiien-embeddinggemma2`. This single dedicated directory avoids changing any existing `private_data` or shared application parent. Elevated PowerShell, human only, while the pilot is disabled:

   ```powershell
   $pilotRoot = 'C:\ProgramData\Lentmiien-embeddinggemma2'
   foreach ($ancestor in @('C:\', 'C:\ProgramData')) {
     $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
     if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe ancestor' }
     Get-Acl -LiteralPath $ancestor | Format-List Owner,AccessToString
   }
   # Review ancestor ACLs: untrusted principals must not replace/redirect this root
   # (including via DeleteSubdirectoriesAndFiles). Stop if that assumption fails.
   if (Test-Path -LiteralPath $pilotRoot) {
     Get-Item -LiteralPath $pilotRoot -Force | Format-List FullName,Attributes,LinkType,Target
     Get-Acl -LiteralPath $pilotRoot | Format-List Owner,AreAccessRulesProtected,AccessToString
     icacls $pilotRoot
     throw 'Existing directory: inspect contents, ACLs and reparse points; do not overwrite or rewrite ACLs'
   }
   New-Item -ItemType Directory -Path $pilotRoot -ErrorAction Stop | Out-Null
   # Only this NEW EMPTY pilot root. No /T, /reset or recursive ACL rewrite.
   icacls $pilotRoot /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
   if ($LASTEXITCODE -ne 0) { throw 'Grant failed; leave pilot disabled' }
   icacls $pilotRoot /inheritancelevel:r
   if ($LASTEXITCODE -ne 0) { throw 'Protection failed; leave pilot disabled' }
   icacls $pilotRoot /setowner '*S-1-5-32-544'
   if ($LASTEXITCODE -ne 0) { throw 'Owner change failed; leave pilot disabled' }
   $item = Get-Item -LiteralPath $pilotRoot -Force -ErrorAction Stop
   if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point rejected' }
   $acl = Get-Acl -LiteralPath $pilotRoot
   if (!$acl.AreAccessRulesProtected) { throw 'Inheritance remains enabled' }
   $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
   if ($rules.Count -ne 2 -or @($rules.IdentityReference.Value | Sort-Object -Unique).Count -ne 2) { throw 'Unexpected ACL entries; inspect manually' }
   if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') { throw 'Unexpected owner' }
   foreach ($rule in $rules) {
     if ($rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544') -or
         $rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or
         $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
         $rule.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit)) {
       throw 'Unexpected ACL rule; leave pilot disabled'
     }
   }
   icacls $pilotRoot /verify
   if ($LASTEXITCODE -ne 0) { throw 'ACL verification failed' }
   icacls $pilotRoot
   ```

   The [Microsoft icacls reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls) documents numeric SID syntax and inheritance removal. SYSTEM and Administrators SIDs are locale-independent. Verify both distinct SIDs are present, ownership is Administrators, and child files inherit only these grants during acceptance. `icacls /verify` checks ACL consistency, **not** effective access or all reparse tags. Use Windows Advanced Security → Effective Access to inspect representative nonadmin principals and the service identity; check the volume/ancestors too. If the directory already exists, inspect it without recursive traversal through reparse points. Use a different new dedicated root or a separately reviewed repair; never apply these grant/removal commands to existing assets. Do not use a release junction, UNC share, drive-relative path, or a root writable by other local users.

3. Have the DBA apply the two-collection role above to the **existing** Site principal/authentication database. Preserve the primary `MONGOOSE_URL` including database and `authSource`, and preserve `SESSION_SECRET`. Edit only the pilot settings in the existing environment source: checkout `.env` and any overriding WinSW `<env>` entries. Do not overwrite either source or print its secrets. Ensure WinSW and `.env` do not disagree.

   ```dotenv
   EMBEDDINGGEMMA2_ENABLED=true
   EMBEDDINGGEMMA2_DB_NAME=embeddinggemma2_pilot
   EMBEDDINGGEMMA2_STORAGE_DIR=C:\ProgramData\Lentmiien-embeddinggemma2
   EMBEDDINGGEMMA2_TIMEOUT_MS=1800000
   EMBEDDINGGEMMA2_USER_ITEMS=200
   EMBEDDINGGEMMA2_GLOBAL_ITEMS=500
   EMBEDDINGGEMMA2_USER_BYTES=268435456
   EMBEDDINGGEMMA2_GLOBAL_BYTES=536870912
   AI_GATEWAY_BASE_URL=http://192.168.0.20:8080
   ```

   In WinSW XML the path is the same literal backslash string. On Windows enabling without an explicit root fails closed; the root must already exist. Existing Sharp must load under the service's Node installation (the version matches the repository pin). No dependency/lockfile change is included, and no package install is part of this handoff.

4. Confirm browser ingress supports the pilot's **1,920-second / 32-minute** response budget (30-minute Gateway client timeout plus 120 seconds); retain short upload/header budgets. Apply any controllable deadline only to the pilot path. Production uses a declared Cloudflare Tunnel, but its active hard request deadline is **unverified** and cannot be overridden by a Site timeout. If too short, use an explicitly authorized authenticated LAN/VPN Site path with equivalent session/CSRF/TLS policy; if none exists, arrange one separately before acceptance. Do not expose Gateway or Site through a new unauthenticated public bypass, weaken Access/WAF globally, or assume a particular Windows reverse proxy exists. Disable caching for `/admin/embeddinggemma2*`.

   The client sends **no inference credential**. The configured fixed Gateway origin must be protected by the trusted network/reverse-proxy boundary. If it requires an authentication header the current client does not implement, stop and arrange a reviewed integration; do not use its admin token or remove authentication. Only the Gateway's model loading is offline; this Site feature requires network access to that Gateway.

5. After active Site/Gateway work drains, **Lennart only**, elevated PowerShell:

   ```powershell
   Restart-Service -Name 'LennartWeb' -ErrorAction Stop
   Get-Service -Name 'LennartWeb'
   Set-Location 'C:\Projects\lentmiien-site'
   git rev-parse HEAD
   ```

   Do not launch a second `node app`, run `npm start` (mutating prestart), change the WinSW identity, or restart/install anything on Gateway. Check payload-free application logs and the normal Site pages before the pilot tests.

### Synthetic fixtures without production FFmpeg

Generate public synthetic text, a 64×64 red PNG and a one-second 440 Hz PCM WAV using existing Node/Sharp only. A 10.1-second WAV is also produced solely for a **human-approved negative Gateway test** (it intentionally passes Site signatures and must be rejected by Gateway). Use a new directory outside the private asset root:

```powershell
Set-Location 'C:\Projects\lentmiien-site'
node scripts/embeddinggemma2-fixtures.js "$env:TEMP\eg2-public-fixtures"
Get-ChildItem -LiteralPath "$env:TEMP\eg2-public-fixtures" | Select-Object Name,Length
```

On a developer machine, the same command works with a new absolute POSIX directory. The script refuses an existing directory and does not overwrite files. To produce the visual clip, use a separate Linux **fixture workstation** already equipped with FFmpeg, then copy **only the generated test MP4** into that fixture folder. No executable, model, service, or production FFmpeg installation is needed:

```bash
ffmpeg -nostdin -v error -f lavfi -i 'color=c=red:s=64x64:r=4:d=1' -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart public-safe.mp4
wc -c public-safe.mp4
sha256sum public-safe.mp4
```

This creates a synthetic one-second red visual clip, no third-party media. Retain the generation command, workstation FFmpeg version, byte count (<8 MiB) and SHA-256 with acceptance notes. On Windows use `Get-FileHash -Algorithm SHA256` to verify the copied file. No binary fixture/license addition is needed. The test suite uses in-memory structural container fixtures, **not** a pretend decodable MP4.

### Browser acceptance — Lennart after release

Use only deliberate public/synthetic test content. Record deployed Site SHA, browser/origin, Gateway release SHA, timestamps and outcomes; redact cookies and tokens.

1. Log in as admin, open Tools → Administration → AI Admin → EmbeddingGemma2 playground, or `/admin/embeddinggemma2`. Verify dark theme, accessible labels, initial zero/count state, no analytics and no Gateway inference on load. Check lazy DB indexes/permissions and effective private directory/file ACLs under LocalSystem; confirm no junction/reparse redirection. Exercise original read/range/delete and Windows sharing failures without deleting unrelated files. A disabled or unavailable feature must leave other Site pages working.
2. Add **all four**: a short titled text describing a red square; a PNG/JPEG/WebP red square; a ≤10s audio clip; a ≤8s MP4/WebM visual clip. Wait for each cold request; verify spinner, disabled buttons, original previews, titles/filenames, counts, provenance and exact space. Video's audio is deliberately ignored. No existing Site collection/content should change.
3. Query **all four modalities against the same mixed corpus**, default all modalities, without clearing records between tests. Verify complete scanned/eligible coverage and descending cosine scores; compare intuitive cross-modal matches without treating scores as probabilities or expecting perfect quality. Try top K and explicit modality filter. Query uploads must not change counts or create disk files; confirm on success and Gateway rejection.
4. Play and seek stored audio/video; inspect 206/Content-Range, image originals, private/no-store/nosniff headers. Unsupported browser codecs may need original download/local playback. Check source text including a harmless `<script>` string remains inert.
5. Delete a text and a media record with confirmation. Refresh and verify both disappear, original media returns 404, and the corresponding private asset is gone. Confirm other records remain.
6. Log in as another admin: dataset/list/search/media/delete must not expose the first admin's records. As `user`, `family`, and logged out, directly request page/list/add/search/delete/media URLs: 403/401, including copied media URLs. Missing/invalid CSRF or a foreign Origin must reject mutations before inference.
7. Reject >8 MiB, wrong extension/MIME/signature, SVG, animated images, long audio/video, excessive dimensions and prefixed/query-titled text. Check application diagnostics contain no payloads. Test admission/double-submit in two tabs without repeatedly submitting GPU jobs. Exercise account/session revocation while a deliberately approved test request waits.
8. If a cold request exceeds proxy limits or loses its response, do not immediately retry. Check Gateway monitoring, wait for reclaim/lease expiry, refresh records, and confirm there was no unintended duplicate. No automated live smoke was performed by this release.

### Rollback / disable

Set `EMBEDDINGGEMMA2_ENABLED=false` in the existing environment source and restart only the Site with elevated PowerShell `Restart-Service -Name 'LennartWeb'` (Lennart only) after active work finishes. The link may remain visible to admins, but every feature route returns disabled without DB or Gateway work. Data remains isolated for later review. If code rollback is needed, review/revert both pilot commits together (or use the recorded pre-release artifact); do not leave the Linux-only initial version enabled. Disabling alone is sufficient; no downgrade/migration of existing app vectors is necessary. Do not delete the directory/database or revoke credentials as part of ordinary rollback. If permanent removal is requested later, a human should stop feature traffic, back up if needed, then explicitly remove only the named pilot DB and dedicated media directory after checking realpaths.

## Development verification and provenance

Focused command:

```bash
npm test -- tests/unit/embeddingGemma2Contract.test.js tests/unit/embeddingGemma2Files.test.js tests/unit/embeddingGemma2Service.test.js tests/unit/embeddingGemma2Routes.test.js tests/unit/embeddingGemma2Windows.test.js --coverage=false --runInBand
```

Tests use mocked Gateway/DB operations, local HTTP test servers and synthetic media generated in Node/Sharp; no host media binaries. The Windows tests simulate path/flag/IO semantics on Linux, not native Windows execution. If running the filesystem tests on native Windows, file-symlink tests require Developer Mode or an appropriately privileged developer test account; do not loosen production root ACLs to run tests. They cover role/CSRF/owner boundaries, exact request/response identity, dimension/zero/nonfinite guards, private storage/symlinks/traversal, Gateway duration/frame/token metadata and local image/byte bounds, memory-only queries, cosine ordering/coverage/filters/capacity, rollback/recovery, lease admission, privacy and range playback. There was no connection to a live Mongo database or inference endpoint. Full-suite results and exact commit/push status are recorded in the release handoff.

Production platform evidence supplied for this correction: [native Windows read-only inspection](/codex/sessions/tool-session-a2982fe123ed9e11db747fe5eb48cb84349059cbd8c32dd306f78307289c264f), [platform blocker follow-up](/codex/sessions/tool-session-84ff6c681293395e76cd2c97293eb0122f9fc35d433f081f96e62dc1415cf635). This session used the supplied evidence, without connecting to production.

Related persisted context: [Gateway deployment session](/codex/sessions/tool-session-a41490a70e51cf8cc940e342cf935b83a66564444ff86d3d859496970bb17fc1), [prior Site read-only inspection](/codex/sessions/tool-session-8a3b23bc7b0b5ed82e06ca8bbf29148436f583c762f68288486a0b8211ccff1e). These are supplied coordinator session links; this session did not fetch their contents.

Historical initial-commit verification recorded 2026-10-13: the full Jest run passed 383 suites / 4,904 tests with 8 suites / 117 tests skipped; configured coverage thresholds passed (71.78% statements, 50% branches, 80.79% functions, 72.64% lines). The final focused run passed 4 suites / 52 tests after additional review hardening. No known failing suite was observed. Existing VM Modules / router Promise-like-handler warnings appeared in the broader run. JavaScript syntax checks, Pug compilation/render tests and `git diff --check` passed. Real Mongo permissions/behavior, live Gateway inference, production proxy timing and browser playback remain human acceptance items.

Follow-up tests ran on Linux with Node 24.12.0/npm 11.17.0 available in this workspace (no installs were performed); production and the repository pin are Node 24.20.0. Windows actual execution **NOT RUN**. No live Mongo, browser playback, Windows ACL enforcement or live inference was exercised in this development session. Read-only Gateway contract checks are not inference acceptance. See the exact follow-up counts and SHA in the handoff; all native Windows and API/proxy timing checks remain human acceptance work.

Final follow-up verification (2026-10-13): focused `npm test -- tests/unit/embeddingGemma2 --coverage=false --runInBand` passed **5 suites / 120 tests**. Full `npm test -- --runInBand` passed **384 suites / 4,978 tests**, with **8 suites / 117 tests skipped**; configured coverage thresholds passed (71.78% statements, 50% branches, 80.79% functions, 72.64% lines). Existing VM Modules and router Promise-like-handler warnings appeared. JavaScript syntax checks, Pug render tests, and `git diff --check` passed. Package manifests/lockfile are unchanged. Source/test/security/doc self-review is complete; this is preparation evidence, not Windows production acceptance.
