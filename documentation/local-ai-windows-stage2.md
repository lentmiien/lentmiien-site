# Windows Site stage 2 — install with batching OFF

> Historical installation procedure. The current host is already human-deployed at
> `d9059a4` with acceptance/media/session support enabled. Use the
> [current runbook and completed AUTO procedure](local-ai-exclusive-sessions.md#enable-auto--minimal-human-procedure).
> AUTO was human-enabled on 2026-10-17 at approximately 23:40 JST, with authenticated
> scheduler `auto: true` confirmed after the LennartWeb restart; the console worker
> was left as-is. The first unattended night remains unverified. No repeat
> installation or further enablement action is requested.

> Current complete media release: [Site Phase 2 explanation and rollout steps](local-ai-media-release.md). This document retains the earlier stage history; use the Phase 2 runbook for registered workflows, optional-revision shared imports, output storage and rollback compatibility.

For the already initialized `059f45b` deployment with batching enabled and AUTO
off, use [manual admission recovery](local-ai-admission-recovery.md#human-windows-update-only).
That update requires neither the installation procedure below nor an initializer.

## Postdeploy correction after `9ef5833`

Explanation: the web bootstrap disables Mongoose command buffering globally and
compiles models before connecting. Local AI previously let Mongoose auto-create
collections at compilation. In that order, `Model.init()` caches a rejected
`TypeError: Cannot read properties of undefined (reading 'createCollection')`.
Every later initialization retry receives the same rejection even after a healthy
MongoDB ping. This was reproduced against disposable standalone MongoDB with the
actual bootstrap settings; the older integration harness missed the global setting.
The rejection occurs before the `scheduler` upsert and before any artifact I/O.
Existing partial indexes, valid string control IDs and majority/journaled write
concern do not repair a cached rejected promise. The normal console's ACL denial
does not establish a LocalSystem storage failure. Gateway's disabled persistence
readiness is a separate condition.

The correction disables automatic Local AI collection/index creation and explicitly
provisions them after database readiness. Failed attempts retry the real operations;
partial unique constraints are verified before removing legacy slot indexes.
Logs include code-owned operation, allowlisted reason class, numeric Mongo code,
and known system code/syscall when available, without raw exceptions or data.
Chat5 reads and validates the rendered paragraph's trimmed conversation ID; source,
settings and attachment eligibility are checked again on click. Image batch controls
also retain eligibility and in-flight guards. No accepted records/results are deleted.

Actions for the already initialized Windows host (human deployment only):

1. Keep both Site batch flags and Gateway batching OFF. Drain existing Codex work,
   stop the console worker with Ctrl+C, then stop `LennartWeb` in elevated PowerShell.
2. In `C:\Projects\lentmiien-site`, confirm a clean checkout, run
   `git pull --ff-only origin main`, and verify HEAD against the supplied hotfix hash.
   Stop on Git failure/divergence. Dependencies/lockfile did not change; no reinstall,
   environment edit, ACL rewrite, database reset, or initializer rerun is required.
3. Start `LennartWeb`, then run `npm run codex-worker` in its usual normal console.
   Use the existing WinSW launcher; do not run `npm start`, `setup.js`, or another web
   instance. Restarting the web process is necessary to load the fix and discard the
   old cached initialization failure.
4. With both flags still OFF, check database readiness and the read-only scheduler
   endpoint: a persisted `scheduler` record and advancing lease/fence should appear.
   Check that initialization errors stop. Hard-refresh Chat5/image pages to load the
   corrected scripts; buttons should remain disabled while submissions are OFF.
   If failure remains, retain the new sanitized diagnostic fields for investigation.
   Never clear a lease or accepted history to make this check pass.

Validation uses Node 24.20.0, real standalone MongoDB and actual bootstrap worker
startup/retry, plus rendered Pug/DOM tests and a network-intercepted Chromium click
test. Windows paths, process identity and skipped directory fsync are unit-tested;
real Windows LocalSystem ACL/file flush behavior still needs human verification
during the separately authorized canary. No production action was performed for
this correction. The original stage-2 installation procedure below is retained for
new installations; its earlier clean-review statement predates this discovered bug.

## Explanation

Operator-confirmed starting state: Gateway stage 1 PASS at integrated release
`dffccc9029313cd1886fbbda8383beb19170c309`, immutable release ready, batch v1 OFF,
installed pilot/original embedding space retained, no GPU job. Site Windows build
26300 uses Node 24.20.0 (the repository's pinned version), clean `main` at `01c1317`,
checkout `C:\Projects\lentmiien-site`. Site release `192565089a51ab038c5ffd7de902702808e96fb2`
was already committed and pushed to `main`, but not deployed; the stage 2 helper is
a later commit on that same branch. Use the latest pushed helper commit supplied
with this handoff. There is no dev-branch-only prerequisite.

`LennartWeb` runs `app.js` directly as LocalSystem; its WinSW XML is
`C:\Services\LennartWeb\LennartWeb.xml`. The standalone Codex worker runs in a
console under the interactive Windows user, confirmed by Lennart. Stop that console
with Ctrl+C after jobs drain; restart with `npm run codex-worker`. No task name or
service wrapper is needed. The [README](../README.md#codex-worker-split-on-windows)
documents the same worker command, but its Scheduled Task example is not this
host's actual launcher. Keep `CODEX_WEB_WORKER_ENABLED=false` and the standalone
worker's `CODEX_WORKER_ENABLED=true` (or unset).

All three entry points (web, worker, initializer) load `.env` from the working
directory without overriding inherited values. Privately align effective values
with the service before running the initializer; a normal admin console does not
inherit WinSW-specific overrides. In particular, use the service's actual
`MONGOOSE_URL`; do not print it or copy it into shell history. No new database
credential is needed if its existing account has read/write and create/list/drop
index privileges. [Initializer details](durable-local-ai.md#configuration-and-setup)
cover exact-name authorization and the rerunnable index migration. Initialization
does not start app.js, setup.js, a worker, Gateway requests, or GPU work, and does
not create or probe the artifact directory.

The initializer creates the replacement partial unique admission indexes before
dropping legacy slot indexes, then repairs safely terminal admission slots without
deleting history. Successful completion verifies these operations; no MongoDB ID
or database client is needed. A nonzero exit means stop and investigate the safe
error code. Do not restart against an incomplete migration or revert blindly to
old admission code after migration.

Windows image writes flush the file and skip unsupported directory fsync. POSIX
`0700`/`0600` modes do **not** establish private Windows ACLs. The observed
`private_data` parent grants Authenticated Users Modify, so this procedure uses
a separate restricted directory under ProgramData. Only LocalSystem imports/serves
batch artifacts; the console Codex worker does not need artifact-directory access.
Verify that the directory and parent chain are ordinary directories, not reparse
points, and cannot be replaced by untrusted local users. Retain the existing
`private_data` permissions for other features; do not recursively rewrite them.
If the dedicated destination already exists, preserve its contents and review its
explicit ACLs rather than treating it as a fresh directory.

No fatal Windows mismatch was found for this OFF-only stage. The coordinator can
recover on the same host after its 90-second lease expires **only when the old PID
is gone**. Windows has no Linux start-identity check: a reused/live/inaccessible PID
blocks takeover. Windows Codex process-tree termination also requires explicit
operator proof once batching is enabled. These are later enablement limitations,
not reasons to clear leases or run recovery commands during stage 2. Disabled
batching still permits reconciliation of existing accepted work; it is not a
universal pause switch for other Site schedulers or Codex jobs.

## Human steps — stage 2 only

Use elevated PowerShell for the service/install steps. Stop on any error.

1. Hold new submissions and let existing Codex and Gateway work finish, including
   child/remote agents. In the worker console press **Ctrl+C** and wait for it to
   exit. Stop the web service:

   ```powershell
   $ErrorActionPreference = 'Stop'
   Stop-Service -Name 'LennartWeb'
   (Get-Service -Name 'LennartWeb').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
   ```

   With writers stopped, take/confirm a recoverable backup of Site MongoDB and
   private media using the existing backup procedure. Preserve `.env` and WinSW
   XML privately; retain the Gateway stage 1 data backup. Do not run `setup.js` as
   a backup command. Record Site's old revision before updating.

2. Pull the pushed release and install:

   ```powershell
   Set-Location 'C:\Projects\lentmiien-site'
   git status --short
   git branch --show-current
   git rev-parse HEAD
   ```

   Expect clean `main` at the recorded old revision. Then:

   ```powershell
   git pull --ff-only origin main
   if ($LASTEXITCODE -ne 0) { throw 'Git update failed' }
   git rev-parse HEAD
   npm ci
   if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
   ```

   Confirm HEAD is the pushed helper release supplied with the handoff. Do not
   reset/force a divergent checkout. Do not use `npm start`.

3. Privately edit `C:\Projects\lentmiien-site\.env` and any effective inherited
   overrides to agree for web, worker, and initializer:

   ```dotenv
   LOCAL_AI_BATCH_ENABLED=false
   LOCAL_AI_BATCH_AUTO_DISPATCH=false
   BATCH_CLIENT_ID=lentmiien-site
   BATCH_SERVER_TOKEN=<copy the actual dedicated Gateway secret privately>
   LOCAL_AI_BATCH_DATA_DIR=C:/ProgramData/LennartWebLocalAI
   CODEX_WEB_WORKER_ENABLED=false
   CODEX_WORKER_ENABLED=true
   ```

   Keep `AI_GATEWAY_BASE_URL` at the confirmed Gateway HTTP origin (code default
   `http://192.168.0.20:8080`); if explicitly configured, use that actual origin,
   with no credentials/path/query. Copy the actual Gateway `BATCH_CLIENT_ID` and
   `BATCH_SERVER_TOKEN`: the confirmed ID is `lentmiien-site`, **not** the obsolete
   `site-local-ai` example. The token must be at least 32 characters; do not invent
   another secret or paste it into chat/commands. Leave Gateway stage 1 settings,
   including `BATCH_ENABLED=false`, unchanged.

   For the **new** dedicated output directory:

   ```powershell
   New-Item -ItemType Directory -Path 'C:\ProgramData\LennartWebLocalAI'
   icacls 'C:\ProgramData\LennartWebLocalAI' /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
   if ($LASTEXITCODE -ne 0) { throw 'Private directory ACL setup failed' }
   icacls 'C:\ProgramData\LennartWebLocalAI'
   ```

   Expect SYSTEM and local Administrators full control, without broad Users or
   Authenticated Users access. The SIDs avoid localized Windows group-name issues.
   Include this directory in future private-media backups.

4. Initialize with the same username you enter on the **Site login page** for your
   admin account. This is not your Windows login, email, password, or MongoDB ID.
   If unsure, check the username in your saved Site login locally. Do not share it.

   ```powershell
   $adminLogin = Read-Host 'Exact Site admin login name'
   node scripts/local-ai-admin.js initialize-by-name "$adminLogin"
   if ($LASTEXITCODE -ne 0) { throw 'Local AI initialization failed; leave services stopped' }
   Remove-Variable adminLogin
   ```

   Expect: `Local AI indexes ready; safe terminal admission slots reconciled; all history retained.`
   No extra capability grants or machine-token issuance are needed for this admin
   verification stage.

5. Start the web service:

   ```powershell
   Start-Service -Name 'LennartWeb'
   (Get-Service -Name 'LennartWeb').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
   ```

   In the original normal-user worker console, restart exactly one worker:

   ```powershell
   Set-Location 'C:\Projects\lentmiien-site'
   npm run codex-worker
   ```

6. Check `/apphealth` reports healthy/database ready. Log in to Site as admin and
   open `/local-ai/queue`. Expect **“New submissions disabled; reconciliation
   remains active.”** The read-only `/local-ai/api/v1/scheduler` should show
   `enabled: false`, `auto: false`, and no active run. Review production `local_ai`
   logs for initialization/storage failures; confirm one standalone worker started
   and no embedded Codex worker. Report PASS plus the deployed commit, or the safe
   failure code. Do not paste account IDs, tokens, raw environment or private logs.

Stop here. No enabling flags, synthetic submissions, canary, or GPU job in stage 2.

## Development verification

Linux, Node 24.20.0: initializer unit tests passed (24 tests); the focused local-AI
run passed 7 suites / 84 tests with disposable MongoDB 8 and a fake HTTP Gateway.
The full suite passed 393 suites / 5,093 tests and configured coverage thresholds;
8 suites / 122 tests were skipped by their existing conditions. This is source/test
evidence, not Windows execution or production deployment evidence.
