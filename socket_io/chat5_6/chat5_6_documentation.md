# chat5_6 Socket API

The `chat5_6` handler introduces a modular event model for Chat5 conversations. Each event focuses on a single task and can be acknowledged via a callback or by listening for `eventName:done` responses. Errors are emitted on the shared `chat5_6-error` channel.

All payloads are JSON objects unless otherwise noted. Optional fields are marked with `(optional)`.

## Core Events

| Event | Purpose | Key Payload Fields |
| --- | --- | --- |
| `chat5_6-joinConversation` | Subscribe current socket to a conversation room | `conversationId` (string) |
| `chat5_6-leaveConversation` | Leave a conversation room | `conversationId` (string) |
| `chat5_6-fetchConversation` | Fetch conversation metadata + messages (auto converts chat4) | `conversationId` (string) |
| `chat5_6-createConversation` | Reuse empty chat5 convo for user or create a new one | `settings` (object, optional), `properties` (object, optional) |
| `chat5_6-copyConversation` | Copy chat4/chat5 into a new chat5 conversation | `sourceConversationId` (string), `deepCopy` (bool, optional) |
| `chat5_6-updateSettings` | Update metadata (model, context, etc.) and/or details (category, tags, members) | `conversationId` (string), `settings` (object optional), `details` (object optional) |
| `chat5_6-appendMessage` | Append a user text message | `conversationId` (`'NEW'` creates), `text` (string) |
| `chat5_6-appendImage` | Append user image; supports upload or existing filename | `conversationId`, `name` or `fileName`, `buffer` / `data` (optional) |
| `chat5_6-requestAIResponse` | Ask configured model for an immediate response (creates placeholder) | `conversationId` |
| `chat5_6-requestAIBatch` | Queue a batch response (placeholder + batch job) | `conversationId`, `prompt` (optional) |
| `chat5_6-generateTitle` | Ask model for a title and persist | `conversationId` |
| `chat5_6-generateSummary` | Generate + store summary | `conversationId` |
| `chat5_6-updateMessageArray` | Overwrite message ordering | `conversationId`, `messages` (array of ids) |
| `chat5_6-toggleHideFromBot` | Toggle `hideFromBot` flag on a message | `messageId`, `state` (bool) |
| `chat5_6-editMessageText` | Update stored text fields on a message | `messageId`, `type`, `value` |

## Template Events

| Event | Purpose | Key Payload Fields |
| --- | --- | --- |
| `chat5_6-template-list` | List template conversation ids | — |
| `chat5_6-template-add` | Flag a conversation as template (caches immediately) | `conversationId` |
| `chat5_6-template-remove` | Remove conversation from template list | `conversationId` |
| `chat5_6-template-fetch` | Fetch one template or all (optionally refresh cache) | `conversationId` (optional), `refresh` (bool optional) |
| `chat5_6-template-refresh` | Refresh one or all templates | `conversationId` (optional) |
| `chat5_6-template-apply` | Apply template data to a target conversation | `templateId`, `conversationId`, `mode`, `options` |

### Template Apply Options

- `options.appendMessages` – Append cloned template messages (always cloned to avoid mutating templates).
- `options.applyContext` – Append template context to conversation metadata.
- `options.applySettings` – Replace conversation metadata + (category, tags) with template values.
- `mode`:
  - `update`: Apply selected options only.
  - `post`: Apply options and request immediate AI response.
  - `postOnly`: Apply options temporarily, request AI, then revert conversation to its original state (the AI reply is appended when ready).

All template operations rely on the new `chat5_template` collection and the extended `TemplateService` cache. Cached items are automatically refreshed when retrieved with `refresh: true`.

## Responses & Errors

- Success without an acknowledgement callback emits `<eventName>:done`.
- Errors emit `chat5_6-error` with `{ event, message, details? }`.
- Message broadcasts use `chat5_6-messages` payloads `{ id, messages }`.
- Conversation updates use `chat5_6-conversationUpdated`.
- Derived results (title/summary) emit `chat5_6-titleGenerated` / `chat5_6-summaryGenerated`.

## Conversation Workflow

1. **Create/Reuse:** `chat5_6-createConversation` returns an empty conversation id ready for reuse.
2. **Join Rooms:** `chat5_6-joinConversation` must be called per socket before message broadcasts are received.
3. **Update Settings:** Use `chat5_6-updateSettings` to adjust metadata or membership independently of message flow.
4. **Post Messages:** `chat5_6-appendMessage` / `chat5_6-appendImage` handle user payloads; AI requests are separated (`chat5_6-requestAIResponse` / `chat5_6-requestAIBatch`).
5. **Template Actions:** Manage templates through the dedicated events; applying templates always clones message documents.

## Template Service Additions

`services/templateService.js` now supports:

- `listChat5TemplateIds`, `addChat5Template`, `removeChat5Template`
- `getChat5Template`, `fetchChat5Templates`, `refreshChat5Template`, `refreshAllChat5Templates`
- In-memory cache with automatic refresh timestamps, powered by `chat5_template` model.

Message cloning utilities (`cloneMessages`, `createMessagesFromSnapshots`, `deleteMessages`) live in `messageService.js` and are used by conversation and template flows.
