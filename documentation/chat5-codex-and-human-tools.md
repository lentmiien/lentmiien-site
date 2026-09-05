# Chat5 Codex and human-response tools

## Scope

This feature adds seven Tool Manager entries for Chat5:

- Three fixed Codex workspaces: AI Gateway Linux, Lentmiien Site Linux development, and read-only Lentmiien Site production.
- A Codex-workflow version of Ask Lennart.
- A general Codex option-discovery tool and a general any-workspace runner.
- A general version of Ask Lennart.

A copy-ready Context message for chats using the Important tool set lives in `documentation/chat5-important-tools-context.md`.

Every Codex call creates an ordinary `/codex` session and waits for its first turn to reach a terminal state. The fixed development tools use OpenAI profile `high` with yolo permission. The production tool is deliberately forced to question/read-only mode even if a model asks it to edit production. The general runner validates every submitted choice again through the existing Codex service.

Ask Lennart records are shown at `/admin/ask-lennart`. A response completes the waiting tool call. The record and originating Chat5 pending response are both durable, so replay after a process restart finds the same request instead of creating a duplicate.

Each newly inserted pending request (both general and Codex workflow) triggers one Pushover notification attempt at **High priority (1)** through `utils/pushover.js`. The notification contains only the request type and an absolute link to its inbox card; prompts, answers, names, and chat/session identifiers are omitted. The atomic upsert result identifies the winning insert, so repeated calls, concurrent upsert matches, inbox reloads, responses, and restart recovery do not notify again. Sending happens after persistence; a notification failure logs a warning and does not prevent the durable wait or answer delivery. Notifications are best effort: they are not retried, and a process exit between saving and sending can miss the alert while leaving the request available in the inbox.

## Security contract: Chat5 Codex tools

```text
Feature: Chat5-to-Codex tool bridge
Security zone: logged-in
Interactive principals: admin; family/user only with an explicit individual capability grant
Machine principals: none
Data classification: private (prompts, source investigation, and Codex responses)
Capabilities: codex.run.read_only; codex.run.workspace_write; codex.run.yolo (required in addition to workspace_write for yolo or git-commit/push runs)
Object scope: the authenticated socket principal is stored with the pending response, reloaded from the user database before execution, and owns the created Codex session; shared-conversation membership is never used as authorization; existing Codex owner/admin rules protect session pages
Admin override: yes, through the existing Codex session/turn policy
Browser mutations and CSRF control: none added; model-selected tool calls pass the existing selected-tool allowlist and handler authorization
Public/secret abuse controls: not applicable
Request and upload limits: 20,000 prompt characters; one workspace; one provider/profile/model choice; existing Codex queue/concurrency/turn timeout limits; bounded tool wait
Output/rendering contexts: structured tool output; Codex pages retain their existing escaping/sanitization
Private file/media storage and delivery: none added
Outbound hosts/services: existing Codex execution targets and configured OpenAI/provider paths only
Cache policy: existing authenticated Chat5 and Codex policies; no new public response
Security-relevant logs (without personal data): authorization/database/tool failures; never prompt or response text
Retention/deletion behavior: existing Codex session and turn retention
Required negative security tests: missing principal, missing capability, unknown fields/options, production write prevention, disabled/unavailable workspace/provider, replay identity, and bounded wait
Legacy dependency or migration plan: uses the existing Tool Manager, Chat5 response recovery, and Codex queue; no data migration
```

Capability defaults are explicit: `admin` receives all three capabilities; `family`, `user`, and `other` receive none. The Manage Roles page can assign narrowly scoped individual grants; granting workspace write alone does not grant yolo execution.

## Security contract: Ask Lennart

```text
Feature: Durable Ask Lennart tool and admin inbox
Security zone: logged-in
Interactive principals: admin by default; explicit grants supported
Machine principals: none
Data classification: private
Capabilities: human.request.create; human.request.manage
Object scope: creation is attributed to the authenticated, database-revalidated initiating principal; shared-conversation membership is never used as authorization; the inbox is admin-managed and manage-capability holders may read/respond to all requests
Admin override: yes, for list and response operations
Browser mutations and CSRF control: POST only, shared session CSRF token plus same-origin checks
Public/secret abuse controls: not applicable
Request and upload limits: 20,000 characters per prompt/response; 10 pending requests per creator by default; 30 responses/hour; bounded form size/field count; no uploads; one notification attempt per insert with the shared 10-second Pushover timeout
Output/rendering contexts: escaped Pug text and attributes; no rich HTML; notification plain text contains only a fixed request-type label and opaque request-id link
Private file/media storage and delivery: none
Outbound hosts/services: https://api.pushover.net/1/messages.json via the existing configured application token/user key; link origin uses PUBLIC_APP_BASE_URL (default https://my.lentmiien.com), accepts HTTP(S), rejects embedded credentials, and excludes base paths/query/fragment
Cache policy: private, no-store
Security-relevant logs (without personal data): failed authorization, rendering, response persistence, restart recovery, and notification delivery; notification warnings contain only request id and error name, never provider payloads or prompt/response text
Retention/deletion behavior: records receive a TTL, 90 days by default; unanswered calls time out after 24 hours by default
Required negative security tests: missing capability, malformed/oversized/unknown input, invalid CSRF, malformed/unknown request id, duplicate replay, foreign/untrusted principal, escaped rendering, notification privacy, invalid link configuration, no notification on failed persistence, and isolated notification failures
Legacy dependency or migration plan: adds `tool_wait` to pending Chat5 response state; old records need no migration
```

Capability defaults are explicit: `admin` receives create/manage; `family`, `user`, and `other` receive neither.

## Restart behavior

When an Ask Lennart handler begins waiting, its Chat5 `pending_requests` record moves to `tool_wait`. Normal recovery deliberately ignores that state, so a completed OpenAI response is not repeatedly executed while awaiting a person.

Each newly queued Chat5 response stores the authenticated socket principal that initiated it. Tool execution reloads that account by id and checks its current semantic capabilities. The conversation member list is retained only for normal conversation behavior and cannot grant access to these tools.

When Lennart responds, the pending response is moved back to `pending` with a short delay. If the original process is still alive, it observes the database response and finishes first. If the process stopped, the existing Chat5 recovery scheduler replays the completed model response, and the stable conversation/response/tool-call key resolves to the already-answered human request. A one-minute reconciliation loop requeues answered calls interrupted before their tool output was saved and expires overdue requests, so timeout behavior also survives restarts.

Codex tool calls also receive deterministic internal session and turn IDs derived from the originating tool call. Replaying a call therefore resumes the existing stored Codex turn rather than starting duplicate work. While a live handler waits, it refreshes the pending-response processing heartbeat.

## Configuration and deployment

The following wait/recovery settings have safe defaults and are optional:

- `CODEX_CHAT_TOOL_WAIT_TIMEOUT_MS` (default 2 hours)
- `CODEX_CHAT_TOOL_POLL_INTERVAL_MS` (default 2 seconds)
- `HUMAN_TOOL_RESPONSE_TIMEOUT_MS` (default 24 hours; maximum 48 hours)
- `HUMAN_TOOL_POLL_INTERVAL_MS` (default 2 seconds)
- `HUMAN_TOOL_RECOVERY_INTERVAL_MS` (default 1 minute)
- `HUMAN_TOOL_RETENTION_DAYS` (default 90 days)
- `HUMAN_TOOL_MAX_PENDING_PER_USER` (default 10)

Notifications reuse `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY`; missing credentials produce a warning while requests remain usable. Set the existing `PUBLIC_APP_BASE_URL` to the intended HTTP(S) application origin for notification links. No dependency, database migration, new browser endpoint, or Cloudflare change is required. The linked inbox retains its capability checks, CSRF controls, and private/no-store responses.

Deploy through the normal reviewed application release/restart process. In a test environment with sandbox Pushover credentials, create one request with each Ask Lennart variant and verify one High-priority alert per new request, the correct linked card after login, and no private content in the alert. Reload the inbox, replay/resume a pending tool call (including across a restart), and submit an answer: none should generate another alert, and the answer must reach the chat. Simulate a Pushover failure using sandbox configuration and verify that the request remains answerable and a `human_tool_request` warning appears without secrets. Reverting the notification change and restarting rolls back alerts without migrating or deleting existing requests.

The two fixed development workspaces require global `CODEX_YOLO_ENABLED=true` and `allowYolo=true` on those workspace records. Production remains read-only regardless. Tool seeds are inserted by the normal missing-default startup seeder; existing Tool Manager edits are preserved by that startup path. The manual seed action and `setup.js` retain their existing full-default refresh behavior.

Rollback consists of disabling the seven Tool Manager records. The inbox can remain mounted while outstanding responses finish. Do not remove the `tool_wait` enum value while any `pending_requests` record still uses it.
