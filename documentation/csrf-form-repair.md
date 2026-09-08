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

**Confirmed incident cause (Lennart's browser report, September 8 JST):** stale
pre-redesign `my_life_log.js` was reused from the browser cache after multiple
reloads. Lennart initially found `X-CSRF-Token` nowhere in the loaded JavaScript or
request. With DevTools cache disabled, a reload fetched the noncached script with
working `X-CSRF-Token` code, and he successfully submitted a new Life Log entry.
This evidence was supplied through Ask request
`1cc904f4-6f80-4071-a7ce-57845a9b79b7` and relayed into this follow-up; no tokens,
cookies or private entry contents were supplied. It confirms stale client code
against the updated CSRF-enforced endpoint, rather than a session-expiry hypothesis.
It does not establish which upstream cache rules, if any, contributed.

**Workaround versus permanent fix:** disabling the browser cache and reloading
resolved this observed submission on the existing production deployment. The
content-fingerprinted asset fix in `046dd56` is committed/pushed but **not deployed**
at this review. Successful cache-bypass submission is not evidence that fingerprinted
URLs have been deployed or verified live. Ordinary cache-enabled production navigation
remains a post-deployment check.

The exact code chain is:

1. At incident checkout `ba8289b`, `views/mypage.pug:115` selected the unchanged
   `/js/account_dashboard.js`; that loader's lines 87–89 set
   `LIFE_LOG_BASE_PATH=/mypage/api/life` and loaded unchanged `/js/my_life_log.js`.
2. The pre-redesign script at `cb9ea52^:public/js/my_life_log.js:130–136` POSTed JSON
   to that base plus `/entry` with only Content-Type/Accept, omitting the CSRF header.
3. `app.js:481–486` mounts `/mypage`; `routes/mypage.js:42–44` dispatches `/api/*`
   to the dashboard. `routes/accountDashboard.js:112` requires CSRF before the entry
   handler; its line 125 database create is never reached on rejection.
4. `middleware/sessionCsrf.js:135–147` in the repaired checkout reads the body/header
   token and rejects absent/invalid tokens with 403; the generic text is at line 61.
   The route's JSON allowlist excludes `_csrf`, so a hidden field alone cannot repair
   the intercepted JSON request. Current `public/js/my_life_log.js:11–24` sends the
   header; fetching current bytes via cache bypass allowed Lennart's save.

Synthetic missing-token requests reproduce the rejection, while the rendered current
script succeeds. Lost/mismatched sessions are separately covered negative cases, not
additional established incident causes. No deployment replica topology or CDN rules
were available in this checkout. The earlier HTTP 530 public-asset probe did not
establish browser cache behavior; Lennart's later report supplies that evidence.

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

The five fingerprinted filenames are `account_dashboard.js`, `my_life_log.js`,
`mypage_tasks.js`, `codex.js`, and `tool_manager.js`. All use
`/assets/forms/<SHA-256 of file content>/<filename>`.

## Protected-form audit

| Surface | Evidence and disposition |
| --- | --- |
| Life Log basic/medical/diary/visual/follow-up | Current header transport verified by executing rendered shell + fragment + actual scripts against real test sessions. Added fingerprinting, local token failure, input-preserving guidance, loader retry/duplicate guard and safe native method. |
| Account settings and shortcuts | `account_dashboard.js` request helper already sends header. Fingerprinted; current script requests and rejection preservation tested. |
| Task completion | `mypage_tasks.js` reads `#mypage-tasks` token and PATCHes protected `routes/mypageTasks.js`. Fingerprinted; existing gesture/route tests retain coverage. |
| Dashboard and dedicated embedding search | Both Pug forms include `_csrf`; `accountSurfaceBody` decodes URL-encoded requests before validation. Rendered native FormData posts and POST-result token verified; a legacy form without the field rejects before provider calls. No script is required for token transport. |
| Codex | `controllers/codexController.js` bootstrap token → `public/js/codex.js` mutation header → `routes/codex.js` validation. All six script references fingerprinted. Ten JS-only forms now explicitly POST; rendered form method/asset checks added to existing view coverage. |
| Tool Manager | Native seed/save/toggle/delete forms have `_csrf`. Tester config carries token into JSON header. Script fingerprinted, tester native method fixed; follow-up review adds private/no-store to its token-bearing page. Actual page controller/rendered tester execution verified with a synthetic handler, never a real tool. |
| Runpod | Native mutations in `views/admin_runpod.pug` carry `_csrf`; `runpodAdmin.js` controls selection/confirmation and disables submit buttons without disabling hidden tokens. No intercepted fetch or multipart mutation was found in these forms. Existing page and authorization tests pass. |
| Ask Lennart | Native response form carries `_csrf`; bounded form parser precedes validation. `ask_lennart.js` only manages refresh and dirty-input protection. Existing page/security tests pass. |
| Legacy `/mypage/life_log` | Gated alias checks tokens before 307 redirects on mutation. Current links point directly to `/admin/life_log`; no current form targets the alias. A previously opened legacy client without a token still fails closed. |
| Legacy Life Log import/reminders/format, ASR, bookmarks and other legacy forms | No added shared-CSRF coverage. Account fragment has neither audio nor format controls. Timeline multipart imports target the existing `/admin/life_log` router, which is outside the protected dashboard write path. No new exemptions or legacy access-control redesign. |

## Focused release review of `046dd56`

- **Fresh navigation with caching enabled:** `views/mypage.pug:10,114–115` obtains
  the Life Log child URL, task script and loader directly from the current process's
  `formAssetUrl`. `public/js/account_dashboard.js:99–110` selects that child URL.
  Neither selection depends on an old `/js/` response or query-string cache busting.
  The new integration regression retains all five synthetic stale `/js/` cache
  entries through two fresh navigations, executes actual fingerprinted loader/child
  bytes, reuses their immutable cache entries on the second navigation, and verifies
  one successful save per navigation. No old URL is requested or purged.
- **Mount/access:** `app.js:55–56` snapshots scripts and registers the helper;
  line 392 mounts the asset GET route before generic public static serving (393)
  and private `/mypage`, Codex and admin route gates. GET also handles HEAD.
  Session/Passport/layout middleware still run earlier, but no login/capability gate
  applies to this asset path. Existing optional `VUE_PATH` static middleware runs
  earlier too; it only intercepts matching files. No conflicting files/configuration
  are established here. The local asset harness tests anonymous access and static
  fallthrough ordering without importing the production application or starting jobs.
- **Content/security/cache:** only the five fixed, tracked regular public JS files
  are read at startup; request parameters never become filesystem paths. SHA-256
  hashes actual Buffer bytes, and the same Buffer is served throughout process life.
  GET/HEAD have JavaScript MIME and `public, max-age=31536000, immutable`, without a
  token or session cookie. Unknown filenames/revisions and encoded traversal,
  absolute paths, backslashes and NUL attempts in filename parameters return empty
  `404` with `no-store`. Malformed paths outside the route cannot make its handler
  read arbitrary files. An old fingerprint already cached may retain its original
  bytes; after a changed-script restart an uncached old URL returns `404/no-store`,
  never new bytes under an old immutable URL. Unchanged script hashes stay valid.
- **Private responses:** dashboard shell, fragment, read APIs and successful writes
  retain `private, no-store, max-age=0`; rejections are also non-cacheable. The cache
  regression verifies private responses are fetched anew and never put in the script
  cache. Codex and embedding routes retain their existing no-store policies. Review
  found a pre-existing omission on the Tool Manager page, which embeds a session
  token: the follow-up adds `PRIVATE_NO_STORE` in `toolManagerController.index` and
  verifies the header using its actual controller and rendered form. This is a scoped
  correction, not the Life Log incident cause; no global cache policy is changed.
- **Form preservation:** failed Life Log script loading leaves the mounted form and
  entered data in place; Refresh retries initialization, acknowledges completion,
  and avoids duplicate handlers or automatic write replay. The failed-load regression
  verifies one write after retry and no new script after successful initialization.
  Codex's ten JS form declarations (some render multiple instances) and Tool Manager's
  tester use POST; their current-page fallback targets have no matching mutation
  handler. These prevent GET query leakage, not promise draft recovery after native
  navigation. Existing native token-bearing embedding, Runpod, Ask and Tool Manager
  management forms are preserved. The duplicate guard covers repeated initialization;
  it does not add server idempotency or suppress separate deliberate submit events.

No fingerprint implementation blocker was found. The only runtime correction from
this follow-up is the Tool Manager page cache header. No production action was taken.

## Validation and limits

Follow-up release review, Node 24.20.0 via Volta: **15 suites / 182 tests** passed
with `npm test -- --runInBand --coverage=false` and the focused form, dashboard,
embedding, task, Codex, Runpod and Ask suite paths. The full
`volta run --node 24.20.0 npm test -- --runInBand` passed **257 suites / 1,984 tests**
in 48.751 seconds, with all configured coverage thresholds satisfied (67.35%
statements, 43.72% branches, 77.56% functions, 67.98% lines). `git diff --check`
passed. No dependency or OpenAPI YAML change was needed in this follow-up.

Original `046dd56` validation, Node 24.20.0 via Volta: focused validation passed
**15 suites / 180 tests**;
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

The follow-up cache regression models a fresh public-script cache keyed by URL; it
is DOM/network integration, not a real browser HTTP-cache or visual layout test.
Production has not been mutated. Existing npm audit findings are browserslist (high),
qs (moderate) and sanitize-html (moderate); their locked versions predate this dependency
addition. No unrelated audit remediation is included.

## Deployment and browser verification

1. Deploy this commit and install its lockfile using the normal deployment procedure;
   restart application processes so asset snapshots and their HTML references agree.
   Include all five allowlisted files under `public/js`. No new environment variable or
   database migration is needed. Do not use application startup as a local smoke test.
2. Preserve private/no-store bypasses for `/mypage`, its fragment/APIs and other private
   form pages. Public `/assets/forms/*` needs normal proxy route pass-through to
   Express, not a new proxy feature or mandatory configuration change. An existing
   catch-all upstream route suffices. Change configuration only if an actual static `.js` rule, path
   allowlist, rewrite or CDN rule intercepts/blocks that path. No production proxy
   configuration was inspected here. The immutable asset paths can be cached normally,
   including by caches that ignore query strings.
   Do not normalize away the hash path. No global cache disabling or routine purge of
   old script URLs is required. If the CDN previously cached private HTML against policy,
   correct that rule and purge those private page responses through normal operations.
3. Keep existing CSRF origin/proxy configuration. Do not disable checks to address this
   token failure. MemoryStore still requires requests to reach the same live process;
   restarting a process discards its sessions and logs out users whose sessions were
   stored there, even with the same session secret and an unexpired browser cookie.
   Plan for a fresh login and page after restart; this is existing behavior.
   Persistent/shared sessions, if needed by actual deployment topology, remain a
   separate scoped change.
4. Preserve unsaved entries, then re-enable browser caching (DevTools **Disable cache unchecked**)
   and open a fresh `/mypage` normally; keep old `/js/*` cache entries. In Network,
   verify `/assets/forms/<hash>/account_dashboard.js` and
   `/assets/forms/<hash>/my_life_log.js` load successfully, with JavaScript MIME.
   Check the task script too, then navigate away/back normally and verify the same
   fingerprinted URLs (a cache hit is fine), with no selection of old `/js/` loader or
   Life Log URLs. Check shell/fragment/API responses remain private/no-store.
   Submit an intentional test entry in each mode, one body-map point and one follow-up;
   confirm POST `/mypage/api/life/entry`, successful response and exactly one new entry.
   Inspect only whether `X-CSRF-Token` exists and locally matches the rendered token;
   do not copy token values, cookies, personal form fields or HAR payloads into reports.
5. Search once through each embedding form and verify native POST succeeds. Check settings,
   shortcuts and task completion with intentional changes. If CSRF still fails, report only
   the safe rejection category, route, asset revision/load status and timestamp. A
   `missing_token` with the current revision needs browser header/DOM investigation;
   `missing_session_token` or `token_mismatch` needs session continuity investigation.
