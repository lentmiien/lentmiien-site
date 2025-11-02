## Chat5.5 Socket.IO Interface

This document maps the current Socket.IO contract that powers the Chat5.5 experience and describes the new history-loading endpoint that enables a Vue UI to consume conversation data without touching the legacy Pug views.

---

### 1. Connecting

```js
import { io } from 'socket.io-client';

const socket = io('/', {
  transports: ['websocket'],
  withCredentials: true,   // the server relies on the logged-in session
});
```

Once connected you have access to the events listed below. Most "get" style calls use acknowledgements, while streamed updates are pushed over dedicated events.

---

### 1.1 Validation & Feedback Events

- Each handler validates the incoming payload. If data is missing or malformed, the server emits `<event>:error` with `{ ok: false, message, details?, adjustments? }`. For ack-based calls the same payload is delivered through the acknowledgement callback.
- When values are coerced or defaults applied, `<event>:adjustments` is emitted so the UI can show info/warning toasts (severity levels mirror the history endpoint).
- Success responses for editor-style actions now include payloads: e.g. `chat5-editmessagearray-done` returns `{ ok, conversationId, length }`, `chat5-togglehidefrombot-done` returns `{ ok, messageId, state }`, and `chat5-edittext-done` returns `{ ok, messageId, type }`.

---

### 2. Conversation History (`chat5-history-range`)

**Purpose:** Fetch conversations updated inside an interval (optionally including messages) so a Vue client can build timelines, infinite scroll, etc.

**Emit**

```js
socket.emit(
  'chat5-history-range',
  {
    start: '2025-01-01T00:00:00Z',  // optional, defaults to (end - 30 days)
    end:   '2025-01-31T23:59:59Z',  // optional, defaults to now
    limit: 50,                      // optional, default 100, max 500
    includeMessages: true,          // include full message payloads
    includeLegacy: true,            // include Chat4-style archives
    matchIdsOnly: false,            // set to true to ignore date filters when ids are supplied (modern chats only)
    conversationIds: ['66f…'],      // optional filter
  },
  (response) => { /* see below */ }
);
```

**Ack response (`ok: true`)**

```json
{
  "ok": true,
  "conversations": [
    {
      "id": "6708c…",
      "title": "Product Brainstorm",
      "summary": "",
      "category": "Work",
      "tags": ["brainstorm"],
      "metadata": {
        "contextPrompt": "",
        "model": "gpt-5-2025-08-07",
        "maxMessages": 999,
        "tools": []
      },
      "members": ["lentmiien"],
      "messageIds": ["673…", "674…"],
      "messageCount": 12,
      "updatedAt": "2025-01-17T18:44:03.123Z",
      "updatedAtMs": 1737139443123,
      "createdAt": "2025-01-03T10:18:44.912Z",
      "source": "conversation5",
      "messages": [
        {
          "id": "674…",
          "role": "user",
          "type": "text",
          "content": { "text": "Draft Q1 roadmap" },
          "timestamp": "2025-01-17T18:42:12.000Z",
          "timestampMs": 1737139332000,
          "hideFromBot": false
        }
      ]
    }
  ],
  "meta": {
    "total": 18,
    "hasMore": false,
    "limit": 50,
    "nextCursor": null,
    "start": "2025-01-01T00:00:00.000Z",
    "end": "2025-01-31T23:59:59.000Z",
    "includeMessages": true,
    "includeLegacy": true,
    "matchIdsOnly": false,
    "pendingConversationIds": ["6708c…"],   // pending AI responses
    "categoryOrder": ["Work", "Personal"],
    "counts": { "modern": 12, "legacy": 6 },
    "adjustments": [
      { "field": "end", "message": "End date missing; using current time.", "severity": "info" },
      { "field": "limit", "message": "Missing limit; using default (100).", "severity": "info" }
    ],
    "sanitizedRequest": {
      "start": "2025-01-01T00:00:00.000Z",
      "end": "2025-01-31T23:59:59.000Z",
      "includeMessages": true,
      "includeLegacy": true,
      "matchIdsOnly": false,
      "limit": 50,
      "conversationIds": ["6708c…"]
    }
  }
}
```

**Ack response (`ok: false`)**

```json
{
  "ok": false,
  "message": "Failed to load conversation history.",
  "details": "error message"
}
```

**Notes**

- `adjustments` reports every field that was missing or malformed and the severity (`info` = default fill, `warning` = corrected bad input).
- `sanitizedRequest` echoes the exact values the server executed after validation.
- Modern chats (`source: "conversation5"`) keep rich metadata, member lists, and per-message timestamps.
- Legacy chats (`source: "conversation4"` and `legacy: true`) expose message transcripts only (`content.html` and `content.images`). They cannot currently bypass date filtering when `matchIdsOnly` is set.
- `pendingConversationIds` mirrors `conversationService.fetchPending()` so the UI can flag conversations still waiting for tool/LLM completions.
- Pagination is cursor-friendly: request the next slice by reusing `start` and a new `end` equal to the last `updatedAt` you received or by adjusting the window.

---

### 3. Real-time Chat Events

| Event | Direction | Payload | Description / Vue usage |
|-------|-----------|---------|--------------------------|
| `chat5-joinConversation` | emit | `{ conversationId }` | Join the per-conversation room before sending/receiving updates. |
| `chat5-leaveConversation` | emit | `{ conversationId }` | Leave the room when closing a tab or navigating away. |
| `chat5-append` | emit | `{ conversation_id, prompt, response, settings }` | Append user text and optionally trigger an AI response. `settings` mirrors the Settings tab fields. |
| `chat5-messages` | on | `{ id, messages }` | Stream of newly created messages (user + AI). Add them to local store if `id` matches the active conversation. |
| `chat5-notice` | on | `{ id, title }` | Broadcast when other members add messages. Show lightweight toasts/badges. |
| `chat5-updateConversation` | emit + ack | `{ conversation_id, updates }` | Persist metadata (title, category, tags, members, summary, settings). Acknowledge payload echoes the sanitized conversation. |
| `chat5-conversation-settings-updated` | on | `{ conversationId, title, … }` | Push notification after any client successfully updates settings. Merge into Vue store. |
| `chat5-generatetitle-up` | emit | `{ conversation_id }` | Asks the server to auto-title. |
| `chat5-generatetitle-done` | on | `{ title }` | Update the UI header / metadata with the generated title. |
| `chat5-generatesummary-up` | emit | `{ conversation_id }` | Request automatic summary. |
| `chat5-generatesummary-done` | on | `{ summary }` | Sync summary text once available. |
| `chat5-generatesummary-error` | on | `{ message }` | Show failure toasts if summarisation fails. |
| `chat5-uploadImage` | emit | `{ conversation_id, files: [{ name, type, buffer }] }` | Stream chunked image uploads. Expect `chat5-messages` with the newly created image message. |
| `chat5-editmessagearray-up` | emit | `{ conversation_id, newArray }` | Reorder message IDs (used by drag-and-drop editors). Ack: `chat5-editmessagearray-done` returns `{ ok, conversationId, length }`. |
| `chat5-togglehidefrombot-up` | emit | `{ message_id, state }` | Flag messages to exclude/include in future prompts. Ack: `chat5-togglehidefrombot-done` returns `{ ok, messageId, state }`. |
| `chat5-edittext-up` | emit | `{ message_id, type, value }` | Inline message edits (text/tts/revisedPrompt/toolOutput). Success emits `chat5-edittext-done`; watch `<event>:error` for validation failures. |
| `chat5-batch` | emit | `{ conversation_id, prompt, settings }` | Queue batch generation. Expect `chat5-messages` updates and/or `chat5-batch-error`. |
| `chat5-savetemplate` | emit + ack | `{ Title, Type, Category, TemplateText }` | Save a reusable template. Ack: `{ ok: true }` or `{ ok: false, message }`. |

Remember to remove listeners (or scope them via Vue components) to avoid duplicate handlers.

---

### 4. Suggested Vue State Flow

1. **Bootstrap:** Call `chat5-history-range` to load the first slice of conversations, hydrate Vue stores with metadata, tags, and pending IDs.
2. **Select conversation:** When the user opens a conversation:
   - emit `chat5-joinConversation`.
   - if messages were not preloaded, make a second `chat5-history-range` call with `conversationIds: [id], includeMessages: true, matchIdsOnly: true`.
3. **Live updates:** Listen for `chat5-messages`, `chat5-conversation-settings-updated`, and `chat5-notice`. Update the appropriate conversation in the store; update `updatedAt` so ordering stays fresh.
4. **Settings & summaries:** Use the `chat5-updateConversation`, `chat5-generatesummary-up`, and `chat5-generatetitle-up` flows to keep metadata in sync.
5. **Pagination:** When the user scrolls up, request older history by shifting the `end` parameter to the timestamp of the oldest loaded entry and repeat step 1.

---

### 5. Current Pug UI Walkthrough (`views/chat5_chat.pug`)

Understanding the existing page helps identify parity requirements before improving the design:

- **Header:** Shows title, Mongo ID, and an action button to create a knowledge entry. Conversation metadata (`conversationSource`) is embedded in data attributes.
- **Message log (`#conversationContainer`):**
  - Groups messages by `user_id` with horizontal separators and user labels.
  - Bot messages add an avatar (`/i/avatar.jpg`) and get a `.chat5-message--bot` class.
  - Each message shows a context-aware body:
    - `text` → rendered Markdown (`m.content.html`) with copy-to-clipboard buttons.
    - `image` → preview + caption.
    - `tool` / `reasoning` → rendered as italic blocks.
  - `.chat5-message--hidden` marks messages excluded from future prompts.
- **Tabs:** `Chat`, `Settings`, `Raw`.
  - **Chat tab:** File upload field, rich text editor (Toast UI), template picker & saver, send buttons (Append, Send & Response, Response, batch operations), and an audio placeholder.
  - **Settings tab:** Form-driven controls for metadata (title, category, tags, summary, context prompt, reasoning/verbosity/limit toggles, tools multiselect, member list).
  - **Raw tab:** Displays raw JSON for debugging.
- **Modal tooling:** Hidden sections exist for editing raw message arrays, toggling hide-from-bot flags, updating assistant responses, and editing text snippets.
- **Client scripts:** Injected data (`window.chatTemplates`, `window.chatModels`) and in-page JS wiring for template selectors and warning banners.

This layout offers two key behaviours to keep in mind when designing the Vue replacement:

1. **Sticky composition tools:** The editor and controls are near the message log, enabling quick prompt iteration.
2. **Metadata at hand:** Category/tags/tools/members adjustments are a single tab away.

---

### 6. Ideas for Vue Enhancements

- Collapsible/virtualised message list to handle long conversations without overwhelming the DOM. Combine with `hideFromBot` badges surfaced inline.
- Sticky or floating input bar so the prompt editor is always reachable while reviewing history.
- Context side panel that surfaces settings, model choice, and pending status without losing scroll position.
- Batch/summarisation status chips on the conversation list using `pendingConversationIds` and `categoryOrder` metadata.
- Quick filters driven by the tags and categories returned from `chat5-history-range`.

With the new history endpoint and existing real-time events, the Vue client can progressively fetch data, keep optimistic state in sync, and optionally migrate brand-new UX elements without regressing existing server capabilities.
