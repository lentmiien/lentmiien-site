# Thinking metadata on AI model cards

Model cards have an optional Boolean `is_thinking` field. The create/edit form offers
**Use legacy detection**, **Yes**, and **No**, and the table shows the stored setting.
All providers and model types may store it. Only `utils/OpenAI_API.js` consumes it.

An explicit `true` or `false` overrides the existing reasoning model-name detection.
Absent/null metadata falls back to the unchanged allowlist and GPT-5 family checks.
Selecting legacy detection removes the field; older form submissions that omit the
field preserve an existing override. There is no schema default or data backfill.

OpenAI requests still use the conversation's reasoning effort. The flag does not
select effort, change reasoning-mode support, or alter other provider integrations.
After deployment, edit the `gpt-6-sol` and `gpt-6-luna` cards and select **Yes**.
Saving invalidates the existing model caches. No live database changes are part of
this code update. The OpenAI [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
describes the existing request parameters.

## Security contract

- Feature/zone: model-card metadata management; logged-in, private configuration.
- Interactive principals: admin by default; family/user require an explicit
  `ai.model_cards.manage` grant. The existing application-level `chat5` permission
  remains required. Machine principals: none.
- Object scope: shared admin-managed catalog. Management capability authorizes
  all model cards, including cards added by another manager; no owner impersonation.
  Admin receives the capability bundle, with no separate authorization bypass.
- Browser mutations: existing POST forms use shared session CSRF middleware;
  GET only renders. No new endpoints. All model-card mutation routes share the
  capability check so another mutation cannot bypass catalog management authority.
- Input/work limits: the new scalar accepts only true/false booleans, their exact
  string representations, or blank/null to clear. Arrays/objects/other scalars are
  rejected before database work. Existing application body limits, form validation,
  and one-card save operations remain in effect; no added uploads or provider calls.
- Rendering: escaped Pug, existing Graphite theme; private/no-store responses and
  analytics disabled on management pages. No new file/media storage or delivery.
- Outbound services: existing OpenAI request construction only; no new destinations.
- Logs: shared authorization/CSRF denials and lookup failures; existing model-card
  save failures use the shared logger. No flag payload, credentials, or prompts
  are added to logs.
- Retention: follows the existing card lifetime; clearing unsets only this field.
- Negative tests: missing authentication/capability, family/user defaults, CSRF
  missing/invalid/untrusted origin, GET mutations, and invalid metadata types.
- Migration/deployment: no schema migration, secrets, or Cloudflare changes. Existing
  non-admin catalog managers need an explicit semantic grant. Rollback ignores
  the optional metadata and restores previous name detection; stored cards remain
  compatible. Surrounding Chat5 operations remain legacy and are not rebuilt here.
