# Basic Security Audit - 2026-06-27

## Scope

This was a basic static/security posture review of the Express + Socket.IO app. I focused on public entry points, authentication/session handling, route authorization, file/upload handling, dependency advisories, and obvious secret leakage. This is not a full penetration test.

Context considered: this is a personal web app, most functionality is behind login, and the intentionally public surface is limited. Findings below are prioritized with that in mind.

## Summary

Original high-priority items:

1. Legacy password reset/create flow can let the first login attempt set an account password. Fixed.
2. Production dependencies had known high-severity advisories. Fixed for production high/critical advisories.
3. Hidden/public telemetry endpoints rely on URL secrecy and can be abused if discovered. Partially fixed with rate limiting; token authentication remains open.
4. Login and public write endpoints had no throttling. Fixed for login, public to-buy writes, and hidden telemetry endpoints.

Original medium-priority items:

1. No CSRF protection, and several authenticated destructive actions use GET. Still open; session `sameSite` is now explicit.
2. Session cookies/session storage used default production-weak settings. Partially fixed; cookie settings are explicit, but MemoryStore remains.
3. GitHub file browser accepted unvalidated repo/path input. Fixed.
4. A single broad bearer key can access many `/api` actions. Still open.
5. Several authenticated upload routes had no explicit file size/count/type limits. Fixed for the older unbounded routes identified below; MIME/type filters should still be normalized route by route.

Current dependency audit:

1. `npm audit --omit=dev --json` now reports 0 critical, 0 high, and 2 moderate production advisories.
2. Remaining production advisory path is `exceljs -> uuid`. npm's suggested fix is a breaking downgrade to `exceljs@3.4.0`, so it was left as residual risk.
3. Full `npm audit --json` reports dev-only Jest/coverage-tooling moderate advisories; npm's fix is a breaking downgrade to `jest@25.0.0`, so it was not applied.

Good observations from the original audit:

1. `.env` is not tracked by git.
2. A targeted regex scan did not find obvious committed API keys, private keys, GitHub PATs, OpenAI keys, or MongoDB credentials.
3. Most feature routes are mounted behind `isAuthenticated` plus role checks in `app.js`.
4. OpenAI webhooks use signature verification before processing.

## Remediation Update - 2026-06-27

Changes made after the audit:

1. Updated significantly outdated/vulnerable packages, including `axios`, `body-parser`, `express`, `express-session`, `form-data`, `mongoose`, `simple-git`, `socket.io`, `ws`, `openai`, `pug`, `sanitize-html`, `yaml`, `fast-xml-parser`, `googleapis`, `mailgun.js`, and `jest`. Added `helmet` and `express-rate-limit`.
2. Removed first-login password setup from the login path. Accounts without a valid bcrypt hash are rejected at login and must be reset by the admin.
3. Changed user creation and password reset to generate a temporary random password, store only its bcrypt hash, and show the temporary password once in the admin UI.
4. Added `helmet`, disabled `X-Powered-By`, added explicit session cookie options, and configured production trust proxy handling.
5. Added rate limits for `/login`, hidden telemetry endpoints, and public to-buy write endpoints.
6. Applied the public to-buy write quota to reward submissions.
7. Added repo/path validation to the GitHub browser so reads and Git operations stay inside `github-repos`.
8. Added upload file size/count limits to the older unbounded upload routes identified in the audit.
9. Redacted common sensitive request headers/body fields in the public dummy shipping API debug logs.
10. Added/updated tests for GitHub path rejection and public reward throttling.

Verification:

1. `node -c` syntax checks passed for the changed server/controller/route files.
2. Targeted Jest suites passed for GitHub service, public to-buy controller, and JMA XML parsing. The targeted command fails only at global coverage thresholds when run against a subset.
3. Full test command passed: `npm test -- --runInBand` ran 59 suites and 374 tests successfully.
4. I did not start the live app server because `app.js` imports `database.js` and starts schedulers at module load, which would connect to the configured MongoDB and run background startup work.

## Findings

### HIGH - First-login password takeover for reset/new users

Status: Fixed.

Current code:

- `app.js:167-175` rejects accounts that do not have a valid bcrypt hash instead of hashing the submitted login password.
- `controllers/admincontroller.js:299-313` resets a password by generating a random temporary password and storing only its bcrypt hash.
- `controllers/admincontroller.js:327-358` creates users with a generated temporary password and a bcrypt hash.
- `public/js/manage_users.js:25-35` shows the temporary password once in a copyable browser prompt.

Evidence:

- `app.js:95-99` hashes the submitted login password whenever `user.hash_password.length === 1`, before any password verification.
- `controllers/admincontroller.js:284-292` resets a user's password by setting `hash_password = "0"`.
- `controllers/admincontroller.js:307-318` creates new users with `hash_password: "0"`.

Impact:

If any account is in the `"0"` reset/new-user state, anyone who knows or guesses the username can submit any password once. The app will hash that submitted password and save it as the account's new password, then the same login succeeds. This is especially risky because `/login` is public.

Recommendation:

- Remove the `hash_password.length === 1` auto-migration behavior from the public login path.
- For password resets, generate a random one-time token or set a temporary password directly in the admin action.
- Store only bcrypt hashes in `hash_password`.
- Add a one-time script/admin action to migrate any existing `"0"` users to a safe reset-token state.

### HIGH - Known vulnerable production dependencies

Status: Mostly fixed.

Current code/package state:

- `package.json:35-73` now pins the updated direct dependency ranges and adds `helmet` and `express-rate-limit`.
- `npm audit --omit=dev --json` now reports 0 high/critical production advisories and 2 moderate production advisories.
- Remaining production advisory is `exceljs -> uuid`; npm's available fix is a breaking downgrade to `exceljs@3.4.0`.

Evidence:

- Command run: `npm audit --omit=dev --json`
- Result: 21 production vulnerabilities: 6 high, 15 moderate.
- Installed versions checked from `package-lock.json`/runtime:
  - `axios@1.14.0` - high advisories, including SSRF/prototype-pollution related issues.
  - `mongoose@8.19.1` - high advisory for improper `$nor` sanitization in `sanitizeFilter`.
  - `simple-git@3.33.0` - high RCE advisory, fixed in later versions.
  - `ws@8.18.3` - high memory-exhaustion DoS advisory.
  - `form-data@4.0.5` - high CRLF injection advisory.
  - `tmp` transitive dependency - high path traversal advisory.

Impact:

The most relevant risks for this app are DoS, request/credential handling bugs in HTTP clients, NoSQL injection hardening gaps, and `simple-git` command execution exposure. These risks are amplified by features that call external services, use WebSockets, and perform Git operations.

Recommendation:

- Run a focused dependency update branch and re-run tests:
  - `npm update axios mongoose simple-git ws form-data express body-parser`
  - Then re-run `npm audit --omit=dev`.
- Review semver-major suggestions separately, especially `googleapis`, `fast-xml-parser`, and `exceljs`.
- Consider adding an audit check to CI or a scheduled maintenance task.

### HIGH - Hidden public telemetry endpoints rely on secrecy, not authentication

Status: Partially fixed.

Current code:

- `app.js:92-97` defines a hidden telemetry rate limiter.
- `app.js:141-154` applies that limiter to request counter, device usage, and minute logger hidden endpoints.

Residual risk:

- These endpoints still rely on hidden URLs rather than per-device bearer tokens. Add shared-secret/token validation before considering this fully fixed.

Evidence:

- `app.js:69-82` mounts public hidden request counter, device usage, and minute logger endpoints.
- `routes/minute_logger.js:6` accepts public `POST /`.
- `services/minuteLoggerService.js:1880-1898` persists IPs, user agent, referrer, device ID, package name, location, battery fields, query, and body.
- `services/minuteLoggerService.js:1951-1977` creates a raw request record and increments stats.
- `routes/device_usage.js:6-8` accepts public GET/POST checks.
- `routes/request_counter.js:6-7` accepts public status/check requests.

Impact:

The random path reduces casual discovery, but anyone who obtains the URL can inject or poison activity/location/device data, fill storage, and influence dashboard decisions. The minute logger is the most sensitive because it accepts location telemetry.

Recommendation:

- Add a shared secret to these device-originated endpoints, for example `Authorization: Bearer <MINUTE_LOGGER_TOKEN>`.
- Keep the hidden path, but treat it only as defense-in-depth.
- Add per-IP and per-token rate limits.
- Reject records missing the expected token before parsing/storing telemetry.
- Consider rotating existing hidden paths if they may have been exposed in logs, browser history, referrers, or screenshots.

### MEDIUM - Public to-buy page exposes private status and has an unthrottled reward write

Status: Partially fixed.

Current code:

- `app.js:84-90` and `app.js:401` apply a public write rate limiter to the public to-buy route mount.
- `controllers/publicTobuyListController.js:390-411` now applies the existing public add quota before writing rewards.

Residual risk:

- The hidden page can still disclose household/device status if the URL leaks.

Evidence:

- `app.js:324` mounts the public to-buy page at a hidden path.
- `controllers/publicTobuyListController.js:268-299` renders open tasks, device usage stats, today's cooking calendar, and last known location.
- `controllers/publicTobuyListController.js:210-220` fetches last known location from minute logger data.
- `routes/public_tobuy_list.js:7-8` exposes public reward and task POST routes.
- `controllers/publicTobuyListController.js:333-344` rate-limits adding tasks.
- `controllers/publicTobuyListController.js:390-398` adds rewards without consuming the same quota.

Impact:

If the hidden page URL leaks, it discloses household/device status and approximate location labels. The reward endpoint can also be spammed to pollute reward data.

Recommendation:

- Require a lightweight shared secret or PIN for writes.
- Apply the existing quota to `/rewards` as well as task adds.
- Consider hiding location/device sections unless a separate view token is present.

### MEDIUM - No rate limiting on login or public write endpoints

Status: Fixed for the routes called out in the immediate fix.

Current code:

- `app.js:76-82` defines the login limiter.
- `app.js:446-453` applies the login limiter to `POST /login`.
- `app.js:84-97`, `app.js:141-154`, and `app.js:401` limit public writes and hidden telemetry.

Evidence:

- `app.js:369-375` exposes public `POST /login` with Passport local auth.
- No `express-rate-limit`, account lockout, or similar throttling was found.
- Public write endpoints include `/login`, dummy/debug APIs, hidden telemetry endpoints, and the public to-buy write routes.

Impact:

The login route can be brute-forced. Public write endpoints can be used for storage noise, log noise, and resource consumption. This matters more because the app has a single valuable owner account.

Recommendation:

- Add `express-rate-limit` for `/login` with a strict per-IP limit.
- Add stricter limits to hidden telemetry and public write endpoints.
- Consider alerting on repeated failed login attempts.

### MEDIUM - Single broad API key grants access to many unrelated actions

Status: Open.

Evidence:

- `app.js:325` mounts all `/api` routes behind `isAuthenticated`.
- `app.js:405-412` allows any `/api` request with `Authorization: Bearer <API_KEY>`.
- `routes/api.js:34-76` includes health writes, message inbox writes, chat actions, task creation, audio upload, exchange-rate updates, and other endpoints under the same `/api` bearer-key gate.
- `controllers/apicontroller.js:161-164` allows API-key chat calls to select a user via `req.query.name`.
- `controllers/apicontroller.js:298-303` allows task creation with `userId` from the request body, defaulting to `Lennart`.

Impact:

If `API_KEY` leaks from a client device, automation script, logs, or browser history, it becomes a broad write/read token for unrelated personal data and actions. Because the key is global, rotation affects every integration at once.

Recommendation:

- Split API keys by integration and capability.
- Store hashed API keys with metadata such as name, scope, created date, last used date, and revocation status.
- Do not accept arbitrary `name`/`userId` request parameters unless the authenticated key is explicitly allowed to act for that user.
- Add rate limits and audit logs per API key.

### MEDIUM - No CSRF protection; several destructive actions use GET

Status: Partially fixed.

Current code:

- `app.js:105-109` now sets explicit session cookie options, including `sameSite`.

Residual risk:

- CSRF tokens are still not implemented, and the destructive GET routes listed below still need to be converted.

Evidence:

- No CSRF middleware or token validation was found.
- The session cookie is created in `app.js:35-39` without explicit `sameSite`.
- State-changing GET examples:
  - `routes/budget.js:18` deletes a budget entry.
  - `routes/budget.js:24` deletes all test data.
  - `routes/accounting.js:12` deletes an accounting entry.
  - `routes/chat4.js:31`, `routes/chat4.js:44`, `routes/chat4.js:66` delete conversations/knowledge/batch prompts.
  - `routes/gptdocument.js:19` deletes a document.
  - `routes/mypage.js:37` deletes a blog post.
  - `routes/mypage.js:53` pulls a Git repo.
  - `routes/admin.js:219` deletes a log file.
  - `routes/receipt.js:32` deletes a receipt.

Impact:

If you are logged in and visit a malicious page, that page can potentially trigger authenticated GETs via links/images/forms. POST/DELETE routes are also exposed to CSRF unless browser SameSite behavior happens to block them.

Recommendation:

- Convert destructive GET routes to POST/DELETE.
- Add CSRF tokens to authenticated HTML forms and state-changing routes.
- Set session cookies with explicit `sameSite: 'lax'` or `'strict'`.

### MEDIUM - Session configuration uses production-weak defaults

Status: Partially fixed.

Current code:

- `app.js:64-68` configures trust proxy handling in production.
- `app.js:100-111` sets an explicit session cookie name, `httpOnly`, `sameSite`, `secure`, and `maxAge`.

Residual risk:

- The app still uses the default in-memory session store. Move to a persistent store such as `connect-mongo` before treating this as fully fixed.

Evidence:

- `app.js:35-39` configures `express-session` with only `secret`, `resave`, and `saveUninitialized`.
- No explicit `cookie.secure`, `cookie.sameSite`, `cookie.maxAge`, session name, or persistent store is configured.
- No `app.set('trust proxy', 1)` was found, which is normally needed when secure cookies are set behind a reverse proxy.

Impact:

The default MemoryStore is not intended for production and can leak memory over time. Cookie defaults are weaker than they need to be for a public HTTPS app. Missing `sameSite` also worsens CSRF exposure.

Recommendation:

- Use a persistent session store such as `connect-mongo`.
- Configure cookies explicitly:
  - `httpOnly: true`
  - `secure: true` in production
  - `sameSite: 'lax'` or `'strict'`
  - `maxAge` with a reasonable lifetime
- Set `app.set('trust proxy', 1)` if TLS terminates at a proxy.
- Consider changing the default cookie name from `connect.sid`.

### MEDIUM - GitHub repo browser accepts unvalidated repo/path input

Status: Fixed for repo names and file paths.

Current code:

- `services/githubService.js:15-48` validates repo names and confines resolved paths to the `github-repos` directory.
- `services/githubService.js:137-178` uses the safe repo/file helpers for clone, pull, and file reads.
- `tests/unit/githubService.test.js` covers path traversal rejection.

Evidence:

- `controllers/mypagecontroller.js:584-594` passes `req.query.repo` and `req.query.path` directly to `GitHubService`.
- `services/githubService.js:101-105` builds `repoDir` from `path.join(tempDir, repoName)` and clones using the same `repoName`.
- `services/githubService.js:118-123` runs `git.pull('origin', branch)` in a repo path derived from user input.
- `services/githubService.js:130-140` reads files from `path.join(tempDir, repoName, filePath)` and allows several text extensions.

Impact:

This is behind login, but it can still widen the impact of CSRF, XSS, or a stolen session. A crafted `repo`/`path` can escape the intended `github-repos` directory for listing/reading text files with allowed extensions, and can run Git operations in unexpected directories.

Recommendation:

- Only allow repo names returned by `getRepoList()`.
- Validate repo names with a strict pattern such as `/^[A-Za-z0-9._-]+$/`.
- Resolve paths with `path.resolve()` and reject anything where `path.relative(repoDir, resolvedPath)` starts with `..` or is absolute.
- Restrict branch names to known branches from Git or a safe pattern.

### MEDIUM - Several upload routes lack explicit file limits/type checks

Status: Fixed for the unbounded routes identified here.

Current code:

- `routes/chat4.js:6-24`, `routes/chat5.js:6-24`, and `routes/receipt.js:6-24` now cap uploads at 25 MB per file and 10 files.
- `routes/mypage.js:5-11` caps PDF conversion uploads at 25 MB and 1 file.
- `routes/openai.js:5-11` caps JSON uploads at 5 MB and 1 file.
- `routes/accounting.js:8-14` caps memory CSV imports at 10 MB and 1 file.

Residual risk:

- Some of these routes still need route-specific MIME/type filters.

Evidence:

Routes with limits exist, for example OCR and temp files. Older routes do not consistently set limits:

- `routes/chat4.js:16` uses `multer({ storage })` with no limits for image/audio uploads.
- `routes/chat5.js:16` uses `multer({ storage })` with no limits for image/PDF uploads.
- `routes/receipt.js:16` uses `multer({ storage })` with no limits for receipt uploads.
- `routes/mypage.js:5` uses `multer({ dest: './tmp_data/' })` with no limits for PDF conversion.
- `routes/openai.js:5` uses `multer({ dest: './tmp_data/' })` with no limits for JSON uploads.
- `routes/accounting.js:8` uses memory storage without a file size limit for credit-card CSV import.

Impact:

An authenticated request can consume disk or memory with large uploads. Without file filters, routes may process unexpected file types. The risk is lower because these are behind login, but it is still an avoidable availability issue.

Recommendation:

- Add `limits.fileSize`, `limits.files`, and route-specific `fileFilter` everywhere.
- Prefer disk storage for large uploads and memory storage only for small known-size files.
- Clean up temp files in `finally` blocks after processing.

### LOW - Missing common HTTP hardening headers

Status: Fixed at the basic-header level.

Current code:

- `app.js:70-74` disables `X-Powered-By` and enables `helmet` with CSP disabled for compatibility with existing inline/external assets.

Evidence:

- No `helmet` middleware was found.
- No `app.disable('x-powered-by')` was found.
- Static files are served publicly from `public/` in `app.js:262-263`.

Impact:

This does not create a direct bug by itself, but missing headers leave avoidable browser-side protections unused, especially on the public page and any HTML uploaded/published under `public/html`.

Recommendation:

- Add `helmet`.
- Start with conservative defaults, then tune CSP for existing external scripts/fonts.
- Disable `X-Powered-By`.

### LOW - Public dummy/mock APIs log full headers and bodies

Status: Partially fixed.

Current code:

- `controllers/dummyapicontroller.js:10-50` redacts common credential keys in headers and request payloads before debug logging.

Residual risk:

- `dummy_debug_api` request snapshot logging still stores broad request details when enabled and should get the same redaction treatment or be gated when not actively testing.

Evidence:

- `app.js:323`, `app.js:326-327` mount dummy/debug API routes without authentication.
- `routes/dummy_debug_api.js:82-110` exposes `/ok` and FileMaker-style dummy endpoints.
- `services/dummyApiLogService.js:146-164` snapshots headers, params, query, body, multipart metadata, IP, and referrer.
- `services/dummyApiLogService.js:227-245` persists those snapshots when logging is enabled.
- `controllers/dummyapicontroller.js:11-44` logs request headers and request data for public dummy API calls.

Impact:

These are mock/test endpoints, but public request bodies and headers may include credentials from clients that mistakenly point real integrations at the mock URLs. They can also add log noise.

Recommendation:

- Gate dummy endpoints behind an env flag or admin auth when not actively testing.
- Redact `authorization`, cookies, API keys, and known credential fields before logging.
- Add rate limits.

## Suggested Fix Order

1. Fix the password reset/new-user flow immediately.
2. Update high-risk production dependencies and re-run tests.
3. Add rate limiting to `/login` and public write endpoints.
4. Add tokens to hidden telemetry endpoints.
5. Add CSRF protection and convert destructive GET routes.
6. Harden session cookies and session storage.
7. Split and scope the `/api` bearer key.
8. Lock down GitHub browser path handling.
9. Normalize upload limits and file filters.
10. Add Helmet and redact dummy API logs.

## Commands Run

```bash
npm audit --omit=dev --json
npm update axios body-parser express express-session form-data mongoose simple-git socket.io ws openai pug sanitize-html yaml jest mailgun.js
npm audit fix --omit=dev
npm install axios@^1.18.1 body-parser@^1.20.5 express@^4.22.2 express-session@^1.19.0 form-data@^4.0.6 mongoose@^8.24.1 simple-git@^3.36.0 socket.io@^4.8.3 ws@^8.21.0 openai@^6.45.0 pug@^3.0.4 sanitize-html@^2.17.5 yaml@^2.9.0 mailgun.js@^12.9.0 fast-xml-parser@^5.9.3 googleapis@^173.0.0 helmet express-rate-limit
npm install --save-dev jest@^30.4.2
npm audit fix
node -c app.js && node -c controllers/admincontroller.js && node -c services/githubService.js && node -c controllers/publicTobuyListController.js && node -c controllers/dummyapicontroller.js && node -c routes/chat4.js && node -c routes/chat5.js && node -c routes/receipt.js && node -c routes/mypage.js && node -c routes/openai.js && node -c routes/accounting.js
npm test -- --runInBand
node -e "const names=['axios','mongoose','simple-git','ws','form-data','express','body-parser','multer','passport','express-session']; ..."
rg -n "(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|mongodb(\\+srv)?://[^\\s'\\\"]+:[^\\s'\\\"]+@)" ...
```
