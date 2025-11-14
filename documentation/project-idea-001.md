# Project Idea 001 – Chat Template Previewer & chat5_6 Event Split

## Goal
Modernise the Chat5 workspace by introducing a dedicated template preview panel and migrating socket handling to the `chat5_6` modular event architecture we outlined. The goal is to make template-driven conversations easier to operate, while improving maintainability by breaking the monolithic `chat5-append` handler into focused events.

## Scope Overview
- Build the `chat5_6` handler/context files with granular events (create, copy, append, batch trigger, settings updates, media append, helper utilities).
- Extend `TemplateService` to support the new `chat5_template` model, template caching, and template flag lookups.
- Surface template previews in the Chat5 UI with options to append context/messages/settings or trigger AI actions without mutating the base conversation.
- Update Chat5 routes, controllers, and Pug templates to wire the new socket channels and render template metadata.

## Key Code Touchpoints
- `socket_io/chat5_6/chat5_6handler.js`, `socket_io/chat5_6/chat5_6context.js`, `socket_io/chat5_6/chat5_6_documentation.md`.
- `services/templateService.js`, `services/conversationService.js`, `services/messageService.js`.
- `models/` – add a `Chat5TemplateModel` (Mongoose) storing conversation IDs, metadata, cached payloads.
- `controllers/chat5controller.js`, `routes/chat5.js`, and associated views under `views/chat5/`.
- `public/js/chat5/*.js` (if present) for client-side websocket wiring.

## Implementation Notes
1. **Socket refactor** – Scaffold `chat5_6` folder, create event handlers for create/copy/update/append/batch/title generation/etc. Reuse shared helpers from `chat5_5`, but ensure each event performs one responsibility and emits updated payloads (`chat5-conversation`, `chat5-settings`, `chat5-messages`).
2. **Template persistence** – Introduce a new template schema (conversationId, title, tags, cachedMessages, cachedSettings, updatedAt). Augment `TemplateService` with CRUD + cache refresh logic while keeping legacy template helpers intact.
3. **UI previewer** – Add a sidebar or modal in Chat5 that lists available templates, displays preview metadata (messages, settings), and exposes controls (append context, append messages, set settings, post & request AI response).
4. **Client wiring** – Update Chat5 front-end scripts to connect to `chat5_6` namespace, listen for new event names, and manage optimistic placeholders for AI/batch responses.
5. **Back compatibility** – Keep `chat5_5` running until the new socket is production-ready. Add configuration to toggle between implementations to ease rollout.

## Dependencies / Follow-ups
- Requires the template metadata database (Project Idea 009 can reuse it for agent-driven templating).
- After completion, update docs (`documentation/chat5_6_documentation.md`, README Chat section) and adjust tests under `tests/unit` to cover new service methods.
