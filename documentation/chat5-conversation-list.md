# Chat5 conversation list

`/chat5/top` joins the member's conversations to the model-card catalog by exact
`metadata.model` / `api_model`. Legacy conversations use `default_model`, with
the same fallback as opening a legacy conversation. All matching cards are shown
when providers share an API model ID; the list does not guess a provider.

Every valid deprecation date produces a warning. Dates before today are marked
deprecated; today is marked “Deprecates today”; future dates are marked scheduled.
This follows the application's local-calendar date handling. Missing cards are
unknown, not evidence that a model has no deprecation date. Catalog failures leave
conversations usable and show a notice that warnings could not be checked.

Filters combine with AND; array fields match an exact selected item. Title search
is a case-insensitive literal substring. Filtering is local to the loaded list,
hides empty date headings, and updates a result count. Reset clears every filter,
including those under More filters. No filter data is persisted or sent upstream.

## Security contract

- Zone/principals: logged-in application users; no machine principals.
- Data: private conversation metadata and read-only shared model-card metadata.
- Capability: `chat.conversation.read`, using the existing Chat5 principal lookup
  and capability evaluator. Admin receives it by default; family/user require an
  explicit grant through the existing authorization policy.
- Scope: Conversation5 membership / legacy Conversation4 ownership, queried using
  the validated principal's name. No admin scope override. Catalog metadata is
  readable in this context; management still requires `ai.model_cards.manage`.
- Browser mutations/CSRF: none; safe GET and local DOM filtering only.
- Limits: no new request parameters, uploads, provider work, or regex execution;
  title input limited to 255 characters. Existing user-scoped list size is retained;
  one catalog query is restricted to model IDs present in that list.
- Rendering: escaped Pug text and attributes; DOM `textContent`; no inline handlers.
- Media/outbound services: none added. No new stored data or retention changes.
- Cache/analytics: private, no-store; analytics disabled.
- Logs: catalog degradation and failed list/principal loads use the shared logger
  with error names only, never conversation titles, summaries, or request data.
- Negative tests: missing/revoked capability and anonymous denial; member/owner
  query scoping; escaped hostile metadata; missing/ambiguous cards; catalog failure.
- Legacy dependencies: existing conversation list and pending-request services;
  no database migration, new environment variables, or deployment changes.
