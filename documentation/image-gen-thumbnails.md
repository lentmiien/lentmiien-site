# ComfyUI input and saved-gallery thumbnails

Workflow image cards and saved/pinned gallery cards use separate still-image previews. **Open** always targets the existing full-size URL. Audio, video, PDF, and text input previews retain their existing behavior. Failed, unauthorized, missing, unsupported, or corrupt thumbnails display “Preview unavailable”; there is no automatic original-image fallback.

## Endpoint contracts

| Site GET/HEAD endpoint | Source | Successful representation |
| --- | --- | --- |
| `/image_gen/api/files/input/thumbnail?path=<relative input path>` | Configured Gateway `GET /comfy/input/thumbnail?path=...` | Still WebP, within 512×512 |
| `/image_gen/api/good-images/:id/thumbnail` | The persisted GoodImage record's `filename` in local `public/img` | Still WebP, within 512×512 |

Gallery metadata adds `thumbnail_url` for ordinary and pinned records; existing `public_url`, `cached_url`, and `download_url` values are unchanged. There are no schema changes, migrations, backfills, startup conversions, or database writes for thumbnails. Listing records remains inexpensive. Files in `public/img` without a GoodImage record cannot be selected through the thumbnail endpoint.

The Gateway contract is fixed: identical relative paths and authentication to `/comfy/input/view`, orientation corrected, aspect ratio and transparency preserved, no enlargement, first animation frame, source-aware disk caching, ETag/Last-Modified revalidation, and non-2xx failures without original fallback. The site forwards `If-None-Match` and `If-Modified-Since`, accepts bodyless 304, forwards ETag/Last-Modified, and enforces `Cache-Control: private, no-cache`, WebP content type, inline disposition, and nosniff. It never forwards upstream cookies, redirects, public cache directives, or arbitrary disposition headers. Range is deliberately only used on the unchanged original `/image_gen/api/files/input/view` endpoint. Thumbnail query resizing options are rejected.

## Cache and work limits

`services/goodImageThumbnailService.js` exports `SETTINGS`. Production uses these fixed defaults (no new environment configuration):

- Cache: `<site>/cache/image-gen-thumbnails`, outside public static serving, created on demand. Directory mode 0700 and file mode 0600 for newly created entries. This expendable directory does not need a backup.
- Format version `v1`, maximum 512×512, WebP quality 80, auto-orientation, aspect/transparency retained, no enlargement, first frame only, metadata stripped.
- Supported local sources: PNG, JPEG, WebP, GIF, AVIF, TIFF; content must decode as an allowed raster format. SVG, PDFs, video, nonlocal URLs, unsafe names, directories, and symlinks are rejected. Legacy records without a supported durable local original show the placeholder.
- Maximum source size 100 MiB, decoded first-frame size 40 million pixels, derivative size 2 MiB, Sharp processing timeout 15 seconds. Reads use an inspected file descriptor and fixed-size buffer; source changes during conversion abort that request.
- Two concurrent cache operations/conversions, at most 32 queued operations, and in-flight coalescing for the same record/source in each process. Atomic writes use unique temporary files and rename. Multiple processes may duplicate work but cannot publish a partial file.
- Source identity includes record ID, filename, device/inode, byte size, nanosecond mtime and ctime, plus format version. Every request checks the local source before using a disk entry or returning 304. Overwriting the same filename invalidates its ETag, including same-size writes with restored mtime. ETags are the preferred validators; HTTP dates have only one-second precision.
- Cleanup runs lazily on requests, at most once per hour. Seven-day retention by creation/modification age, newest 4096 entries and 512 MiB targets; these are soft limits between cleanup passes. Old source versions and abandoned temporary files expire in this same namespace. No scan/conversion of public originals occurs. An idle site's expendable cache remains until another request or operator removal.
- Both endpoints share a 240-request/minute/principal limit and 32 simultaneous HTTP request limit per process. Saturation returns 429/503 and the UI placeholder. Input proxies enforce 2 MiB and a 30-second total deadline, in addition to existing Gateway header/idle timeouts and cancellation on disconnect. Gateway retains responsibility for its own conversion bounds/cache.

The application process needs read access to durable originals and write access to the private cache. Existing `COMFY_API_BASE`, `COMFY_API_KEY`, `COMFY_STREAM_HEADER_TIMEOUT_MS`, and `COMFY_STREAM_IDLE_TIMEOUT_MS` settings continue to apply. Node 24.20.0 and the already-installed Sharp dependency are used; dependencies are unchanged.

## Security contract and route registry

- **Zone/principals:** logged-in application sessions only; no machine principal or public access added. The existing app mount still requires the legacy `image_gen` feature grant. In addition, `utils/imageGenThumbnailPolicy.js` declares the new routes and semantic capabilities; `routes/image_gen.js` registers them ahead of the legacy wildcard file route through shared `requireCapabilities`/`authorization` controls.
- **Capabilities/assignments:** `comfy.inputs.read` and `comfy.gallery.read`. Admin receives both as an explicit capability bundle. Family/user/custom roles receive neither automatically and may receive explicit per-user or group grants through RoleModel. Legacy `image_gen` alone does not confer these new capabilities. Existing deployments used solely by admin need no grant changes. Access lookup errors fail closed.
- **Object scope:** explicitly admin-managed libraries. Each capability authorizes reads across its respective entire library, including historical records; these records and Gateway paths have no trustworthy owner field. There is no inferred ownership or request-supplied principal. A gallery thumbnail must resolve an existing GoodImage ID before selecting its local original. Input paths are bounded relative paths within the configured Gateway's input library, with confinement additionally enforced by Gateway. Missing records and invalid/unsafe sources return generic unavailable responses. No public-directory enumeration endpoint is added.
- **Data/storage:** derivatives are private; legacy originals retain their existing exposure. No changes to static middleware or public source URLs. Source and cache roots require lexical/realpath containment; final source/cache reads use no-follow descriptors and regular-file checks.
- **Mutations/CSRF:** GET/HEAD only, no browser mutation API; the derived disk cache is an internal read optimization. No CSRF exemption or new mutation route.
- **Output:** DOM element creation/textContent, fixed same-origin thumbnail endpoints, HTTP(S)-only explicit Open links, no inline handlers. Existing Graphite/Ember/Golden Amber theme tokens are retained. The thumbnail endpoints render no analytics.
- **Outbound:** only the configured authenticated Gateway endpoint for inputs; redirects rejected. Saved gallery thumbnails never download from Gateway, cached URLs, or arbitrary URLs.
- **Cache/privacy:** every conditional request passes authentication, capability, and record/source checks. Private browser caches must revalidate; shared/Cloudflare caches must not cache these endpoints. No new Cloudflare bypass or rule change required.
- **Logging:** actionable Gateway failures and local decode/storage/cleanup failures use the shared logger; messages omit source paths, image contents, prompts, provider payloads, and credentials. Client disconnects are not operational failures. Thumbnail requests deliberately omit raw API debug payload logging.
- **Negative coverage:** anonymous, family/user/missing or wrong capability, explicit grants, nonexistent record, malformed IDs/paths, traversal, symlinks, unsupported/corrupt/missing/oversized sources, decode/concurrency limits, conditional headers/304, changed sources, failed writes, disconnects, unsafe upstream headers, chunked oversize responses, and UI fallback without original loading.

## Deployment and rollback

Deploy **Gateway first**, verifying its fixed `/comfy/input/thumbnail` contract, then deploy this site commit through the normal release process. An older Gateway will return a failed thumbnail and the UI placeholder; the site will never fall back to downloading the original automatically. Open and non-image previews remain usable. No live Gateway compatibility or production deployment is performed by the implementation tests, which use synthetic fixtures.

The site-local gallery cache works independently of the Gateway update. Non-admin feature users need the appropriate semantic read capability as well as their existing `image_gen` grant. No production data migration or eager backfill is required. Existing public originals are neither moved nor re-exposed.

Rollback the site release normally if necessary; the private derivative cache may be left in place or removed while the app is stopped. Source files and database records are unaffected. Future encoder changes should bump the format version to invalidate old derivatives.
