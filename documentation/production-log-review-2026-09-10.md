# Production log review follow-up — 2026-09-10

Workflow reference: `13fa2d6e-1f65-49ef-9179-7dda1b21a228`.

Reviewed the supplied September 3–10 report against clean checkout `8e78ba0` before editing. The report's Windows events and production records are supplied evidence, not independently reproduced in this Linux workspace. No production database, provider account, Windows service or tunnel was accessed or changed. Application startup/prestart was not used for verification.

## Finding decisions

| Finding | Current-code verification and disposition |
| --- | --- |
| MongoDB outage | The owner confirms Windows Update rebooted the PC, while Docker MongoDB and Cloudflare start at login. This is planned host availability work. `app.js` already gates traffic before database middleware, starts DB-dependent services on readiness, and resumes supported work on recovery. Preserve that behavior and existing alert policy. See the host plan below. |
| Standalone Cloudflared crashes / logged token | No Windows tunnel service definition exists in this repository. The owner's Docker tunnel and the report's crashing native service must be distinguished on the host. Express logger changes cannot sanitize Windows Event Log entries. Host investigation and rotation remain outstanding; neither public downtime nor an obsolete duplicate is established. |
| Runpod setup, cleanup and observation | Confirmed: cleanup fetched the pod before stopping, treated 404 as a failure, silently returned without a stop action, and setup logs lacked stage/exit/outcome. Cleanup now distinguishes provider absence, already inactive, stopped, stop requested and unconfirmed outcomes, with separate local-persistence status. Detail 404 requires a fresh, valid pod list before absence is recorded. Unconfirmed state retains the local deadline; pending stop confirmation schedules a near-term guard pass. State reads retry once for transient transport/408/502/503/504 failures. Mutations are not replayed by this retry helper. Observer warnings include failed tick counts/status/duration and one recovery summary. The guard still runs after observation failure and still depends on MongoDB. |
| Miien ASR admission | `41407fe` and `678fa99` are present, and `chat5-miien.md` records acceptance. No admission, provisioning, collection/index, lock or readiness repair was repeated. |
| Life Log CSRF | Current templates and dashboard loader use `formAssetUrl` and content-fingerprinted form scripts. The existing tests render the page, serve the hashed bytes, verify immutable caching and reject stale hashes. No new form fix was justified. The deployed Windows URLs with normal browser caching still need the existing deployment check; a local test is not production delivery evidence. |
| Upstream/network failures | Weather/JMA fallback and periodic refresh paths are present. ComfyUI preview already records body/header phase, upstream status and duration and excludes client disconnects. Preserve retry and streaming behavior. Add allowlisted error/cause codes, status and coarse request phase for ASR, weather/JMA and ordinary ChatGPT submission. ASR service failures are logged once across the service/controller boundary; separate controller failures remain visible. These diagnostics do not identify an ISP, DNS resolver or provider as the cause. |
| Startup and test log noise | Confirmed constructor-time TTS discovery could write diagnostics before MongoDB; API debug records now use a bounded, expiring readiness buffer without delaying discovery. The connectivity monitor restores state if MongoDB connects during probes, gives initial readiness one sampling interval of grace, and retains real observations, warning on later/persistent failure. Tests cannot write shared app log files. Runtime process/revision attribution is added. |
| Embedding failures | Confirmed pending messages without a conversation were marked failed with only a debug count. `Chat5` saves and marks messages pending before conversation attachment, so recent messages now have five minutes to attach. Older unmatched sources warn with opaque document ID, age and fixed reason only when the guarded update actually changes a record. Explicit deletion/exclusion still follows existing deletion handling. The three historical documents cannot be identified retrospectively from aggregate counts alone; no old records were reset or re-embedded. |

The embedding grace period covers recent saves; it is not a transaction across messages and conversations, nor proof of what caused the three historical events. The failure update also matches the observed text/hash and opt-in state to avoid overwriting a concurrently changed or excluded source. Missing references never authorize embedding or retrieval from an unrelated conversation.

Runpod billing synchronization already preserves successful account/pod sections when the other provider read fails, logs partial failure, and retries on its regular schedule. Existing tests cover this behavior; no billing rewrite or retrospective charge inference was justified. The `hq fail` fixture and security logger fixtures were also verified in the current tests; their production-file contamination is addressed by shared sink isolation, without changing knowledge behavior.

These are maintenance changes to existing private/internal operations. No route, capability, principal, browser mutation, provider credential or schema was added. New operational metadata excludes payloads, tokens, raw provider errors and personal content. The API-debug buffer uses the existing sanitizer and private database sink with explicit memory/time bounds.

## Planned host work

### Unattended availability

Keep the Linux migration as the long-term plan; hardware and timing are undecided. In the meantime, plan Windows update/reboot windows when someone can sign in and verify Docker, MongoDB and the intended tunnel. Automatic login is not a prerequisite or recommendation for this repair.

A container restart policy only takes effect when its Docker daemon is running. It does not remove this installation's login dependency. Verify both daemon boot and container restart separately. See [Docker's restart-policy documentation](https://docs.docker.com/engine/containers/start-containers-automatically/).

For the Linux move, configure Docker Engine, required containers and the app as boot-managed services. Preserve database volumes and validate a backup restore in isolation before cutover. If unattended Windows operation becomes necessary first, evaluate an independently booted Linux VM with the same checks; that is a separate host configuration decision, not an untested Docker Desktop startup-task change.

In an isolated outage/reboot exercise, test local `/apphealth` 503→200, application readiness gating, single incident alert/cooldown, scheduler recovery, and supported pending response/tool/webhook recovery. Check pending work by its stored IDs to avoid repeating external side effects. Repeat through the intended public tunnel and before interactive login. Existing automated recovery tests do not prove host boot ordering or every interrupted production tool outcome.

The local Runpod guard cannot enforce a deadline while this host or MongoDB is down. Before unattended rentals during host maintenance, establish provider state and stop unneeded workloads. Any independent guard must run outside this failure domain, use a scoped machine credential and confirmed pod IDs/deadlines, and re-read provider state before acting. Usage estimates and alerts are not hard spending limits. No independent guard, billing correction or paid workload was provisioned here.

### Cloudflared investigation and token rotation

1. On Windows, identify the intended connector and compare its tunnel/connector identity with Cloudflare's dashboard and the Docker installation. Record only service state, installed version and sanitized failure diagnostics. Do not export raw service command lines, container environment values or token-bearing Event Log messages.
2. Repair the native service only if it is intended. Retire it only after proving it is an unused duplicate and checking that the Docker connector serves the intended hostname. Capture the fatal diagnostic before choosing a fix; the report does not establish its cause.
3. Keep token values out of the process command line. For a compatible remotely managed connector, use a service-readable, access-restricted token file outside the repository, e.g. `cloudflared tunnel run --token-file <restricted-path>`. Confirm the installed binary supports it; Cloudflare documents support from version 2025.4.0. Verify fresh service/event logs contain no credential. [Run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/).
4. Review access to retained credential-bearing logs and rotate the affected tunnel token with the intended connector owners during a coordinated change. Refreshing a token prevents new connections with the old one but does not terminate existing connections. Follow the compromised-token procedure if unauthorized access is suspected, including connection cleanup. Verify the replacement connector and public readiness before calling rotation complete. [Cloudflare tunnel token guidance](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/).

### Deployment checks still requiring the configured host

- Verify `/mypage` loads `/assets/forms/<hash>/account_dashboard.js` and `/assets/forms/<hash>/my_life_log.js` with browser caching enabled, then save a Life Log entry with the shared CSRF header. Follow [the existing repair record](csrf-form-repair.md); preserve unsaved entries before reloading.
- After deploying these code changes, verify normal TTS voice discovery and that its debug record appears once MongoDB connects. Check that later DB failures remain actionable and the bounded debug buffer emits only its discard summary when unavailable too long.
- Reconcile Runpod provider state and billing in the configured admin workflow. A cleanup outcome describes observed lifecycle state, not a guarantee of zero storage charges or a retrospective bill adjustment.
- For a future orphan warning, inspect its opaque message ID through an authorized database/admin workflow and compare attachment/deletion history. Do not export message text into an operational issue report.

## Validation

Focused suites exercise cold-start readiness, bounded debug buffering/reconnection, file-sink isolation, Runpod cleanup/read retries/404/ambiguous stops, observer recovery, embedding attachment/deletion races, and sanitized upstream failures. Existing Miien, CSRF/fingerprinted assets, readiness and response/tool recovery tests are included in the full Jest run.

Final verification used pinned Node **24.20.0**:

- `volta run --node 24.20.0 npm test -- --runInBand`: **280 suites / 2,690 tests passed**, all configured coverage thresholds passed. Jest emitted its existing experimental VM Modules warning.
- Focused regression suites passed before the full run; the ASR controller test exercises real service error reporting with mocked transport, file and database operations.
- JavaScript syntax checks passed for all **24 changed/new JavaScript files**; `git diff --check` passed.
- File metadata captured before the full runs and compared afterward shows all **85 existing app log files** retained their original sizes and modification timestamps, with no new app log files. No log contents were read for that check.

No production reboot, browser session, credential rotation, provider/billing reconciliation or deployment was performed. Those checks remain explicitly listed above.
