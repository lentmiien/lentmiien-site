# Experimental Models: Windows operator release

The historical first-provisioning procedure below is retained for audit only.
For the already provisioned host, use **Code-only update** immediately below. Source helper: [`scripts/deploy-experimental-models.ps1`](../scripts/deploy-experimental-models.ps1).
Default provisioning mode refuses existing folders; explicit `-UpdateOnly` validates and reuses them. Nothing in this document
has been executed against production by the source agent.

## Code-only update from c9f71aa (current handoff)

The human-confirmed live Site source is `c9f71aa7ad3ea2658ae949a535ed57194f4680c4`.
`C:\ProgramData\Lentmiien\ExperimentalModels` is already provisioned and working;
Site `.env` and the matching Gateway token were already verified. Do **not** repeat
secret entry, root creation or ACL setup. No dependencies changed relative to this
source. Human production operation only; this procedure was prepared, not executed.

This source-only update settles ordinary storage contention and browser polling,
removes the duplicate ACL subprocess for an already-existing trusted root, and
distinguishes successful actions from failed follow-up refreshes. Fresh per-operation
ACL/ancestor/symlink checks and pre/post-creation validation remain intact. Upload
decoding remains limited to one operation through the existing router admission
guard. Fake-clock 5–10 second ACL checks passed concurrent poll/submission/cleanup
and exactly-once mocked dispatch; this does not claim native Windows qualification.
See [the final latency/security check](experimental-models.md#final-windows-latencysecurity-check-2026-10-30)
for exact queue, decoding and retry bounds. The
Gateway agent separately handles OCR comma separators; coordinate that release
without changing Ming, credentials, models or quality parameters. The observed
count-box result (26 regions versus declared 31) remains a genuine invalid model
output, not an API success or a geometry repair. The existing helper requires
WeVis inspection v1 and Ming auth/ephemeral v1 through bounded passive GETs.

Drain lab requests/downloads and avoid concurrent releases. Run this single block
in elevated **Windows PowerShell 5.1**, substituting the final full Site SHA from
the handoff. It fast-forwards clean main from the observed source (or resumes from
the exact target), checks unchanged package files, then invokes the existing helper
with its existing narrow update switch. Maintenance start/end and the bounded restart
are inside that helper; do not run setup, npm start, installs or provisioning mode.

```powershell
& {
  $ErrorActionPreference = 'Stop'; Set-Location 'C:\Projects\lentmiien-site'
  $target = '<final full Site SHA>'; $old = 'c9f71aa7ad3ea2658ae949a535ed57194f4680c4'
  function g { $saved = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $r = @(& git @args 2>$null); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $saved }; if ($code -ne 0) { throw 'Git check/update failed.' }; $r }
  if ($target -cnotmatch '^[0-9a-f]{40}$' -or (g branch --show-current) -cne 'main' -or (g rev-parse HEAD) -notin @($old, $target) -or @(g status --porcelain --untracked-files=all).Count) { throw 'Unexpected source or local work.' }
  foreach ($op in @('MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply')) { if (Test-Path -LiteralPath (g rev-parse --git-path $op)) { throw 'Git operation in progress.' } }
  g fetch origin main; g merge-base --is-ancestor $target origin/main; g merge-base --is-ancestor $old $target; g merge-base --is-ancestor HEAD $target
  g diff --exit-code $old $target -- package.json package-lock.json; g merge --ff-only $target
  & .\scripts\deploy-experimental-models.ps1 -TargetCommit $target -UpdateOnly -DirectGateway
  if ($LASTEXITCODE -ne 0) { throw 'Update incomplete; follow the helper stage message.' }
}
```

Type `RELEASE` at the helper's existing restart checkpoint. UpdateOnly requires the
**existing** exact trusted root and parent, read-only ACL/location checks and the
unchanged WinSW/LocalSystem configuration. It never invokes directory creation,
ACL writes, parent changes, config edits, migrations or receipt writes. Original
provisioning receipts remain immutable. Checks repeat around the `LennartWeb`
restart: source, service configuration and active configured private root, Ming
auth/ephemeral capability, WeVis inspection capability, service Running and
`/apphealth` database ready. Boot evidence is source/time filtered; missing evidence
is reported explicitly. Maintenance ends only after successful checks. On failure,
follow the safe stage message; there is no automatic rollback, repair or blind rerun.
Windows source-contract tests do not constitute live PowerShell/NTFS qualification.

After the coordinated updates, the only remaining human browser retest is **one
image with OCR**, plus a few normal UI actions (session refresh, upload, Clear).
Ordinary short contention should settle without manual retry; a persistent failure
still shows HTTP status/code and bounded retry exhaustion. Inspect OCR as actual
model output, preserving failures and raw diagnostics when present.

Ming reference/generated-audio reuse, external upload and Clear already passed on
live `c9f71aa`; do not repeat the complete functional matrix. The historical HTTP
400 cause remains unproven; the compatibility fix worked according to the human
check and remains intact. No new secret, fence, storage provisioning, ACL change,
model inference by the helper, or dependency installation is required.

## Historical first provisioning — do not rerun on the existing root

## Before the one command block

The separate existing **Linux Gateway/Ming release must finish first**. Its candidate
builds are not evidence of a live deployment. The Windows helper never deploys,
configures, fences, rotates secrets on, or performs inference against Gateway.
It requires passive `GET /tts/ming/voices` HTTP 200 and
`GET /tts/ming/capabilities` with numeric `ephemeral_reference.version === 1`.
Neither response establishes that clone inference works.

The **existing Site `.env`** must already contain the planned private configuration:

- `MING_ADMIN_TOKEN` matches the existing Gateway secret; do not generate or rotate
  a different secret.
- Set `EXPERIMENTAL_MODELS_STORAGE_ROOT=C:/ProgramData/Lentmiien/ExperimentalModels`.
- Keep the existing HTTP(S) `AI_GATEWAY_BASE_URL` origin (default
  `http://192.168.0.20:8080`); no credentials, path, query or fragment.

For the confirmed pre-creation retry from source
`671fe61f849bcbf0f796b0211a2a141d41c73ea7`, the private edits are already complete
and both dedicated directories remain absent. The old presence guard rejected
the legitimate nonempty WinSW `PORT` even though it matched `.env`. The inspection
process's `PORT` and `VUE_PATH` also matched; this does not establish the elevated
operator's environment or which check it hit first. No provisioning, ACL changes,
maintenance or restart occurred. Retry the corrected helper below without
copying tokens, re-provisioning secrets, resuming ACL work or changing Gateway.

No `.env` copy/rewrite, secret argument, fingerprint, token output, dependency
install, Node upgrade, migration, policy change or unrelated ACL change is needed.
Keep `.env` editing finished during the release. Drain old lab requests, downloads
and sessions; keep the old store untouched. Coordinate a short release window:
Git updates source first, while the existing process keeps its loaded code until
the helper restarts **only LennartWeb**. Avoid other operator actions/browser model
requests during that window. The maintenance helper suppresses planned downtime
alerts; it is **not a request fence**.

## One copy/paste block, elevated Windows PowerShell 5.1

Use the **actual full helper commit from the handoff** as `$target`. The bootstrap
accepts only clean `main` at the original production commit, the inspected
pre-creation retry commit, or that exact target;
it fetches `origin/main`, checks containment and ancestry, then fast-forwards.
Ignored `.env` and private runtime data stay ignored. Untracked nonignored work
also stops the block. Never continue after an error or substitute reset/stash/clean.

```powershell
& {
  $ErrorActionPreference = 'Stop'; Set-Location 'C:\Projects\lentmiien-site'
  $target = '<full 40-character helper commit from the handoff>'; $old = '3ef51e3e0b4cf1c1e6e00b5706ee6a4d67ec6d73'
  $retry = '671fe61f849bcbf0f796b0211a2a141d41c73ea7'
  function g { $saved = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $r = @(& git @args 2>$null); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $saved }; if ($code -ne 0) { throw 'STOP: Git check/update failed; preserve the checkout.' }; $r }
  if ($target -cnotmatch '^[0-9a-f]{40}$' -or (g branch --show-current) -cne 'main' -or (g rev-parse HEAD) -notin @($old, $retry, $target) -or @(g status --porcelain --untracked-files=all).Count) { throw 'STOP: unexpected target, branch, HEAD or local work.' }
  foreach ($operation in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) { if (Test-Path -LiteralPath (g rev-parse --git-path $operation)) { throw 'STOP: Git operation in progress.' } }
  g fetch origin main; g merge-base --is-ancestor $target origin/main; g merge-base --is-ancestor $old $target; g merge-base --is-ancestor HEAD $target
  g diff --exit-code $old $target -- package.json package-lock.json; g merge --ff-only $target
  & .\scripts\deploy-experimental-models.ps1 -TargetCommit $target -SiteServiceName LennartWeb -DirectGateway
  if ($LASTEXITCODE -ne 0) { throw 'STOP: helper incomplete; follow its stage message. Do not restart or rerun blindly.' }
}
```

`-DirectGateway` explicitly sets Axios `proxy: false` **per diagnostic request**,
matching the Site client. This avoids an inherited inspection/dead-end proxy such
as `127.0.0.1:9` without modifying any environment setting. Omit it only when you
intend the diagnostic to use inherited proxy configuration. Local `/apphealth`
checks always connect directly to loopback and carry no authentication headers.

The helper asks for **`RELEASE`** after preflight. This approves only the two new
dedicated directories and the checked Site restart. Any other answer stops before
provisioning/service interruption (the bootstrap source fast-forward has already
happened). The helper rechecks the clean target, service configuration and private
input after this pause. It does not fetch or merge a different commit itself.

Expected success: protected storage, auth/capability `true`, service `Running`,
local `/apphealth` status `ok` / database `ready`, and maintenance ended. It never
reports browser smoke, model output or clone quality as tested.

## Exact scope and safety checks

The known starting source is `3ef51e3e0b4cf1c1e6e00b5706ee6a4d67ec6d73`;
feature `4dfcfeedd5f80947af6c2910d4aa67ef4ec66dd6` and storage override
`3ee0d7969a6dcc5fa37c5383880cfcd9e37a3c19` are ancestors of the helper.
The helper requires its own full `-TargetCommit` as HEAD on `main`, present in
`origin/main`, descending from production and the storage feature. Package and
lock files must still match production. It does not run setup or `npm start`.

It requires elevation, NTFS, the exact checkout and service, LocalSystem,
`C:\Services\LennartWeb\LennartWeb.exe` and the known sibling WinSW XML,
working directory `C:\Projects\lentmiien-site`, a direct Node/app launch and
source-pinned Node **26.13.0**. Unknown launch forms, service environment blocks,
or drift stop the helper; it never edits them. Ordinary configuration keys
(`PORT`, `VUE_PATH`, Ming token, storage root, Gateway origin and timeout) may be
inherited **only when exactly equal to an explicit entry in the Site `.env`**.
The companion uses `dotenv.parse`, never `dotenv.config`, then the existing root,
Gateway and port validators. No inferred default can justify an inherited value.
Absent entries are distinct from defined empty strings, which suppress dotenv;
empty mismatches stop, while an explicit matching empty value still undergoes
the existing validators. Root confinement and runtime ACL checks are unchanged.

Both Machine and WinSW layers must individually match, so a matching higher
priority WinSW entry cannot hide a conflicting Machine value. Duplicate WinSW
entries, missing value attributes, service expansion syntax (`%`) and any service
registry Environment block stop. The actual operator child environment is checked
separately: an operator-only mismatch yields `operator_configuration_mismatch`,
while a service mismatch yields `service_configuration_mismatch`. LocalSystem does
not use the interactive user's User environment; its effect on the operator is
covered by the actual process environment. No environment is cleared or rewritten.

`NODE_OPTIONS` and all twelve `DOTENV_*` / `DOTENV_CONFIG_*` controls remain strict
**presence** stops, including empty or matching values. PowerShell checks these
before launching Node, with `service_loader_control` / `operator_loader_control`
codes. Private service values reach the companion only over an in-memory stdin
pipe (UTF-8 JSON encoded as base64 for PowerShell 5.1 transport), never command
arguments, files, values/hashes in output, or receipts. Only a success boolean or
allowlisted error code returns. These checks run again after approval and before
maintenance. The configured Node
command's version is checked under the operator token. This is **not** a claim of
CIM inspection of the actual Node runtime, which was previously denied. No helper
installs a task/service or opens a SYSTEM shell to obtain that evidence.

The previously inspected `C:\ProgramData\Lentmiien` and its child were absent.
The helper refuses **any** existing parent/root (including reparse points), even
one with apparently acceptable ACLs. It does not adopt unknown folders or repair
ACLs. It runs the existing read-only ACL checker with `-AncestorOnly` on
`C:\ProgramData` before creation. That explicit new switch applies the checker's
existing ancestor policy to the supplied starting directory; default root checks
remain strict, including untrusted inherit-only Allows. No service-identity
parameter or relaxed root rule was added.

Each of these two components, and **only these**, is created using Windows
[`CreateDirectoryW` with `SECURITY_ATTRIBUTES`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw).
The API applies security at creation, does not create missing intermediate
components, and fails when the path already exists. A small fixed-path binding
uses the documented
[`ConvertStringSecurityDescriptorToSecurityDescriptorW`](https://learn.microsoft.com/en-us/windows/win32/api/sddl/nf-sddl-convertstringsecuritydescriptortosecuritydescriptorw)
and frees its allocation with `LocalFree`.

The descriptor is **`O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`**.
This deliberately uses the permitted **Administrators owner/group**, with the same
protected SYSTEM/Administrators-only inheritable DACL as the proposed SYSTEM-owned
`O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`. Assigning SYSTEM ownership from an
interactive admin can require token privileges; this helper changes none. Both
new directories have their own protected descriptor. Their future children inherit
only SYSTEM and Administrators grants. There is no broad-inheritance interval,
`Set-Acl`, `icacls`, ancestor modification or fallback creation API.

After each creation, the existing checker walks every ancestor and rejects
reparse points, untrusted owners, and unsafe Allows. Additional checks require
protected DACLs with exactly the two explicit full-control OI/CI grants. The
companion checks the feature's absolute-root syntax and canonical/static-mount
exclusions without initializing, migrating or sweeping either store. No private
content is written until validation passes. `C:\`, `ProgramData`, `Projects`, the
checkout, old stores and unrelated directories are never ACL-modified.

The helper invokes the existing `node scripts/maintenance.js start 60 deployment`,
then elevated `Restart-Service -Name LennartWeb` in a bounded transient operator
PowerShell job (not a Scheduled Task). Restart and subsequent Running waits are
bounded at 60 seconds each. It polls `/apphealth` for at most 120 seconds using
`.env` `PORT` or the actual `app.js` default 8080, after checking known overrides.
Invalid/ambiguous ports stop preflight; an HTTP 200 alone is insufficient without
the expected readiness JSON. It changes no WinSW settings and restarts no workers.

Normal Site startup invokes the lab sweep and the native ACL check under
**LocalSystem**. The operator validator is only a precheck. The helper reads at most
256 KiB from each of the restart/current UTC day's application logs, filters by
new runtime start time and exact source revision, and stops on lab initialization
errors. It requires at least 15 seconds of observed health so a 10-second startup ACL
subprocess failure can be reported, including after a slow service restart. No raw log record is emitted. Missing/inaccessible/truncated
logs remain unobserved, with an explicit notice. Absence of a boot error does not
prove lab initialization; browser session creation supplies that actual-context
integration check. The existing app ACL subprocess behavior is unchanged; the
operator helper neither changes execution policy nor adds an execution-policy bypass.

Two small create-new receipts (`provisioned` before interruption, `healthy` after verified health) are
stored directly under the protected **parent**, outside the lab session namespace.
They contain only source commit, deployment UTC date/time, root-provisioned boolean,
auth boolean, capability boolean, and service state. They contain no `.env`,
fingerprint, response body, prompt, audio, identity or token. A pre-restart receipt
is not evidence of completed deployment. Failures are reported through the shared
production logger using only a bounded release stage.

## Stop and recovery semantics

A `STOP: stage=...; code=...` means **do not continue or rerun blindly**. Known Node checks
also print a safe code (`ming_auth_failed`, `ming_capability_missing`,
`site_health_timeout`, `lab_boot_failed`, etc.), never an exception/provider body.

- Before creation: correct the stated prerequisite privately. Missing capability
  means finish the separate Gateway/Ming release; 401 means align the existing
  secret. A clean target checkout may run the helper again while both folders
  remain absent. Unexpected WinSW launch/override or Node version needs inspection
  and a separately reviewed change, not an automatic install/config edit.
  A contextual operator mismatch is a stop for that operator environment, not
  evidence that the LocalSystem service needs editing. Matching ordinary inherited
  configuration is preserved; loader controls never receive that exception.
- During/after creation: leave the minimal protected directories in place. A
  parent-only failure writes no private data. Inspect the printed stage and exact
  two paths explicitly before any separately reviewed resumption. The helper has
  no resume/adopt/force/cleanup mode and never overwrites existing ACLs or receipts.
- After maintenance begins: failed restart, health or observed lab boot error leaves
  maintenance **unended**, with its original 60-minute expiry. No automatic rollback,
  repeated restart or source reset occurs. Determine service/application state,
  restore verified health, then explicitly end maintenance with the existing
  `node scripts/maintenance.js end`; do not use that as a way to hide a failed release.
- If health passed but logs could not establish the boot observation, the helper
  ends maintenance for verified Site health and explicitly leaves lab initialization
  for the browser check below. It does not fabricate positive ACL/runtime evidence.

## One combined human browser check after helper success

In the existing authenticated admin browser, open **`/admin/experimental-models`**
(Tools → Administration → AI Admin → Experimental Models). In one session:

1. Confirm the page and a new private test session work; inspect safe app diagnostics
   if storage is unavailable. This tests the normal Site/LocalSystem storage context.
2. Run the intended WeVis example and inspect its output inspector; run Ming voice
   design; then run ephemeral clone with your **owned/synthetic WAV**. Review errors
   and output quality yourself. These are user browser model requests, never helper
   calls; passive capability discovery did not prove them functional.
3. Clear Session, verify previously captured private asset URLs return **404/410**,
   reload, and confirm a new session works and old assets remain unavailable.

Do not send admin cookies or private audio to this helper. Existing authentication,
capabilities, object scope and CSRF remain enforced. No programmatic admin login,
Gateway secret rotation, batch changes or global-admin changes are part of release.

## Source validation and limitations

Matching-environment compatibility fix: **122 helper tests passed**. The focused
run below passed **167 tests**, with four native Windows tests skipped, on Node
24.22.1. JavaScript syntax and `git diff --check` passed. No full-suite rerun or
production operation was performed for this helper-only change.

```sh
npm test -- tests/unit/experimentalModelsRelease.test.js tests/unit/experimentalModelsStorageConfig.test.js tests/unit/gptImageWindowsStorage.test.js --coverage=false --runInBand
```

Original validation on the source host (Node 24.22.1; no host upgrade performed):
58 helper tests passed; the focused lab/storage/maintenance run passed 403 tests,
and the shared storage/delivery follow-up passed 80. The full suite passed with
`npm test -- --maxWorkers=2 --workerIdleMemoryLimit=512MB`: **450 suites / 6,435
tests passed**, 17 suites / 261 tests skipped, configured coverage thresholds met.
The first full `--runInBand` attempt exhausted the default Node heap; it was not
counted as a passing run. JavaScript syntax and `git diff --check` passed.

The Jest companion tests use synthetic dotenv text, mocked HTTP and logs, fake
clocks and temporary CPU-only filesystem fixtures. PowerShell source contracts
check gating/order, protected creation and forbidden mutation paths. They do not
execute Windows branches or qualify actual NTFS ACLs. Windows PowerShell/pwsh is
not installed in the source environment, so native syntax/API/service execution is
**not claimed**. API signatures and atomic-creation behavior were checked against
the Microsoft references above. Real ACL enforcement and service behavior remain
the operator execution gates and normal application's checks.

Security contract: this is a local elevated operator tool, not a web feature or a
new browser authorization zone. Its machine caller uses the existing Ming secret
only for the two passive GETs. Paths/service are fixed, inputs bounded, receipts
private, and errors allowlisted. It creates no browser route and changes no feature
capability, owner scope, static delivery, retention or CSRF behavior.
