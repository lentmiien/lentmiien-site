# Account form CSRF investigation and repair (2026-09-08)

## Evidence and confidence

The supplied read-only production investigation observed three token rejections on
September 8 JST (13:45:01.370, 13:54:42.836, 13:56:45.412), at checkout `ba8289b`.
The router-relative `/api/life/entry` is externally `/mypage/api/life/entry`.
They occurred before writes and returned exactly:
“The form expired or came from an untrusted page. Reload and try again.”
Origin rejections have a different log message; these observations establish token
validation failure, not which token failure occurred.

The current dashboard route issues a session token; `views/mypage.pug` exposes it on
`#account-dashboard`. The loader fetches escaped Pug from `/mypage/api/life-panel`,
mounts it, sets `LIFE_LOG_BASE_PATH=/mypage/api/life`, and evaluates the entry script.
Basic, medical and diary entries share a submit listener. Visual saves and generated
follow-ups have separate click listeners. All three paths already sent JSON with
`X-CSRF-Token` when the DOM token existed. The JSON payload allowlist intentionally
excludes `_csrf`; adding a hidden field alone would not repair these requests.
No independent token timer exists. Sessions use Express's process-local MemoryStore.

**Leading hypothesis, unverified:** the pre-redesign script, which omitted the header,
was reused at its unchanged `/js/my_life_log.js` URL. The dashboard loader and task,
Codex and Tool Manager token-transport scripts also had unchanged public URLs.
Production browser bytes, cache state and the presence/absence of the actual request
header have not been observed. The supplied public-asset probe returned HTTP 530.
Do not describe a missing browser header or failed refresh as a user observation.

A synthetic legacy request without the header reproduces the exact rejection; the
actual current code with a rendered token succeeds. Missing DOM tokens and lost or
mismatched session tokens are separately reproducible. Restart/session loss or a
multi-process session mismatch remain possible explanations, not established causes.
No deployment replica topology or CDN rules were available in this checkout.

**Deterministic code defects:** the loader set `panelLoaded` before its script loaded.
A script failure made Refresh skip initialization permanently. Until initialized, the
Life Log form defaulted to native GET. The Tool Manager tester and ten Codex JavaScript
forms also defaulted to GET if their handlers were unavailable. That could put entered
fields in a query string. These defects are independently fixed; script download
failure alone does not explain the observed POST token rejections.

## Scoped implementation

- `utils/formAssets.js` hashes an allowlist of five public scripts with SHA-256 at
  startup. `app.js` exposes the view helper and serves exact in-memory snapshots at
  `/assets/forms/<content-sha256>/<filename>`. Unknown revisions return non-cacheable
  404s, never newer bytes at an older immutable URL. Missing required files fail
  startup with an actionable, token-free production log. This follows the existing
  versioned Three vendor path convention; no generic first-party asset helper existed.
- The shell fingerprints the dashboard and task scripts and supplies the fingerprinted
  Life Log URL in a data attribute. Codex views and Tool Manager fingerprint their
  token-transport scripts. The old public URLs remain for existing pages. Default
  `express.static(public)` uses revalidation (`max-age=0`); no local service-worker
  registration or first-party script CDN policy was found. Game compression is separate.
- Life Log distinguishes mounted from initialized. Failed script loads can retry in
  the same fragment, preserving entered text. Initialization must acknowledge completion;
  a second successful script evaluation does not attach duplicate submit handlers.
  The mounted form cancels native submission while loading; its markup also specifies
  POST. Codex and Tool Manager JS forms now specify POST to their current page, which
  has no matching write handler, so unavailable scripts cannot put fields in URLs or
  execute a native fallback write.
- All three Life Log entry write paths share JSON/header transport, explicitly use
  same-origin credentials, and reject missing/malformed account tokens locally.
  Failed CSRF/authentication submissions keep text, timestamps, points and follow-up
  controls and explain that unsaved data must be copied/noted before reloading.
  Settings/shortcut errors likewise preserve choices and identify secure-session failure.
  Nothing persists drafts in browser storage or automatically replays a write.
- Shared CSRF logs include only route template and `tokenStatus`: `missing_token`,
  `malformed_token`, `missing_session_token`, `token_mismatch` (in that precedence).
  Malformed body-token types fail closed. GET/HEAD establish tokens; mutations do not
  generate a new token that would conceal a missing session token. Successful validation
  exposes the existing token to native POST result views. Origin checks remain first
  and unchanged. JSON adds generic `code: CSRF_REJECTED`; the generic error text and
  HTML rejection are unchanged. No token, cookie, session ID, payload or personal data
  is added to logs or URLs.

This maintains the existing logged-in dashboard security contract in
`account-dashboard.md`: existing semantic capabilities and personal-owner checks,
request bounds, private/no-store HTML/API responses, and shared CSRF defense remain.
No new mutation, capability, provider integration, media storage or migration is added.
The new asset GET/HEAD route is fully public, serves only fixed public JavaScript bytes,
and receives no private data. The jsdom dependency is development-only for synthetic
DOM integration tests; runtime dependency versions are unchanged.

## Protected-form audit

| Surface | Evidence and disposition |
| --- | --- |
| Life Log basic/medical/diary/visual/follow-up | Current header transport verified by executing rendered shell + fragment + actual scripts against real test sessions. Added fingerprinting, local token failure, input-preserving guidance, loader retry/duplicate guard and safe native method. |
| Account settings and shortcuts | `account_dashboard.js` request helper already sends header. Fingerprinted; current script requests and rejection preservation tested. |
| Task completion | `mypage_tasks.js` reads `#mypage-tasks` token and PATCHes protected `routes/mypageTasks.js`. Fingerprinted; existing gesture/route tests retain coverage. |
| Dashboard and dedicated embedding search | Both Pug forms include `_csrf`; `accountSurfaceBody` decodes URL-encoded requests before validation. Rendered native FormData posts and POST-result token verified; a legacy form without the field rejects before provider calls. No script is required for token transport. |
| Codex | `controllers/codexController.js` bootstrap token → `public/js/codex.js` mutation header → `routes/codex.js` validation. All six script references fingerprinted. Ten JS-only forms now explicitly POST; rendered form method/asset checks added to existing view coverage. |
| Tool Manager | Native seed/save/toggle/delete forms have `_csrf`. Tester config carries token into JSON header. Script fingerprinted, tester native method fixed; actual rendered tester execution verified with a synthetic handler, never a real tool. |
| Runpod | Native mutations in `views/admin_runpod.pug` carry `_csrf`; `runpodAdmin.js` controls selection/confirmation and disables submit buttons without disabling hidden tokens. No intercepted fetch or multipart mutation was found in these forms. Existing page and authorization tests pass. |
| Ask Lennart | Native response form carries `_csrf`; bounded form parser precedes validation. `ask_lennart.js` only manages refresh and dirty-input protection. Existing page/security tests pass. |
| Legacy `/mypage/life_log` | Gated alias checks tokens before 307 redirects on mutation. Current links point directly to `/admin/life_log`; no current form targets the alias. A previously opened legacy client without a token still fails closed. |
| Legacy Life Log import/reminders/format, ASR, bookmarks and other legacy forms | No added shared-CSRF coverage. Account fragment has neither audio nor format controls. Timeline multipart imports target the existing `/admin/life_log` router, which is outside the protected dashboard write path. No new exemptions or legacy access-control redesign. |

## Validation and limits

Node 24.20.0 via Volta: focused validation passed **15 suites / 180 tests**;
`volta run --node 24.20.0 npm test -- --runInBand` passed **257 suites / 1,982 tests**
in 49.71 seconds. Required coverage inventory: 67.35% statements, 43.72% branches,
77.56% functions, 67.98% lines; all configured thresholds passed. Final error-wording
and integration-harness adjustments were rechecked with the relevant focused suites.
`git diff --check` passed. OpenAPI YAML was not changed.

Tests use only synthetic records and mocked authentication/principals and provider/DB
operations, with actual Express parsers, CSRF middleware and MemoryStore sessions.
jsdom parses rendered Pug and evaluates the actual scripts fetched through the asset
handler. The harness supplies browser cookie transport, Node fetch/AbortController,
script load events and synthetic body-map dimensions. It does not inject the successful
CSRF header, imitate client submit logic, execute third-party scripts or start `app.js`.
Negative tests intentionally alter transport/session state. Asset tests prove stable
hashes, content-change invalidation, exact snapshot bytes, shell child-URL changes,
HEAD support and closed unknown paths. Old route-only tests remain alongside integration
coverage; direct token injection alone is insufficient evidence for the browser contract.

This is DOM/network integration, not a production browser/cache or visual layout test.
Production has not been mutated. Existing npm audit findings are browserslist (high),
qs (moderate) and sanitize-html (moderate); their locked versions predate this dependency
addition. No unrelated audit remediation is included.

## Deployment and browser verification

1. Deploy this commit and install its lockfile using the normal deployment procedure;
   restart application processes so asset snapshots and their HTML references agree.
   Include all five allowlisted files under `public/js`. No new environment variable or
   database migration is needed. Do not use application startup as a local smoke test.
2. Preserve private/no-store bypasses for `/mypage`, its fragment/APIs and other private
   form pages. Allow public `/assets/forms/*` through the proxy to the application. Its
   immutable paths can be cached normally, including by caches that ignore query strings.
   Do not normalize away the hash path. No global cache disabling or routine purge of
   old script URLs is required. If the CDN previously cached private HTML against policy,
   correct that rule and purge those private page responses through normal operations.
3. Keep existing CSRF origin/proxy configuration. Do not disable checks to address this
   token failure. MemoryStore still requires requests to reach the same live process;
   a restart requires a fresh login/page. Persistent/shared sessions, if needed by actual
   deployment topology, remain a separate scoped change.
4. Preserve unsaved entries, then open a fresh `/mypage` normally. In browser Network,
   verify `/assets/forms/<hash>/account_dashboard.js` and `my_life_log.js` load successfully.
   Submit an intentional test entry in each mode, one body-map point and one follow-up;
   confirm POST `/mypage/api/life/entry`, successful response and exactly one new entry.
   Inspect only whether `X-CSRF-Token` exists and locally matches the rendered token;
   do not copy token values, cookies, personal form fields or HAR payloads into reports.
5. Search once through each embedding form and verify native POST succeeds. Check settings,
   shortcuts and task completion with intentional changes. If CSRF still fails, report only
   the safe rejection category, route, asset revision/load status and timestamp. A
   `missing_token` with the current revision needs browser header/DOM investigation;
   `missing_session_token` or `token_mismatch` needs session continuity investigation.
