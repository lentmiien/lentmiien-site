# Mori AI integration correction

This correction is scoped to Mori's existing logged-in, connection-private dialogue.
It adds no character-memory feature, tools, gameplay, dashboard, Gateway catalog or
service changes. The persistent world schema remains version 1. The browser cache
revision advances to 1.2.2. Historical validation reports describe their original
releases; the results below apply only to this correction.

## Configuration and request contract

Existing deployments need no additional environment variables. NPC dialogue remains
off unless `COMMONS_NPC_ENABLED=true`; enabled deployments still require the existing
`COMMONS_NPC_MODEL`. Origin precedence remains `OLLAMA_BASE_URL`, then
`AI_GATEWAY_BASE_URL`, then the existing default Gateway origin. No authentication,
model discovery, service lifecycle requests, retries or redirects are added.

| Setting | Default | Inclusive bounds |
| --- | --- | --- |
| `COMMONS_NPC_TIMEOUT_MS` | `90000` | 60000–120000 milliseconds |
| `COMMONS_NPC_CONTEXT_TOKENS` | `16384` | 8192–65536 tokens |
| `COMMONS_NPC_MAX_TOKENS` | `512` | 256–1024 tokens |

Values must be decimal integer strings. Missing variables use defaults; explicit
empty, fractional, nonfinite, nonnumeric and out-of-range values fail validation.
As before, invalid **enabled** NPC configuration disables installation of Commons
with a sanitized `commons.config` error; the rest of the Site continues. Disabled
NPCs do not validate unused provider settings. No configuration values or raw errors
are included in the startup failure log.

Every non-streaming `POST /llm/chat` sends exactly `model`, `messages`, `stream:false`,
`think:false`, `context_tokens`, `max_tokens` and `temperature:0.7`. Thinking fields
are never used as dialogue or stored in history. Only string `message.content` or
`choices[0].message.content` is accepted; numeric/structured content is not coerced.
Tool/function calls, malformed content and empty visible answers trigger fallback.
Short plain-text style, 400-character input, 1,200-character displayed output and
six recent connection-private messages remain. Context is an upper allowance, not
prompt padding; 16K leaves headroom for a possible future memory design without
requesting the Gateway's full 131K default. This patch implements no such memory.

512 output tokens reduce premature exhaustion compared with 180 while preserving
short replies. Thinking consuming the old budget was plausible, not proven. These
budgets do not guarantee every model supports the chosen context: choose a value
within that model's capacity. A context incompatibility returns sanitized
`upstream_http` diagnostics when rejected with an HTTP status. Check model support
and these configured budgets; Commons neither reads/logs the error body nor
silently changes the model or catalog.

## Deadlines, cancellation and player experience

Axios and the local request race use the same configured deadline, including model
startup and shared queue time. The socket's joined payload supplies only this safe
numeric deadline to the browser, whose acknowledgement timeout adds 15 seconds for
authorization/delivery (105 seconds by default, at most 135 seconds). No old 12/16
second timer remains. A 90-second wait is bounded, not a promise of queue capacity.

One request per user, two globally, and the 15-second start-to-start cooldown remain.
Pending requests do not hold the normal command lane or world queue. The browser
prevents duplicate submits, preserves the waiting state when reopening Mori, and
explains that a reply can take up to two minutes. Closing the dialog permits movement;
entering another scene cancels the conversation. Scene changes, disconnects,
takeovers and pending-talk permission audits abort local work. Authorization and
scene are checked again before history changes, and late callbacks cannot replace
a new connection/scene's dialogue. Failed enabled calls retain **Local reply · AI
unavailable**; disabled calls retain **Local scripted reply**. A missing socket
acknowledgement has a generic retry-later message and never automatically resends.

Cancellation settles locally even when the provider ignores abort. It frees local
concurrency and discards late output/history updates. The remote Gateway/provider
may continue computation after disconnect; no GPU cancellation guarantee is made.
Talk grants are rechecked by the existing three-second connection audit while work
is pending, and again before results. A revoked connection closes as with other
expired authorization. No other feature's permissions or private data are changed.

## Sanitized diagnostics

Category `commons.npc` uses a fresh, random **local** `request_id` for each accepted
attempt. Correlate `started` and `completed`/`fallback`/`cancelled` by that ID and the
shared logger's runtime revision/PID/start time. IDs are not propagated to Gateway;
this is not end-to-end tracing. Debug events distinguish `scripted`/`disabled`
(no call), `started`, `completed`, and expected `cancelled`. Recoverable failures use
warning-level `fallback` with a reason:

| Reason | Meaning / next check |
| --- | --- |
| `timeout` | Local or HTTP deadline; inspect elapsed time, queue/startup and budgets. |
| `upstream_http` | Gateway returned an HTTP error; inspect status, model availability and context support. |
| `network` | Allowlisted connection/DNS/transport failure; inspect Gateway connectivity. |
| `empty_response` | Visible content empty, even if thinking exists; inspect finish reason/output allowance. |
| `invalid_response` | Wrong response/content type or oversized HTTP response; inspect Gateway contract. |
| `unexpected_tool_calls` | Tool/function call returned; no execution or dialogue accepted. |
| `provider_error` | Unclassified provider exception; safe generic reason, no raw message. |
| `cancelled` | Expected local cancellation or transport abort; debug only, not an outage. |

Per-call diagnostics include model key, `elapsed_ms`, `timeout_ms`, `context_tokens`
and `max_tokens`. Normal bounded catalog keys are logged; URI/path-like or oversized
keys use a short SHA-256 identifier. The configured URL is never logged. Optional
`http_status`, allowlisted `transport_code`, `visible_chars`, `displayed_chars`,
allowlisted `finish_reason`, and nonnegative integer `prompt_tokens`/
`completion_tokens` appear only when known. Counts describe upstream metadata and
must not be treated as proof of reasoning behavior. No prompt, account name, input,
history, output, thinking, raw error message/stack/body, headers or Axios config is
logged. No upstream free-form reason strings are trusted.

Each reason/event bucket emits at most five details per minute plus one timed
summary with `suppressed_count` and at most the last three suppressed local request
IDs. Distinct causes retain separate buckets; a quiet burst still gets a summary.
Debug filtering may omit starts/completions; warnings retain full safe request
context. No new persistent diagnostic state or dashboard is introduced.

## Security and release handoff

The existing [security contract](SECURITY.md) and [v1.2 extensions](V1.2-SECURITY.md)
continue: logged-in principals, `commons.world.play` plus `commons.npc.talk`, owner
connection scope, no admin override of private conversations, authenticated socket
Origin/CSRF/session controls, no public mutation route, no new files or retained
private data. The sole outbound integration is the existing configured Gateway.
Responses remain plain text via `textContent`. Only public fictional lore and the
caller's bounded ephemeral conversation enter the provider. Tests cover denial,
late-result suppression, metadata redaction, concurrency and safe fallback.

Prepared on `hotfix/commons-mori-ai` from production baseline `b25b036`, following
the repository's production-hotfix convention. No main/dev merge or deployment is
performed. After user verification, the normal operator release can merge the
reviewed hotfix into main and dev, deploy the Site, and reload clients. Keep the
existing on/off/model/origin configuration; new settings may be omitted to use the
defaults. Apply any overrides to the Site environment before its operator-managed
restart. No Gateway restart/catalog changes or database migrations are needed.

The remaining human check is an operator-approved deployment followed by talking to
Mori using the existing `gemma4:e4b` selection and checking sanitized completion or
fallback logs. Development tests use synthetic replies and local HTTP only; they
cannot establish live Gateway model compatibility, queue behavior or response quality.

## Development validation

Executed on Node **24.20.0**, with existing dependencies and no lockfile changes:

- Full Jest run: **376 suites passed**, 8 skipped; **4,801 tests passed**, 117 skipped;
  no failures. Coverage thresholds passed: 71.78% statements, 50% branches,
  80.79% functions, 72.64% lines. Command:
  `volta run --node 24.20.0 npm test -- --runInBand --coverageReporters=text-summary --no-cache`.
- Final focused Commons and logger run: **12 suites / 174 tests passed**, 7 tests in
  the optional disposable-Mongo suite skipped (no `COMMONS_TEST_MONGO_URL` supplied).
  This includes exact request bodies/defaults/bounds; 17-second fake-clock success;
  deadline and AbortController cleanup; delayed authorization; real local HTTP body
  and abort tests; real Socket.IO disconnect/takeover/revocation/scene cancellation;
  private history/output exclusion; no retries; and malicious diagnostic redaction.
- Real headless Chromium with synthetic provider: **14 checks passed**, no page
  errors, desktop 1440×1000 and mobile 390×844/DPR 2. Actual 17-second synthetic
  replies exceeded both old deadlines. Both local slots remained pending while
  movement continued; duplicate sends, scene cancellation, late replies and enabled
  failure labels were checked. This is a real browser/socket test with a **stub
  provider**, not real inference. See [results](validation-mori-ai/browser-results.json),
  [desktop waiting](validation-mori-ai/desktop-pending.png),
  [mobile waiting](validation-mori-ai/mobile-pending.png),
  [desktop success](validation-mori-ai/desktop-success.png),
  [mobile success](validation-mori-ai/mobile-success.png), and
  [fallback](validation-mori-ai/desktop-fallback.png). Screenshots were visually inspected.
- JavaScript syntax, Pug compilation and `git diff --check` passed. Full diff review
  confirmed no changes to Gateway, other features, persistent world version or grants.
  The initial cache-revision assertion and browser-harness focus failure were fixed
  before the passing runs; no unresolved test failures remain. Existing VM-module
  and Express Promise-like-handler warnings appeared during the full suite.

Repeat focused tests with:

```sh
volta run --node 24.20.0 npm test -- tests/unit/commons tests/unit/loggerSecurity.test.js tests/unit/loggerFileIsolation.test.js --coverage=false --runInBand
```

Repeat the synthetic browser check with an available Playwright installation and
Chromium binary (the repository's optional browser-runner convention; no new dependency):

```sh
NODE_ENV=test PLAYWRIGHT_MODULE=/path/to/playwright COMMONS_CHROMIUM=/path/to/chromium \
  volta run --node 24.20.0 node scripts/review-commons-mori.js
```

`NODE_ENV=test` keeps synthetic diagnostics out of production log files. The browser
harness listens only on loopback and imports neither app startup nor environment secrets.
