# Security Audit - 2026-08-28

## Executive summary

This was an extensive static security review and targeted hardening pass of the Express, Socket.IO, Pug, browser JavaScript, file/media, logging, dependency, and deployment surfaces of the application.

The application is materially safer after this pass. The most direct cross-site scripting, unsafe inline-JSON, static-media exposure, file-confinement, open-redirect, hidden-route privacy, dependency, and Socket.IO handshake problems found during the review were fixed. A cross-account authorization defect in legacy Chat1 was also fixed. The final dependency audit reports no known vulnerabilities, and the complete Jest suite passes.

The application should not yet treat an ordinary logged-in account as a strongly isolated security principal. The largest residual risks are:

1. Any authenticated account can use the Codex execution feature, including its workspace-write mode, and can access other users' Codex sessions and turns.
2. Chat4/Chat5/Chat5.5/Chat5.6 conversation IDs are not consistently checked against owners or members before read, write, room join, or administrative operations.
3. The broad `/api` bearer key has no capability scopes or fixed subject identity.
4. Admin-managed HTML in `public/html` is served directly as active, same-origin content, regardless of its database `isPublic` flag.
5. The application has no CSRF token or Origin-checking layer, and several destructive operations still use GET.
6. Some legacy chat, embedding, job, and media features use authentication without object-level ownership checks. In particular, generated images are mixed into the public `/img` namespace.

The current deployment has only two active accounts and both belong to the owner. That lowers the present likelihood of deliberate cross-account abuse, but it does not remove the impact of a stolen work-account session or a future family/user account. Severity therefore assumes that one non-admin session, API key, secret URL, or browser context can be compromised.

No large authorization migration was attempted in this pass. The report proposes an incremental migration that preserves the intended public, secret-public, and logged-in zones.

## Scope and limitations

### Reviewed

- Express middleware order, route mounts, authentication, route authorization, sessions, and error handling.
- Socket.IO authentication, room membership, event registration, and session lifetime behavior.
- Controllers and services handling chat, uploads, generated media, local files, Git repositories, webhooks, redirects, and external services.
- Pug output contexts, inline script data, Markdown/HTML rendering, and material browser-side DOM sinks.
- The public, secret-public, authenticated, role-restricted, static, media, API, and webhook surfaces.
- Production logging and privacy-sensitive diagnostic paths.
- Mongoose user/role definitions and representative object ownership patterns.
- Direct and transitive npm dependency advisories.
- Existing and newly added Jest tests relevant to the changes.
- A targeted scan of tracked source/configuration files for obvious credential patterns.

### Not reviewed or exercised

- `.env`, credential/token files, ignored generated data, personal media, database contents, or live account/role documents were not read.
- Git history was not exhaustively secret-scanned.
- The live Cloudflare dashboard, DNS, Access, WAF, cache, tunnel, and firewall settings were not available. The Cloudflare section is a configuration review checklist, not a statement of current settings.
- No active penetration testing was performed against the public site.
- The application was not started because importing `app.js` connects to MongoDB and starts schedulers/workers. `npm start` was also intentionally avoided because its prestart pipeline mutates data and performs synchronization.
- Third-party services were not called and webhook delivery was not simulated against production.
- A local/root attacker and a fully compromised host are outside this review's primary threat model.

This report is a point-in-time source review, not a guarantee that the application is free of vulnerabilities.

## Security-zone model

The intended model is sound, provided each zone is explicit and a secret URL is not mistaken for a logged-in identity.

| Zone | Intended audience | Current examples | Required baseline |
| --- | --- | --- | --- |
| Fully public | Anyone on the Internet | Home/login, blog, public cooking, games, exchange rates, YAML viewer, selected tools/test endpoints, signed webhooks, and genuinely public static assets | Strict input/output handling, conservative caching, abuse controls, no private data, no reliance on cookies |
| Secret public | Anyone possessing an unguessable URL | Public to-buy list, request counter, device usage, and minute logger | Treat URL as a bearer capability; no analytics/referrer leakage, no caching/indexing, rotation, rate limits, minimal disclosed data |
| Logged in | A valid application session, or the separately defined API principal | Personal tools mounted behind `isAuthenticated` | Capabilities plus object ownership; CSRF protection; revocable server-side sessions |

The source currently defines **four**, not approximately three, secret-public paths. Their values are intentionally not recorded in this report.

The logged-in zone currently has these role concepts:

| Layer | Current behavior | Intended direction |
| --- | --- | --- |
| `admin` | Direct `type_user === 'admin'` checks protect `/admin`, `/tmp-files`, and `/codex-log-review`; route permissions do not automatically make admin a superuser everywhere | Explicit administrator capability bundle, with global/break-glass behavior deliberately defined and tested |
| `family` | No distinct feature policy is currently in active use | A conservative shared-household bundle, for example cooking/shopping/shared status, without finance, private chat, Codex, or admin access by default |
| `user` | Group permissions and optional per-user role records; several newer tools require only authentication | A minimal personal-tool bundle plus explicit per-user grants |

Authentication, capability, and object ownership must remain separate questions:

1. Is this request public, secret-public, session-authenticated, or a service principal?
2. Does that principal have the semantic capability for this operation?
3. Does that principal own or belong to the specific object being accessed?

## Findings requiring follow-up

### F-01 - Critical - Codex execution and session data are available to every logged-in account

**Status:** Open. Highest remediation priority.

**Evidence**

- `app.js:545` mounts `/codex` behind authentication only.
- `routes/codex.js:21-57` restricts workspace/profile mutation and pricing to admin, but session creation, follow-up, read, archive, cancel, retry, events, queue, statistics, and template mutation are available to every logged-in account.
- `services/codexToolService.js:1637-1665` records `createdBy`, but `services/codexToolService.js:2034-2049` lists sessions without filtering it.
- `services/codexToolService.js:2280-2304` loads session details solely by ID.
- The seeded action permission is `workspace-write` (`services/codexToolService.js:931-956`).

**Impact**

A compromised non-admin account can enqueue an agent against a configured workspace, potentially read source/configuration visible to that process, modify workspace files, incur API cost, and view or manipulate another account's sessions and turns. This is more consequential than a normal route-level permission omission because it reaches an execution system.

**Recommendation**

As an immediate containment step, make the entire Codex feature admin-only unless the work account genuinely requires it. Then introduce separate capabilities such as:

- `codex.session.read_own`
- `codex.session.read_all`
- `codex.run.read_only`
- `codex.run.workspace_write`
- `codex.run.yolo`
- `codex.workspace.admin`
- `codex.pricing.admin`

All session/turn queries and mutations should include an owner condition unless the caller has an explicit `read_all`/`manage_all` capability. Workspace-write and yolo modes should require separate server-side capabilities; a client-supplied mode must never grant them.

### F-02 - High - Chat conversation IDs and Socket.IO rooms lack object authorization

**Status:** Open. The Socket.IO handshake was fixed, but conversation authorization was not redesigned in this pass.

**Evidence**

- The new handshake validates a real user and the `chat5` capability before registering Chat5 handlers.
- `socket_io/chat5_5/chat5_5handler.js:398-416` joins an arbitrary conversation room by supplied ID.
- `socket_io/chat5_5/chat5_5handler.js:439-498` reads a `Conversation5Model` by ID without checking `members`.
- `socket_io/chat5_5/chat5_5handler.js:1557-1603` updates arbitrary conversation settings, including members.
- `socket_io/chat5_6/chat5_6handler.js:227-235`, `:260-303`, and `:395-419` similarly join, fetch, and update by ID.
- Conversation service methods frequently use `findById`/unscoped mutation helpers, so checking only the initial room join would not be sufficient.

**Impact**

Any account with the Chat5 capability and a leaked/observed MongoDB object ID can read or modify another conversation and subscribe to future room broadcasts. Repeated arbitrary room joins can also create unnecessary adapter state.

**Recommendation**

Add a shared object guard that queries the conversation with the principal in the same predicate, for example `{ _id: conversationId, members: userName }`, with a defined legacy-owner rule for Conversation4. Apply it before every join, read, write, copy, delete, member update, generation, and broadcast-triggering operation. Mutation queries should also carry the ownership/member predicate instead of relying only on a prior read. Limit joined rooms per socket and test that a removed member immediately loses access.

### F-03 - High - One global API key grants broad, unscoped authority

**Status:** Open.

**Evidence**

- `app.js:580-599` accepts either any valid session or one global `API_KEY` for `/api`.
- `routes/api.js` combines health, message inbox, Tapo readings, audio, Chat5, tasks, records, exchange rates, and test endpoints under that boundary.
- `controllers/apicontroller.js:165-186` permits API-key callers to choose a chat user through request input.
- `controllers/apicontroller.js:272-315` permits request-selected/default task users.
- Chat conversation IDs used through this API are not consistently scoped to that principal.

**Impact**

Leakage of one key compromises unrelated integrations and data sets. There is no independent rotation, per-client revocation, capability restriction, subject binding, or reliable attribution.

**Recommendation**

Replace the global key with hashed service-principal credentials containing an ID, name, allowed capabilities, fixed subject/owner, expiry, last-used timestamp, and revocation state. A service principal should not be able to select an arbitrary `name` or `userId` unless an explicit impersonation capability allows it. Apply per-principal rate limits and audit events. Cloudflare Access service tokens can be an outer gate, but application-level scoped credentials are still needed.

### F-04 - High - Admin-managed HTML bypasses publication state and runs as same-origin active content

**Status:** Open.

**Evidence**

- `app.js:418` serves the entire `public` tree before application routes.
- Admin HTML management writes files under `public/html` (`controllers/admincontroller.js:1444-1583`).
- `HtmlPageRating.isPublic` controls navigation/listing, but direct `/html/<filename>` delivery does not consult it.

**Impact**

A file marked private remains accessible to anyone who knows its name. More importantly, HTML uploaded or created by an admin executes JavaScript in the main application's origin. While an `HttpOnly` cookie cannot be read directly, same-origin script can issue authenticated requests and read responses. A compromised HTML-generation workflow or malicious copied sample therefore becomes an account-action/XSS surface.

**Recommendation**

Move managed HTML outside `public`. Serve it through a controller that checks `isPublic` and uses explicit caching/security headers. Prefer a separate cookieless hostname for public interactive samples. If same-origin preview is unavoidable, render it in a tightly sandboxed iframe, use a restrictive CSP, and do not grant `allow-same-origin` together with scripts.

### F-05 - High - CSRF protection is incomplete and destructive GET routes remain

**Status:** Open, with one route and one rendering vector fixed.

**Evidence**

- There is no application-wide CSRF token or Origin/Referer validation layer.
- The session cookie defaults to `SameSite=Lax` (`app.js:117-122`). This helps with many cross-site POSTs but still permits cookies on top-level cross-site GET navigation.
- State-changing GET examples remain:
  - `routes/accounting.js:18` - delete transaction.
  - `routes/budget.js:18,24` - delete entry/all test data.
  - `routes/chat4.js:39,53,75` - delete conversations, knowledge, and batch prompts.
  - `routes/gptdocument.js:19` - delete document.
  - `routes/receipt.js:43` - delete receipt.
  - `routes/admin.js:258` - delete log file.
  - `routes/mypage.js:59` - update/pull a Git repository using GET.

The blog deletion action was changed from GET to POST. Markdown images are now restricted to passive local media/data URLs so an AI-generated image such as a destructive internal route no longer auto-fetches that route. Those changes do not solve general CSRF.

**Impact**

A malicious site, link, redirect, or embedded resource can trigger logged-in state changes. POST/PATCH/DELETE endpoints also need explicit CSRF protection rather than relying solely on cookie defaults.

**Recommendation**

Convert every mutation to POST/PATCH/DELETE, introduce CSRF tokens for browser forms/API calls, and verify same-origin `Origin`/`Sec-Fetch-Site` where practical. Keep webhook and non-browser service-principal routes outside browser CSRF middleware, with their own signature/token verification. Add a test that fails when an authenticated router registers a known state-changing controller on GET.

### F-06 - High - Legacy Chat3 crosses account boundaries

**Status:** Open. Chat1 was fixed; Chat3 requires a legacy data-ownership decision.

**Evidence**

- `controllers/chat3controller.js:19-95` loads every Chat3 entry and derives conversation summaries globally.
- `controllers/chat3controller.js:318-373` updates image/sound fields by arbitrary message ID.
- `controllers/chat3controller.js:840-846` fetches arbitrary message IDs.
- Several Chat3 paths historically use a hard-coded `UserID`, so simply filtering by the current field could hide or orphan legitimate legacy data.

**Impact**

A logged-in account with Chat3 permission can disclose or modify another account's chat records if it knows IDs, and the list view itself exposes global conversation metadata.

**Recommendation**

Define ownership for legacy rows, migrate existing data, and make every query include that owner. Do not retain a hard-coded owner in new writes. Add controller/service tests for own, foreign, missing, and migrated records.

### F-07 - High - Private generated data and media are not consistently owner-scoped

**Status:** Partially mitigated.

**Evidence**

- The broad static mount keeps `public/img` publicly available (`app.js:418`). Generated and uploaded chat images are written into that same directory.
- Newly promoted Chat5 uploads now receive timestamp-plus-UUID names, but older generated files can have predictable timestamp-derived names and all `/img` URLs remain public when learned.
- Generated directories such as `/mp3`, `/ocr`, `/ocr_tts`, `/audio`, `/video`, and 3D model paths are now authentication-gated, but delivery is not owner-specific.
- `controllers/embeddingcontroller.js:23,58-60` performs global embedding/chat reads.
- Representative OCR/ASR controllers load jobs by ID; ownership fields and filters are not consistent across all operations.

**Impact**

One account can potentially read another account's generated/job data. Public chat-image URLs can leak through conversation content, browser history, copied links, provider prompts, or logs and are then available without authentication.

**Recommendation**

Separate immutable public site/blog assets from private generated media. Store private media outside `public` and serve it through an authenticated, owner/member-scoped download route using opaque IDs. Add ownership predicates to embedding and job queries. If Cloudflare caching is used, bypass all private media and never cache a response carrying session-specific authorization.

### F-08 - Medium - Session storage, logout, and revocation are insufficient

**Status:** Partially mitigated.

**Evidence**

- `express-session` is used without an explicit store (`app.js:111-124`), leaving the default MemoryStore.
- No logout/session-destroy route was found.
- Password reset, role change, or account deletion does not invalidate existing HTTP sessions.
- Socket connections now verify the user and permission at handshake and disconnect at cookie expiry, but do not revalidate a destroyed session, deleted account, or revoked capability until expiry.
- Socket.IO has no explicit Origin allowlist.

**Impact**

MemoryStore is unsuitable for reliable production lifecycle management. Emergency account/role revocation can leave an active browser or socket usable for up to the configured session lifetime. Lack of logout makes incident response and normal hygiene harder.

**Recommendation**

Use a persistent server-side session store, add POST logout with session destruction and cookie clearing, rotate the session ID on login, and add an account/session version so password or role changes invalidate prior sessions. Revalidate long-lived sockets periodically or through packet middleware and disconnect fail-closed. Add an application Origin allowlist. Consider application or Cloudflare Access MFA for the two interactive identities.

### F-09 - Medium - Route-name permissions and role records are incomplete and can drift

**Status:** Open; modernization recommended below.

**Evidence**

- `models/useraccount.js:6` accepts any short string as `type_user`.
- `models/role.js` has no uniqueness constraint on `{ name, type }`.
- Current permissions are route/tool names rather than operation capabilities.
- `app.js:504-545` shows many routes with a named permission, but newer tools such as `/gpt-image`, `/qwen3-lora`, `/trellis2`, `/pixal3d`, `/prompt-to-3d`, `/model-previewer`, `/lego-sculpture-converter`, `/codex`, bookmarks, and reminders require only authentication.
- `/mypage` lets any account edit public articles and use the owner's Git browser (`routes/mypage.js:41-60`).
- Navigation permission hydration and enforcement do not use exactly the same typed query, so display and access can drift.

**Impact**

Adding a new tool can silently make it available to all accounts. A route-level `chat5` grant cannot express read/write/member/admin differences. Duplicate or malformed role documents can make policy evaluation ambiguous.

**Recommendation**

Adopt semantic capabilities, typed roles, uniqueness indexes, a centralized policy registry, and object-scoped service functions. Treat navigation as presentation only; server middleware/service queries remain authoritative.

### F-10 - Medium - Browser defense-in-depth is weakened by disabled CSP and broad script trust

**Status:** Partially mitigated.

**Evidence**

- Helmet is enabled, but CSP and COEP are explicitly disabled (`app.js:82-86`).
- The app contains many inline scripts and several third-party browser libraries, which currently make a strict CSP migration nontrivial.
- Stored/DOM XSS sinks found in this audit were fixed, and local DOMPurify is now used for untrusted rendered HTML, but sanitization should not be the only control.

**Impact**

Any missed or future injection sink has fewer browser-level restrictions. Third-party script compromise receives the authority of the page that loaded it.

**Recommendation**

Inventory script/style sources, self-host and pin important libraries, remove inline handlers/scripts incrementally, and deploy CSP in Report-Only mode first. Move toward nonces or hashes and a policy centered on `default-src 'self'`, narrowly enumerated connect/media/font sources, and no `unsafe-eval`. Enable enforcement only after reviewing real reports and critical flows.

### F-11 - Medium - Tunnel/origin and WebSocket trust boundaries need explicit enforcement

**Status:** Configuration-dependent and not verified live.

**Evidence**

- Production defaults to `trust proxy = 1` (`app.js:76-80`).
- `server.listen(PORT)` does not bind a specific interface (`app.js:724-727`).
- Socket.IO has no explicit Origin allowlist.

**Impact**

If port 8080 is reachable outside the Tunnel, callers may bypass Cloudflare controls. Incorrect proxy topology can make client IP and secure-cookie assumptions unreliable. A logged-in browser may be induced to establish a cross-origin WebSocket unless the application checks Origin.

**Recommendation**

Bind the app to loopback when cloudflared runs on the same host, or enforce a host firewall that permits only the intended local/container network. Keep the exact proxy-hop count documented. Configure Socket.IO `allowRequest`/Origin checks for the public hostname. Reject unexpected Host headers where deployment permits.

### F-12 - Medium - Secret-public URLs remain bearer capabilities

**Status:** Intentionally open, substantially hardened.

**Evidence**

- Four feature paths are generated from 192-bit random values.
- This audit added `no-store`, `noindex`, and `no-referrer` responses; disabled analytics on those pages; normalized their operational metrics/log labels; added/retained rate limits; and restricted persisted `.env` permissions to `0600` when the file is managed by the app.
- A valid process-provided secret now wins without being copied into `.env`, supporting read-only/externally managed secret deployments.

**Residual risk**

Anyone with a URL can use the feature. The public to-buy page can reveal household/device/location-related state; telemetry routes can accept data. URLs may have leaked historically through analytics, referrers, performance records, screenshots, or copied links before the new controls.

**Recommendation**

Rotate all four paths after deploying this hardening pass. Keep them out of screenshots, rule names, dashboards, tickets, and logs. Add independent per-device tokens for write endpoints when clients can send headers; use separate view/write credentials where practical. Do not put interactive Cloudflare Access in front of devices that cannot complete it, but consider Access service tokens for capable automated clients.

### F-13 - Medium - Public test/debug and resource-heavy routes remain exposed

**Status:** Partially mitigated.

**Evidence**

- `routes/index.js:41-78` publicly exposes download, scroll, editor, API, image selector, diff, and CSV-diff test routes.
- Public dummy/FMI/shipping mocks are mounted in `app.js:495-500`.
- Dummy multipart endpoints now have file/field/part limits and a configurable rate limit.
- Public cooking requests and other public writes can still consume storage or provider resources depending on feature behavior.

**Impact**

Internet scanners can discover and repeatedly exercise endpoints that were likely intended for development or a narrow integration. Compression, parsing, logging, database writes, or provider calls can become denial-of-service/cost paths.

**Recommendation**

Remove unused routes from production, or explicitly mark and protect them with a capability/service token. Add Cloudflare and origin rate limits to remaining public writes and expensive operations. Keep request-size and work-queue limits at the application even when Cloudflare limits are present.

### F-14 - Medium/Low - Residual logging and integration-secret exposure

**Status:** Partially mitigated.

**Evidence**

- The shared logger now recursively redacts sensitive key names, safely serializes `Error` objects, and sanitizes object messages.
- Chat transcription/TTS previews, complete shipping request bodies, complete OpenAI webhook events, full Mailgun responses, and full Sora response logging were removed or minimized.
- Secret values embedded inside arbitrary free-form strings cannot be reliably recognized by a key-based redactor.
- The Ollama completion webhook token is sent in a query string (`utils/Ollama_API.js` and `controllers/webhook.js`), which can be captured by proxy/CDN URL logs.
- Some explicit API debug records intentionally retain large request/response data, including generated-media inputs.

**Impact**

Logs and debug databases can become a secondary store for personal prompts, responses, provider metadata, URLs, or tokens. Query-string credentials are especially likely to appear in intermediary logs.

**Recommendation**

Move the Ollama token to an authorization/signature header when the gateway supports it. Default production logging to `notice` or higher; make full API-debug capture short-lived and opt-in; define retention limits; and review logs for personal content before exposing them through admin pages or backups. Continue using stable messages plus small structured metadata rather than provider/request objects.

### F-15 - Low/Medium - Additional service-boundary hardening remains

**Status:** Open or partially mitigated depending on feature.

- The music proxy can forward a broad set of upstream paths and may process attacker-controlled regular-expression-like search input. Constrain allowed upstream operations and bound search complexity.
- Upload MIME/magic-byte validation is inconsistent. Size/count/path handling improved, but sensitive parsers should validate actual content and re-encode images where possible.
- `/apphealth` is liveness only; it does not confirm database, queue, storage, or critical provider readiness. Keep liveness cheap, but add a protected readiness endpoint for deployment monitoring.
- A local attacker may still exploit time-of-check/time-of-use races around symlinks after a realpath check. The Git browser now rejects symlink directory entries and confines real paths, which is sufficient for the expected single-user host threat model but not a hostile shared filesystem.

## Fixes applied in this audit

### Dependencies and runtime

- Ran the non-breaking npm audit fix path and updated vulnerable transitive packages.
- Added local `dompurify` rather than relying on a remote/latest sanitizer.
- Updated the Volta Node pin from `24.12.0` to `24.20.0`.
- Final full and production-only npm audits each report zero known vulnerabilities.

The machine used for verification still runs Node `24.12.0`; deployment must install the new pinned runtime before this runtime change takes effect.

### Authentication, authorization, and sessions

- Consolidated route-permission evaluation in `utils/authorization.js` and added tests for group and user-specific grants.
- Revalidated Socket.IO principals against the user database and checked the `chat5` permission before registering Chat handlers.
- Required a valid, unexpired session cookie for Socket.IO and added a chunked expiry timer that safely supports long durations without the Node timer overflow limit.
- Stopped Socket.IO initialization when an immediately expired session disconnects during setup.
- Kept notification sockets available to authenticated accounts while limiting Chat5 event registration to principals with the capability.
- Changed the shared layout to load notification Socket.IO scripts only for logged-in pages.
- Scoped Chat1 POST history to `req.user`, rejected foreign/missing nonzero thread IDs before calling OpenAI, and allocated new thread IDs from the current owner's records.

### XSS, HTML, Markdown, and inline data

- Added centralized safe Markdown rendering and post-render sanitization for legacy Chat1/Chat2/Chat3/Chat4/Chat5 paths that previously inserted raw or merely parsed content.
- Added a blog-specific HTML allowlist and sanitized both newly saved and legacy-read content.
- Replaced unsafe dynamic DOM construction in Chat3, Chat5, Chat5.5, Git browser, and products UI with `textContent`, encoded paths, or constructed elements.
- Added DOMPurify to the browser paths that must display sanitized HTML.
- Restricted Markdown image sources to passive local media/data image URLs, preventing automatic requests to authenticated action routes and remote tracking images.
- Added `utils/safeJson.js` and migrated inline Pug JSON/script data to escape `<`, `>`, `&`, U+2028, and U+2029.
- Escaped the text editor's raw content output.
- Sanitized inbound email previews with a passive formatting allowlist, removed remote images/URL attributes/forms/scripts/styles, and retained sandboxed/no-referrer iframe rendering plus escaped raw source.

### Files, paths, static media, redirects, and outbound URLs

- Authentication-gated generated directories including audio, MP3, OCR, temporary, video, and 3D-model paths before the broad public static mount.
- Added an encoded-path guard so percent encoding, slash encoding, dot segments, backslashes, malformed escapes, or absolute-form URLs cannot bypass those protected directory names.
- Replaced user-derived upload names with UUID-based names and added reusable lexical confinement/direct-child checks.
- Confined legacy Chat5 temporary references, limited their count, stopped returning absolute server paths, and hardened cleanup.
- Randomized promoted Chat5 upload filenames. This improves unguessability but does not replace the required public/private `/img` split.
- Confined gallery delivery to known listed files.
- Rejected Git repository/path traversal and symlink entries; used `lstat` plus realpath containment before reading text.
- Limited Comfy gateway view URLs to the configured origin and exact expected path.
- Replaced user-controlled redirects with local-path validation.

### Secret-public privacy

- Added `Cache-Control: private, no-store`, `X-Robots-Tag`, and `Referrer-Policy: no-referrer` to all four secret-public mounts.
- Disabled Google Analytics for logged-in pages and secret-public pages.
- Replaced secret paths in performance/error metrics with stable feature labels.
- Prevented raw secret URLs from minute-logger operational error records.
- Enforced mode `0600` when the app creates, updates, or accepts hidden-path values from its `.env` file.
- Preserved process-environment precedence without persisting externally supplied secret values.

### Logging, error handling, and public abuse

- Added a final Express error handler that logs actionable server failures but returns generic non-stack responses.
- Added recursive sensitive-key redaction and restricted `Error` serialization in the production logger.
- Reused request redaction for dummy API snapshots and removed full shipping payloads from operational logs.
- Minimized OpenAI webhook, Mailgun, Sora, TTS, and transcription logging.
- Added size/count/field limits and rate limiting to public dummy multipart routes.
- Changed blog deletion from GET to POST.

## Verification

Final verification on 2026-08-28:

| Check | Result |
| --- | --- |
| `npm test -- --runInBand` | 192 suites passed; 1,208 tests passed; coverage thresholds passed |
| `npm audit --json` | 0 critical, 0 high, 0 moderate, 0 low |
| `npm audit --omit=dev --json` | 0 critical, 0 high, 0 moderate, 0 low |
| Changed JavaScript `node --check` pass | Passed |
| Compile every Pug template | Passed |
| `git diff --check` | Passed |
| Targeted tracked-file secret-pattern scan | No obvious committed credentials found |

At the start of this audit, the full npm audit reported 10 advisories (7 high and 3 moderate), while the production-only audit reported 8 (5 high and 3 moderate). No force/major-version downgrade was used to reach the final clean audit.

The test environment emits Node's expected experimental VM-modules warning. The live application and production integrations were not started.

## Recommended authorization modernization

### 1. Use semantic capabilities, not route names

Examples:

- `chat.use`
- `chat.conversation.read`
- `chat.conversation.write`
- `chat.conversation.manage_members`
- `chat.conversation.delete`
- `blog.publish`
- `github.browser.read`
- `github.repository.pull`
- `finance.read`
- `finance.write`
- `media.private.read`
- `codex.run.read_only`
- `codex.run.workspace_write`
- `codex.session.read_all`
- `admin.users.manage`

A single route may require different capabilities by HTTP method or operation. Capability names should describe authority, not UI placement.

### 2. Make roles bundles of capabilities

- `admin`: explicit broad administrator bundle, with especially dangerous capabilities visible and auditable.
- `family`: only the shared household capabilities actually intended for family members.
- `user`: conservative personal capabilities.
- Per-user grants: small exceptions for the work account, without inventing another broad role.

Add a controlled `type_user` enum or reference, and a unique index on role `{ name, type }`. Decide explicitly whether admin receives a wildcard; do not let that behavior emerge from unrelated route-name records.

### 3. Add object-scoped policy helpers

Use service methods such as `findConversationForMember(id, principal)` and `findJobForOwner(id, principal)` that include authorization in the database query. Avoid `findById` followed much later by a permission check. Define a narrow admin override centrally.

Every object-bearing endpoint should be tested for:

- Owner/member succeeds.
- Unrelated user receives generic 404/403 and no data.
- Removed member loses read, room, and mutation access.
- Admin behavior matches the documented override.
- A service principal can access only its fixed subject and scopes.

### 4. Centralize the route policy inventory

Create a registry adjacent to route mounting containing:

- Zone: `public`, `secret-public`, `session`, `service`, or `webhook`.
- Capability by method/action.
- CSRF policy.
- Rate-limit class.
- Object-policy function, if applicable.
- Cache classification: `public-static`, `public-dynamic`, or `private`.

Add a test that enumerates registered routes and fails when a new route has no declared policy. This prevents the current pattern where a new tool is mounted with authentication only because a route permission was not added.

### 5. Migrate incrementally

1. Inventory and label routes without changing behavior.
2. Implement `requireCapability` and object-policy helpers.
3. Dual-evaluate old and new policies, logging only mismatches without secrets or request bodies.
4. Migrate Codex, Chat5, `/api`, private media, and Chat3 first.
5. Add schema indexes/migrations and update the admin role UI.
6. Remove legacy route-name permission checks only after the full matrix passes.

This approach preserves today's two accounts and unused family layer while making future accounts safe by default.

## Cloudflare security review checklist

This section is based on current Cloudflare documentation as of the report date. Plan availability varies. The live configuration was not inspected.

### Recommended zone mapping

| Application zone | Cloudflare treatment |
| --- | --- |
| Fully public | Remain public; Managed WAF/custom rules and conservative rate limits; cache only truly immutable public assets |
| Secret public | Usually remain outside interactive Access so existing devices keep working; bypass cache; apply rate/method rules; use Access service tokens only where the client can send credentials |
| Logged in | Add Cloudflare Access as an outer identity/MFA gate where practical; Express remains authoritative for role and object authorization |
| Admin/high-impact | Strongest Access policy: exact owner identity, MFA, short session; cover both base paths and descendants |
| Webhooks | Keep reachable by providers; rely on application signature/token verification plus narrowly tuned WAF/rate rules; do not create broad WAF bypasses |

### Access

Near-term, protect the highest-impact paths such as `/admin`, `/codex`, `/codex-log-review`, and `/tmp-files` with policies allowing only the exact owner identity/identities and requiring MFA. Cloudflare's more-specific application path wins; wildcard child paths do not necessarily cover the parent path, so test both the base route and descendants. Query strings cannot define Access application paths.

Do not make the whole current hostname an Access application without explicit public bypass design, because the hostname intentionally contains public pages and device/webhook clients. Longer term, moving logged-in tools to a separate `private` subdomain is simpler and less error-prone than maintaining a long list of protected paths on a mixed hostname.

Access is defense-in-depth, not the application's role system. If Access is enabled, configure cloudflared **Protect with Access** or validate the `Cf-Access-Jwt-Assertion` at the origin so a routing mistake cannot bypass the outer gate. Automated clients that support credentials can use individually named, expiring, revocable service tokens.

Official references:

- [Application paths and precedence](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Publish and protect a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Enforce MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/)
- [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

### Tunnel and origin

- Point the Tunnel service to loopback, for example `http://127.0.0.1:8080`, when cloudflared and Node share a host.
- Bind Node to loopback or firewall the origin port so it is not reachable directly from the LAN/Internet.
- End ingress configuration with a catch-all `http_status:404` rule.
- Validate locally managed ingress with `cloudflared tunnel ingress validate`.
- Store tunnel credentials/tokens with root/service-account-only permissions and rotate them after suspected exposure.
- Confirm only the intended hostname maps to this service.

Official references:

- [Tunnel configuration file and ingress validation](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)
- [Tunnel token management](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/)

### WAF and rate limiting

- Enable the available Cloudflare Managed Rules. Start new rules in logging or Managed Challenge mode where the plan permits, review Security Events, and create narrow rule exceptions only for verified false positives.
- Rate-limit login, public write endpoints, dummy/debug endpoints, secret-public telemetry, CSV/diff/download tests, and expensive AI/media-generation entry points. Keep application rate limits because Cloudflare enforcement is not an exact origin request counter and can fail open under infrastructure stress.
- Avoid broad IP Allow rules or Skip rules: they can bypass later WAF/rate products. Exempt only the minimum product/rule for a specific trusted integration.
- Treat signed OpenAI/Mailgun/Ollama-style webhook paths separately. Ensure WAF changes do not block legitimate provider payloads, but do not skip all security products for the entire hostname.
- Verify Socket.IO upgrade and long-polling traffic after enabling rules.

Official references:

- [Managed WAF rules](https://developers.cloudflare.com/waf/managed-rules/)
- [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Create a rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)
- [WAF skip-rule guidance](https://developers.cloudflare.com/waf/custom-rules/skip/)

### Cache

Create Cache Rules that bypass cache for:

- All logged-in/dynamic HTML and JSON.
- `/api`, `/webhook`, and `/socket.io`.
- All four secret-public paths.
- Private/generated media paths such as MP3, OCR, audio, video, temp, and 3D outputs.
- Any response with session-specific authorization.

Cache only versioned/immutable assets that are deliberately public. The source's public/private `/img` mixture makes a blanket `/img/*` edge-cache rule unsafe until media is separated.

Official reference: [Cache Rules settings and bypass](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/).

### TLS and browser-facing settings

- Enable Always Use HTTPS.
- Set minimum TLS to 1.2 or higher unless a known device requires older TLS.
- Add HSTS only after confirming every required hostname and client works over HTTPS; begin with a short max-age before includeSubDomains/preload.
- Preserve WebSocket support and add the application-level Socket.IO Origin allowlist; browser CORS is not an authorization control.

Official references:

- [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)
- [Minimum TLS version](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/)
- [Socket.IO CORS and Origin considerations](https://socket.io/docs/v4/handling-cors/)

### Cloudflare review record

Record the following during the dashboard review without copying secret URL values into the record:

- Access applications, exact protected base/child paths, allowed identities, MFA method, and session duration.
- Tunnel hostname, loopback service target, catch-all rule, connector identity, and last token rotation.
- Managed rulesets, mode, exceptions, and the reason/owner/expiry for each exception.
- Rate rules, counters, thresholds, actions, and observed false positives.
- Cache bypass rules and a request/response-header check for every private zone.
- Direct-origin reachability test from another machine/network.
- Security Events and Access logs reviewed after deployment.

## Prioritized remediation plan

### Before or immediately after deploying this patch

1. Install Node `24.20.0` in the deployment environment and perform `npm ci` from the updated lockfile.
2. Rotate all four secret-public URL values after confirming clients can be updated.
3. Verify public, secret-public, user, and admin behavior; test Socket.IO, protected media, blog rendering, email preview, Git browser, and dummy integrations.
4. Confirm the origin port is not directly reachable and apply cache bypasses for private/dynamic zones.
5. Put the highest-impact admin/Codex paths behind Cloudflare Access with exact identity and MFA if compatible with current use.

### Priority 0

1. Restrict Codex execution and session/turn access.
2. Add owner/member authorization to every Chat5 generation and Socket.IO event.
3. Move managed HTML out of direct same-origin public static delivery.

### Priority 1

1. Replace destructive GETs and add CSRF protection.
2. Replace the global API key with scoped service principals.
3. Split public assets from private generated media and enforce owner/member delivery.
4. Migrate and scope Chat3 and global embedding/job data.
5. Add logout, a persistent session store, session revocation/versioning, and socket revalidation.

### Priority 2

1. Introduce the capability/policy registry and role schema constraints.
2. Roll out CSP through Report-Only and reduce third-party/inline script trust.
3. Remove or protect unused public test/debug routes.
4. Complete logging/debug-data retention and webhook query-token cleanup.
5. Add readiness monitoring and normalize upload content validation.

## Positive controls observed

- Login accepts bcrypt hashes only and has rate limiting.
- Session cookies are HttpOnly, have explicit SameSite behavior, and default to Secure in production.
- Helmet baseline headers are enabled and `X-Powered-By` is disabled.
- OpenAI webhooks use signature verification.
- Secret-public paths use strong random values and now receive privacy/cache/index controls.
- Several newer 3D/job implementations already show better path and ownership patterns that can be reused.
- Generated-media and upload routes generally have explicit size/count limits after the current and prior audits.
- The repository does not track `.env`, and the targeted tracked-file scan found no obvious committed credentials.
- The test suite is broad and fast enough to support incremental security refactoring.

## Relationship to the prior report

This report supersedes the posture summary in `documentation/security-audit-2026-06-27.md` while preserving it as historical evidence. Previously fixed login/password-reset, rate-limit, cookie, dependency, Git-path, and upload-limit controls were re-reviewed where they intersected the current scope.
