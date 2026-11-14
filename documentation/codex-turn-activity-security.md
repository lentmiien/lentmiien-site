# Codex turn activity security contract

Feature: Codex turn operational activity feed and raw-event inspector

The turn Status panel also displays the latest primary account usage remaining, derived from stored `account.rateLimits.updated` events through the same authorized activity endpoint. Only a finite percentage in the range 0–100 is exposed; account/plan/credit metadata is omitted. The gauge starts hidden, stays hidden without a valid update, and keeps the last valid percentage between updates. It uses text and numeric DOM properties, with no new requests, mutations, storage, or outbound services. Negative tests cover malformed percentages and unrelated events; the existing capability, owner-scope, and private/no-store policies apply unchanged.

Security zone: logged-in

Interactive principals: admin, family, user

Machine principals: the existing `codex-log-review-workflow` service identity may read, steer, cancel, or retry only turns that it owns. It has no admin object-scope override and no Runpod execution-provider capability.

Data classification: sensitive (prompts, model output, commands, tool results, paths, and operational errors may contain private data)

Capabilities: `codex.turn.read`, `codex.turn.cancel`, `codex.turn.retry`, and the existing `codex.turn.steer`; execution-provider capabilities remain separate

Object scope: owner. Turns are selected with `createdBy.id` from the validated principal.

Dashboard bootstrap, queue polling, recent-session lists, statistics and session
detail now use that same scope. Global workspace lock details are admin-only.
Legacy session follow-up and archive operations also enforce session ownership:
`codex.session.write` and `codex.session.archive` are separate capabilities granted
to the existing admin/family/user/codex_system bundles, with no default unknown-role
grant. Admin override is explicitly allowed for these session operations.
Archive uses an atomic scoped update. Existing POST/CSRF, request limits, private
cache handling and execution-provider checks remain in force.

This closes a mismatch where a user could receive a foreign turn in dashboard/queue
or legacy session data, then repeatedly receive an intentional 404 from its event
endpoint. It does not establish which accounts triggered historical production
404s. Client errors now preserve HTTP status; 401/403/404 stop automatic activity
polling, perform one scoped page refresh and offer a reload. Stale page data cannot
re-enable an unavailable turn. Page-level terminal errors stop page polling too.
Transient failures back off to at most 60 seconds and successful reads reset the
delay. Tests cover owner/family/admin scope, missing/foreign access, explicit grants,
archive/follow-up denial, stale open pages and transient recovery.

Admin override: yes, for turn read, raw-event read, cancel, retry, and steering. Read/cancel/retry use the centralized Codex turn owner-scope builder; steering retains its equivalent existing owner check.

Browser mutations and CSRF control: cancel, retry, and steering use POST plus the shared session CSRF middleware. Activity and raw-event reads are GET-only and side-effect free.

Public/secret abuse controls: not applicable; the `/codex` router requires an authenticated session. Steering retains its per-principal rate limit.

Request and upload limits: turn identifiers are bounded to 160 characters. Raw-event pages are capped at 250 records, nested values and arrays are bounded, and persisted event count/text limits remain enforced. There are no uploads.

Output/rendering contexts: agent Markdown is allowlist-sanitized and external links are restricted to HTTP(S). User text, command output, tool data, paths, filters, and raw JSON are inserted as text. Secret-looking values are redacted, ANSI/control sequences are stripped, structured paths are made workspace-relative, and configured workspace/home prefixes embedded in free text are removed before delivery.

Private file/media storage and delivery: no media is delivered by this feature. Event references expose workspace-relative labels only, never filesystem URLs or absolute paths.

Outbound hosts/services: none. Links already reported by Codex are validated as HTTP(S), have credentials removed, and open with `noopener noreferrer nofollow`.

Cache policy: every page and API response under `/codex` uses `Cache-Control: private, no-store` through the router middleware.

Security-relevant logs (without personal data): authorization and event-load failures use the shared logger with the capability, route, status, opaque turn id where useful, and error class. Event content, prompts, usernames, commands, and tool payloads are not logged.

Retention/deletion behavior: activity history is bounded by `CODEX_MAX_EVENTS_PER_TURN`, plus at most two latest telemetry records and one storage-cap notice. On overflow, agent/user messages, warnings, errors (including nonzero command exits), and terminal lifecycle updates replace the oldest routine record, or the oldest priority record when only priority records remain. Routine overflow is omitted. Replaced payloads are overwritten atomically; monotonic sequences allow incremental readers to follow replacements. Browser activity history is bounded to the same maximum. Raw payloads are loaded only on request and are not copied into browser storage. Display order is the only locally persisted preference.

Required negative security tests: missing capability; foreign owner; missing turn; admin override; raw payload secret/path redaction; malicious Markdown/URL; oversized structured payload; invalid CSRF for mutations; and raw pagination limits.

Legacy dependency or migration plan: existing stored events remain readable through camelCase, snake_case, and nested-payload normalization. Previously whole-payload-truncated records receive a generic readable activity row. New events use field-aware clipping and retain selected action-start records. The old raw-first turn renderer is replaced in place; the existing session-card summary continues to consume the curated endpoint.


## Long-running turn visibility

This change uses the existing logged-in, owner-scoped turn and activity reads with
the declared admin override. No routes, capabilities, mutations, or outbound
services are added. The progress response allowlists storage limits/counters and
worker/execution timestamps only; it does not expose locks, worker identities,
hosts, paths, or raw telemetry. Existing payload bounds, presentation redaction,
Markdown sanitization, and private/no-store policies remain in force.

The worker persists a heartbeat separately from execution activity. The latter
advances when a non-telemetry process event is received, including events omitted
at the storage cap; it is not advanced by steering messages or worker heartbeats.
It does not claim to measure CPU activity or unreported model work. Metadata is
flushed at the heartbeat interval, on first overflow, and on completion. Missing
legacy metadata is displayed as unavailable, never as evidence of healthy work.
A delayed heartbeat means visibility needs attention, not proof execution stopped.

Token-usage and account-rate-limit telemetry each occupy one replaceable slot.
Explicit warning/error telemetry still enters priority retention. The final response
and usage totals continue to be stored independently on the turn. Stored event
count and sequence cursor are distinct once telemetry or activity slots roll over.
The storage banner explains that older details can be replaced, so history is not
presented as a complete audit trail. A continuously open page may retain already
seen details until its bounded client history rolls over; reloads use retained data.

Deployment: restart the web process and each standalone Codex worker through the
normal deployment procedure. The additional schema fields are optional and require
no database migration or environment change. Existing running workers keep their
old behavior until restarted; previously dropped activity cannot be recovered.
Rollback accepts the additive fields and stored event shape; new turns then use
the old retention behavior. Tests cover telemetry coalescing, continued priority
updates with fixed storage, sparse cursors, heartbeat/activity independence,
missing legacy metadata, bounded payload replacements, scoped empty reads, and
existing missing-capability/foreign-owner denial.
