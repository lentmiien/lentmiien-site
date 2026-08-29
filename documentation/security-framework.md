# Security Framework for New and Rebuilt Features

- Status: Normative for new development
- Version: 1.0
- Last updated: 2026-08-29

## Purpose

This document defines the minimum security standard for new features and for existing features that are deliberately rebuilt as replacements.

The project contains useful legacy functionality that cannot all be migrated at once without risking regressions. This framework therefore uses a forward-migration model:

- Existing behavior may remain in place while it is maintained.
- New features must use this framework from their first implementation.
- A rebuilt feature must meet this framework before replacing its legacy version.
- New routes, data, operations, or integrations added to a legacy feature must meet this framework even when the surrounding legacy feature does not.
- Legacy code is not precedent for new security decisions.

The objective is not maximum theoretical restriction. It is a consistent, reviewable system suited to a publicly reachable personal application with public pages, secret-public device/household pages, and a small set of logged-in users.

The findings that motivated this framework are recorded in `documentation/security-audit-2026-08-28.md`.

## Current implementation status

This document is the target policy; it does not imply that every shared primitive already exists.

Reusable controls currently include session authentication, the shared role-permission evaluator, secret-public response handling, safe inline JSON, rich-content sanitizers, file/path and local-redirect validators, the production logger, and generic error handling.

The project does not yet have a complete semantic capability catalog/policy registry, shared CSRF middleware, scoped service-principal system, universal owner/member guard, persistent revocable session store, or private-media delivery layer. The first new feature that needs one of these controls must either add a reviewed shared implementation with focused tests or stop and document the missing prerequisite. It must not silently fall back to a legacy insecure pattern.

## Requirement language

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative:

- **MUST/MUST NOT**: required for a new or rebuilt feature unless the repository owner approves a documented exception.
- **SHOULD/SHOULD NOT**: expected default; deviations need a concrete reason.
- **MAY**: optional.

An exception must state the affected feature, reason, risk, compensating control, owner, and review/expiry date. “The legacy feature already does this” is not an acceptable exception.

## Core model

Every request or event is authorized in this order:

1. **Zone** — how the caller reaches the feature.
2. **Principal** — the authenticated user, service, device, or verified provider.
3. **Capability** — whether that principal may perform the operation.
4. **Object scope** — whether that principal may access the specific record, job, file, conversation, or room.
5. **Request safety** — whether the request is valid, non-forged, bounded, and safe to process.

Passing one layer never implies passing the next. In particular:

- Being logged in is not permission to use every feature.
- Having a feature capability is not permission to access every object in that feature.
- Knowing a secret-public URL does not create a logged-in identity.
- Hiding navigation does not enforce authorization.
- Cloudflare Access, WAF, or rate limiting does not replace application authorization.

The default is deny. Missing or ambiguous policy must fail closed.

## Security contract required for every feature

Before implementation, every new or rebuilt feature MUST define a short security contract in its design document, implementation plan, or pull-request description.

Copy and complete this template:

```text
Feature:
Security zone: fully-public | secret-public | logged-in
Interactive principals: anonymous | admin | family | user
Machine principals: none | service principal | signed webhook | device token
Data classification: public | private | sensitive | secret
Capabilities:
Object scope: none | owner | member | shared household | admin-managed
Admin override: no | yes, for <operations>
Browser mutations and CSRF control:
Public/secret abuse controls:
Request and upload limits:
Output/rendering contexts:
Private file/media storage and delivery:
Outbound hosts/services:
Cache policy:
Security-relevant logs (without personal data):
Retention/deletion behavior:
Required negative security tests:
Legacy dependency or migration plan:
```

A feature is not ready for implementation while important fields remain “TBD.”

## The three application zones

### 1. Fully public

Fully public features intentionally accept requests from anyone on the Internet.

Examples include a public article, public game, or deliberately public read-only utility.

Requirements:

- The feature MUST NOT disclose session, account, household, device, location, private-media, or secret-public data.
- Public GET/HEAD operations MUST be safe and free of side effects.
- Public writes MUST have explicit rate, body-size, field-count, and work/cost limits.
- Expensive work SHOULD be queued with per-caller and global concurrency limits.
- Public input MUST be validated with an allowlist schema before database or provider use.
- Public output MUST use context-appropriate escaping or sanitization.
- Caching MUST be explicitly classified. Only deliberately public, non-personal responses may be edge-cached.
- Error responses MUST be generic and MUST NOT expose stack traces, local paths, provider payloads, or secrets.
- Analytics MAY be used only when the page contains no secret URL or sensitive state and the project privacy policy permits it.

Authentication may be added to a public write without making the public read private. Reads and writes can have different policies.

### 2. Secret public

Secret-public features use an unguessable URL as a lightweight bearer capability. This is intentional for simple devices or household workflows that cannot perform a normal login.

Requirements:

- The path MUST be generated from at least 24 cryptographically random bytes and loaded from an environment-managed secret.
- The path value MUST NOT appear in source, documentation, logs, metrics, analytics, referrers, screenshots, test snapshots, rule names, or error messages.
- Responses MUST use `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and an appropriate `X-Robots-Tag` no-index policy.
- Analytics and third-party page resources SHOULD be disabled.
- Inputs and writes MUST be rate-limited and bounded.
- The feature MUST disclose only the minimum data intended for anyone possessing that URL.
- Sensitive writes SHOULD require a second credential, such as a per-device token, when the client can send one.
- View and write authority SHOULD be separable when the feature exposes sensitive household data.
- Secrets MUST be rotatable without a code change. Rotation and client update steps MUST be documented.
- A secret-public URL MUST NOT be accepted as proof of a user role or reused as a general API key.

The current secret-public response middleware and stable route-label helpers should be reused rather than reimplemented.

### 3. Logged in

Logged-in features require a valid application session and then apply capability and object authorization.

Requirements:

- Every route and Socket.IO event MUST require the relevant semantic capability, not merely authentication.
- Every object-bearing operation MUST enforce its owner/member/shared/admin scope.
- Browser mutations MUST use a non-GET method and the project's shared CSRF defense.
- User identity MUST come from the validated principal, never an unrestricted request `userId`, username, owner, or member field.
- Private responses SHOULD use `Cache-Control: private, no-store` unless a reviewed private-cache design exists.
- Logged-in pages MUST NOT load analytics by default.
- Long-running/realtime operations MUST account for session expiry and revocation.
- High-impact administrator or execution operations SHOULD support a shorter session or recent/MFA authentication requirement when that shared capability is available.

The three roles inside this zone are capability bundles, not authorization shortcuts:

| Role | Default intent |
| --- | --- |
| `admin` | Owner administration and explicitly granted high-impact capabilities |
| `family` | Conservative shared-household functions; currently unused |
| `user` | Minimal personal functions plus explicit work-account grants |

New code MUST still perform capability and object checks for admin requests. An admin object-scope override is allowed only when the feature contract declares it.

## Machine callers are principals, not a fourth user zone

Machine-to-machine interfaces use one of the three exposure zones, plus a declared machine authentication method. A signed webhook is network-reachable in the fully-public zone but must become a verified provider principal before doing work. A service-principal API belongs to the logged-in/private zone for policy purposes even though it does not use a browser login session.

### Service principals

New API integrations MUST use independently identifiable service credentials rather than the legacy global `API_KEY` pattern.

A service principal SHOULD contain:

- A stable ID and descriptive name.
- A stored hash of the secret, not the recoverable secret.
- Explicit capabilities/scopes.
- A fixed subject/owner when it operates on one user's data.
- Created, expiry, last-used, disabled, and revoked timestamps.
- Independent rotation and revocation.
- Its own rate-limit identity and audit attribution.

Credentials MUST be sent in an authorization header, not a URL query string. A service principal MUST NOT choose an arbitrary user identity unless it has an explicit, exceptional impersonation capability.

### Signed webhooks

Provider webhooks MUST:

- Verify the provider signature or dedicated credential before processing.
- Use constant-time secret comparison where the provider SDK does not handle verification.
- Verify timestamp/replay protections when supported.
- Preserve the raw request body when required by the signature protocol.
- Apply request-size and rate limits that allow legitimate retries.
- Be idempotent by provider event/job ID.
- Log only event type, stable ID, status, and actionable failure metadata.

Cloudflare exceptions for webhooks MUST be narrow. Do not bypass all WAF/rate controls for the hostname.

## Capabilities

### Naming

Capabilities MUST describe authority rather than a route or page name.

Use lower-case dot-separated names:

```text
<domain>.<resource>.<action>
```

Examples:

```text
blog.article.publish
chat.conversation.read
chat.conversation.write
chat.conversation.manage_members
finance.transaction.delete
github.repository.pull
media.private.read
codex.run.read_only
codex.run.workspace_write
admin.users.manage
```

Avoid ambiguous permissions such as `chat5`, `tools`, `test`, or a raw route name for new features.

Separate dangerous operations. For example, `codex.run.read_only` must not imply `codex.run.workspace_write`, and reading a conversation must not imply deleting it or managing members.

### Assignment

- Roles provide normal capability bundles.
- Per-user grants provide small exceptions, such as a work-account feature.
- Service principals receive only the scopes required for their integration.
- A new feature MUST ship with an explicit assignment decision for `admin`, `family`, and `user`; lack of a role record must not accidentally produce public/authenticated-only access.
- Authorization MUST be enforced server-side even when a link, form, button, or Socket.IO script is hidden from the UI.

New semantic capability strings may use the current shared authorization evaluator while the role system is being modernized. Do not copy a feature-specific role query into controllers or socket handlers.

## Object-level authorization

Any identifier supplied by a client is untrusted, including a MongoDB ID, numeric thread ID, filename, job ID, conversation ID, room name, or repository path.

### Required query pattern

Prefer authorization in the database predicate:

```js
const entry = await EntryModel.findOne({
  _id: req.params.id,
  ownerId: req.user._id,
});
```

For shared objects:

```js
const conversation = await ConversationModel.findOne({
  _id: conversationId,
  memberIds: req.user._id,
});
```

Avoid this pattern:

```js
const entry = await EntryModel.findById(req.params.id);
// Authorization happens later, or is forgotten.
```

Requirements:

- New schemas SHOULD use immutable user IDs for ownership rather than display names.
- Read, update, delete, copy, export, file download, and background-job actions MUST all apply object scope.
- Mutations SHOULD use a scoped atomic query such as `findOneAndUpdate`/`findOneAndDelete`.
- A foreign and missing ID SHOULD normally produce the same generic 404 response.
- List queries MUST be scoped too; protecting only detail routes still leaks metadata.
- Child resources MUST be checked through their authorized parent or carry their own owner scope.
- Client-provided member/owner arrays MUST be validated against the caller's member-management capability.
- Admin override behavior MUST be centralized and covered by tests.

## HTTP and browser controls

### Methods and CSRF

- GET and HEAD MUST be read-only and safe to repeat.
- Browser state changes MUST use POST, PUT, PATCH, or DELETE.
- Every session-authenticated browser mutation MUST use the shared CSRF mechanism.
- SameSite cookies, hidden URLs, AJAX-only interfaces, and JSON content types are defense-in-depth, not substitutes for CSRF validation.
- Origin, Referer, and Fetch Metadata checks SHOULD supplement tokens where practical.
- Webhooks and service-principal APIs MUST use their own authentication and MUST NOT be made to depend on browser CSRF tokens.

If shared CSRF middleware has not yet been implemented when the first framework-compliant browser feature is built, implementing and testing one shared mechanism is part of that feature. Do not invent unrelated per-feature token formats.

### Input validation

- Validate `params`, `query`, `body`, headers used for decisions, Socket.IO payloads, and provider callbacks at the boundary.
- Prefer explicit schemas and allowlists; reject unknown security-sensitive fields.
- Apply length, count, numeric range, enum, date, nesting-depth, and total-body limits before expensive work.
- Never pass untrusted objects directly into MongoDB filters/updates or provider options.
- Never trust a client-supplied price, role, permission, owner, local path, upstream URL, model permission mode, or completion status.
- Normalize once, validate the normalized form, and use that validated value throughout the operation.

### Output and rendering

- Pug's escaped interpolation is the default for text.
- Unescaped Pug output (`!=` or `!{}`), `innerHTML`, and HTML email/Markdown rendering require a documented trusted source or an allowlist sanitizer.
- Inline JavaScript data MUST use `safeJson`; raw `JSON.stringify` in script blocks is not sufficient.
- Browser DOM updates SHOULD use `textContent`, element creation, and property assignment.
- Rich Markdown/HTML MUST be sanitized after rendering. Sanitizer allowlists should be feature-specific and must constrain URL-bearing attributes.
- User/AI-controlled images MUST NOT be able to auto-request arbitrary authenticated routes or remote trackers.
- New pages SHOULD be compatible with a future nonce/hash-based Content Security Policy: avoid inline event handlers, `javascript:` URLs, and unnecessary inline scripts.

### Redirects and errors

- Redirect targets derived from a request MUST use the shared local-redirect validator.
- Public error responses MUST be generic and must not expose stacks, local paths, database details, provider bodies, or whether a foreign private object exists.
- Actionable operational failures MUST be reported through `utils/logger` with stable messages and small diagnostic metadata.

## Socket.IO and realtime features

Realtime authorization has two levels: connection and event/object.

Requirements:

- Authenticate and load the current principal during the handshake.
- Register privileged event handlers only after checking the feature capability.
- Revalidate or disconnect long-lived sockets on session expiry/revocation according to the feature's risk.
- Validate every event payload and bound array, string, upload, and batch sizes.
- Authorize the conversation/job/resource before joining its room.
- Recheck object scope for every read or mutation; room membership is not sufficient authorization.
- Use server-derived room names and principal identity.
- Limit how many rooms, jobs, or concurrent operations one socket can create.
- Do not broadcast private object data to a user or conversation room until membership has been verified.
- Return generic client errors while logging actionable server failures without payload contents.
- Configure an application Origin allowlist for browser Socket.IO connections.

Security tests MUST include unauthorized connection, missing capability, foreign object, removed member, expired/revoked session, malformed payload, and authorized success cases.

## Files, uploads, and generated media

### Storage and delivery

- Private uploads and generated media MUST be stored outside `public`.
- Public and private media MUST use separate directories/storage namespaces.
- Private delivery MUST go through an authenticated owner/member-scoped route or equivalent signed short-lived delivery mechanism.
- Private responses MUST use private/no-store cache policy unless a reviewed design proves otherwise.
- Filenames MUST be server-generated and unguessable. Original filenames are display metadata only.
- Paths MUST be resolved against an explicit root and checked for lexical and realpath confinement.
- Symlinks MUST be rejected where a user-controlled path or repository is browsed.
- Do not return absolute server paths to clients.

### Upload validation

- Configure total request, per-file, file-count, field-count, and part-count limits.
- Validate extension, declared MIME type, and magic bytes/content structure as appropriate.
- Images SHOULD be decoded and re-encoded before trusted display/use.
- Archives, PDFs, office documents, media, and model files SHOULD be processed with time, memory, page/frame/entry, and decompression limits.
- Temporary files MUST be cleaned on success, rejection, disconnect, and failure.
- Downloads SHOULD set an explicit safe content type and `Content-Disposition`; do not allow browser sniffing of private arbitrary files.

## Outbound requests and integrations

Any request-controlled destination creates an SSRF or credential-forwarding boundary.

Requirements:

- Prefer a fixed configured origin and allowlisted operation/path over an arbitrary URL.
- Permit only required schemes, hosts, ports, and paths.
- Reject embedded credentials, unexpected redirects, loopback/private/link-local destinations, and malformed/encoded host tricks when destinations are user-controlled.
- Apply connection/read timeouts, response-size limits, redirect limits, and concurrency limits.
- Do not forward application credentials to a caller-selected origin.
- Validate provider identifiers and filenames separately from URLs.
- Log the stable integration name and outcome, not signed URLs, authorization headers, request bodies, or full provider responses.

## AI, agents, tools, and background jobs

Model input, retrieved context, tool arguments, model output, and generated code/HTML are untrusted data. A model does not become a security principal and cannot grant itself authority.

Requirements:

- Retrieval and embedding searches MUST apply the initiating principal's object scope before content is sent to a model.
- Prompts SHOULD contain the minimum private/sensitive data needed, and the feature contract MUST name external providers that receive it.
- Model-selected tools MUST come from a server-side allowlist and have strict argument schemas.
- Every tool call MUST apply the initiating principal's capability and object policy; model instructions never bypass those checks.
- Dangerous modes such as filesystem write, shell execution, unrestricted network access, or external side effects MUST be separate capabilities selected and capped by server policy.
- Model output MUST be escaped/sanitized like user input and MUST NOT be used directly as a database filter, local path, URL, role, permission, shell command, or active same-origin HTML.
- Generated code or interactive HTML MUST run in an isolated/cookieless environment with an explicit sandbox policy before it is treated as publishable content.
- Token, request, tool-call, retry, execution-time, queue, concurrency, and cost limits MUST be defined.
- Background jobs MUST store an opaque owner/principal reference and be owner-scoped for status, result, cancellation, retry, and output download.
- Authorization MUST be checked when work is queued and again before a delayed job performs a sensitive side effect. Revoked principals must not retain indefinite queued authority.
- Provider callbacks and retries MUST be idempotent, and a job/result ID from the client MUST not select another principal's work.
- Private results MUST be emitted only to previously authorized user/object rooms or retrieved through an authorized route.

## Data, privacy, logging, and retention

Classify feature data before selecting storage or logs:

| Classification | Examples | Default treatment |
| --- | --- | --- |
| Public | Published article, public game asset | May be publicly cached when intentional |
| Private | Personal notes, ordinary chat, generated media | Logged-in and owner/member scoped; no public cache |
| Sensitive | Finance, location, device activity, health, private email | Minimum collection, strict scopes, no analytics, short/log-free handling |
| Secret | Password hashes, API keys, session/tunnel/webhook tokens | Never returned or logged; environment/secret storage; rotation |

Requirements:

- Collect and persist only fields needed by the feature.
- Define retention and deletion behavior for sensitive records, jobs, temp files, debug payloads, and logs.
- Do not log prompts, transcripts, email bodies, addresses, location, health, uploaded content, authorization headers, cookies, signed URLs, or secrets by default.
- Use the shared logger's structured `category` and concise `metadata` fields.
- Key-based redaction is a safety net, not permission to log complete request/provider objects.
- Log denied/high-impact actions only when useful and without creating noisy per-request records or disclosing object content.
- Security-relevant audit records SHOULD identify principal ID, operation, object type/opaque ID, outcome, and timestamp without personal content.

## Dependencies, configuration, and deployment

- Prefer existing maintained dependencies and local assets over unpinned CDN `latest` resources.
- Intentional dependency changes require the lockfile, focused tests, and `npm audit` review.
- New environment variables MUST be documented in `env_sample` when they are safe to name.
- Secrets MUST NOT have usable fallback/default values in production.
- Security-sensitive configuration MUST validate at startup and fail closed with a safe actionable log.
- Do not read or print `.env`, credentials, or production personal data during ordinary development/review.
- Application controls MUST remain effective if Cloudflare rules are absent or misconfigured.
- Cloudflare cache, Access, WAF, rate-limit, and Tunnel decisions for a feature SHOULD be included in its deployment notes.

## Required security tests

Tests must prove denial as well as success. Apply the relevant rows to each new/rebuilt feature.

| Area | Minimum cases |
| --- | --- |
| Zone | Anonymous allowed/denied exactly as declared; secret-public path does not leak; authenticated redirect/401 behavior is appropriate |
| Roles/capabilities | Admin, family, user, per-user grant, and missing capability |
| Object scope | Owner/member succeeds; unrelated principal fails; missing and foreign object do not leak; admin override matches contract |
| Service principal | Correct scope/subject succeeds; wrong scope/subject, expired, disabled, and revoked fail |
| CSRF/methods | GET cannot mutate; missing/invalid token or disallowed Origin fails; valid browser mutation succeeds |
| Validation | Missing, wrong type, oversized, excessive count, unknown privileged field, and malformed identifier fail before work |
| Rendering | Script/event/URL payloads remain inert in each HTML, attribute, URL, JSON, and Markdown context used |
| Files | Traversal, encoded traversal, absolute path, symlink, wrong type, too large, too many, and foreign-owner download fail |
| Realtime | Unauthorized handshake/event/room, expired session, removed member, malformed payload, and room limit |
| Outbound | Wrong scheme/host/path, redirect escape, private target, timeout, and oversized response fail |
| Privacy | Response/cache headers are correct; logs/errors omit secrets and personal payloads |
| Abuse | Rate/concurrency/work limits apply without breaking expected authorized use |

Tests SHOULD exercise middleware and service integration rather than only testing a helper in isolation when the middleware order or route mount is security-critical.

## Review checklist for coding agents

Before declaring a new or rebuilt feature complete, verify:

- [ ] A completed security contract exists.
- [ ] The feature is assigned to exactly one of the three zones.
- [ ] Machine authentication is declared separately when applicable.
- [ ] Semantic capabilities and role assignments are explicit.
- [ ] Every client-controlled object ID has an owner/member/shared/admin policy.
- [ ] Lists, reads, writes, deletes, copies, exports, downloads, jobs, and socket rooms enforce that policy.
- [ ] Browser mutations are non-GET and CSRF-protected.
- [ ] Inputs, uploads, work, provider calls, and concurrency are bounded.
- [ ] Every output context is escaped or allowlist-sanitized.
- [ ] Private files are outside `public` and delivered through authorization.
- [ ] Redirect and outbound destinations are constrained.
- [ ] Cache and analytics behavior match the data classification.
- [ ] Logs and public errors omit secrets, personal content, and internal details.
- [ ] Negative security tests cover zone, capability, object, validation, and privacy failures.
- [ ] Deployment notes cover secrets, rotation, Cloudflare, migrations, and rollback.
- [ ] Any exception is documented with an owner and review date.

## Rebuilding a legacy feature

Treat a security redesign as a new version rather than silently changing the old feature underneath active use.

Recommended sequence:

1. Document the legacy feature's behavior and data dependencies.
2. Define the replacement's security contract and capabilities.
3. Build the replacement on a separate route/module and, where practical, separate private storage.
4. Add a deliberate data import/migration that assigns stable owners and validates legacy records.
5. Run old and new versions side by side behind an admin-visible feature flag.
6. Test the full zone/role/object matrix and important behavioral compatibility.
7. Switch links/clients to the replacement with a rollback path.
8. Disable the legacy routes and workers.
9. Remove legacy secrets, public media exposure, scheduled work, and data only after the rollback window and backup requirements are satisfied.

Do not let the replacement call an unscoped legacy service in a way that bypasses its new policy. If sharing legacy data is unavoidable, place a scoped adapter in front of it and test that boundary.

## Framework evolution

This document defines policy, not a frozen choice of npm packages or middleware implementation. Shared security primitives should evolve centrally as new features exercise the framework.

When a recurring requirement appears, prefer one reviewed and tested shared implementation for:

- Capability middleware and policy declarations.
- Object owner/member guards.
- CSRF protection.
- Service-principal authentication.
- Upload limits and private media delivery.
- URL/redirect/path validation.
- Safe JSON and rich-content sanitization.
- Rate-limit classes and privacy/cache headers.

Update this document when the project's actual shared implementation changes. A framework rule should be testable and practical; obsolete or ambiguous rules should be revised rather than ignored.
