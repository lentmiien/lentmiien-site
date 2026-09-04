# Codex turn activity security contract

Feature: Codex turn operational activity feed and raw-event inspector

Security zone: logged-in

Interactive principals: admin, family, user

Machine principals: the existing `codex-log-review-workflow` service identity may read, steer, cancel, or retry only turns that it owns. It has no admin object-scope override and no Runpod execution-provider capability.

Data classification: sensitive (prompts, model output, commands, tool results, paths, and operational errors may contain private data)

Capabilities: `codex.turn.read`, `codex.turn.cancel`, `codex.turn.retry`, and the existing `codex.turn.steer`; execution-provider capabilities remain separate

Object scope: owner. Turns are selected with `createdBy.id` from the validated principal.

Admin override: yes, for turn read, raw-event read, cancel, retry, and steering. Read/cancel/retry use the centralized Codex turn owner-scope builder; steering retains its equivalent existing owner check.

Browser mutations and CSRF control: cancel, retry, and steering use POST plus the shared session CSRF middleware. Activity and raw-event reads are GET-only and side-effect free.

Public/secret abuse controls: not applicable; the `/codex` router requires an authenticated session. Steering retains its per-principal rate limit.

Request and upload limits: turn identifiers are bounded to 160 characters. Raw-event pages are capped at 250 records, nested values and arrays are bounded, and persisted event count/text limits remain enforced. There are no uploads.

Output/rendering contexts: agent Markdown is allowlist-sanitized and external links are restricted to HTTP(S). User text, command output, tool data, paths, filters, and raw JSON are inserted as text. Secret-looking values are redacted, ANSI/control sequences are stripped, structured paths are made workspace-relative, and configured workspace/home prefixes embedded in free text are removed before delivery.

Private file/media storage and delivery: no media is delivered by this feature. Event references expose workspace-relative labels only, never filesystem URLs or absolute paths.

Outbound hosts/services: none. Links already reported by Codex are validated as HTTP(S), have credentials removed, and open with `noopener noreferrer nofollow`.

Cache policy: every page and API response under `/codex` uses `Cache-Control: private, no-store` through the router middleware.

Security-relevant logs (without personal data): authorization and event-load failures use the shared logger with the capability, route, status, opaque turn id where useful, and error class. Event content, prompts, usernames, commands, and tool payloads are not logged.

Retention/deletion behavior: this rebuild does not change the existing bounded Codex event retention. Raw payloads are loaded only on request and are not copied into browser storage. Display order is the only locally persisted preference.

Required negative security tests: missing capability; foreign owner; missing turn; admin override; raw payload secret/path redaction; malicious Markdown/URL; oversized structured payload; invalid CSRF for mutations; and raw pagination limits.

Legacy dependency or migration plan: existing stored events remain readable through camelCase, snake_case, and nested-payload normalization. Previously whole-payload-truncated records receive a generic readable activity row. New events use field-aware clipping and retain selected action-start records. The old raw-first turn renderer is replaced in place; the existing session-card summary continues to consume the curated endpoint.
