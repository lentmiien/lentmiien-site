# Codex Mid-turn Messages

## Behavior

While a Codex turn is running, its detail page lets the turn owner send a short
course correction or omitted detail. The web process stores the request in
MongoDB so the feature works when the Codex worker is embedded or runs as a
separate process. The worker uses Codex App Server's `turn/steer` method on the
open turn connection and records the result as a `user_message` Process Details
event. It does not change the turn's original prompt or create another turn.

## Security contract

```text
Feature: Codex mid-turn messages
Security zone: logged-in
Interactive principals: authenticated accounts with codex.turn.steer (default admin, family, user)
Machine principals: none
Data classification: private
Capabilities: codex.turn.steer
Object scope: owner for message submission and user-message detail reads
Admin override: yes, for submitting to and reading messages on any running turn
Browser mutations and CSRF control: POST with the shared session CSRF middleware
Public/secret abuse controls: not public; authenticated endpoint is limited to 30 requests per IP per minute
Request and upload limits: one allowlisted string field, CODEX_MAX_PROMPT_CHARS per message, and CODEX_MAX_ADDITIONAL_MESSAGES_PER_TURN per turn
Output/rendering contexts: Pug escaping for the form and DOM textContent for stored user-message details
Private file/media storage and delivery: none
Outbound hosts/services: the execution target and provider already fixed on the running turn
Cache policy: private, no-store through the Codex router
Security-relevant feature logs (without personal data): delivery, polling, authorization, and persistence failures log stable turn/message IDs and error classes, never message text
Retention/deletion behavior: delivery records and detail events follow the existing Codex turn retention behavior
Required negative security tests: missing capability, foreign turn, non-running turn, unsupported/empty/oversized input, CSRF wiring, and failed worker delivery
Legacy dependency or migration plan: existing non-message events retain their authenticated shared view; new user-message details are owner/admin-filtered and the mutation is capability- and owner-scoped
```

The default role policy grants `codex.turn.steer` to `admin`, `family`, and
`user`, matching the authenticated roles that can already start Codex work.
Administrators retain the declared object-scope override. Accounts outside
those bundles need an explicit role grant.
