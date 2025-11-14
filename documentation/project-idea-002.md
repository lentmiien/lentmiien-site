# Project Idea 002 – Chat With PDFs Pipeline

## Goal
Enable users to drop a PDF and kick off a Chat5 conversation seeded with page images, respecting page-count limits and leveraging the existing PDF→image converter. The workflow should feel native: upload PDF, preview selected pages, start or append to a conversation with those images attached, and optionally auto-trigger an AI summary.

## Scope Overview
- Reuse the Poppler-based PDF conversion (`mypagecontroller`) to generate JPEGs per page, enforce a configurable max-page limit, and cache outputs.
- Create a controller endpoint (or extend Chat5 APIs) that bundles converted images into a new chat conversation or appends to an existing one.
- Provide UI affordances in Chat5 (and/or a dedicated upload route) for selecting pages and confirming the chat hand-off.
- Handle cleanup of temp files and ensure conversations reference stored images under `public/img`.

## Key Code Touchpoints
- `controllers/mypagecontroller.js`, `routes/mypage.js` – adapt existing PDF conversion endpoints or move logic into a shared utility.
- `utils/pdf` helper (new) to encapsulate Poppler calls, file naming, and max-page enforcement.
- `services/messageService.js`, `services/conversationService.js` – extend to accept image arrays when bootstraping conversations.
- `socket_io/chat5_6` – add an event to create conversations from document batches.
- `public/temp/` for temporary storage, move to `public/img/` for images used in conversation (must move here before using in chat).
- `socket_io\chat5_6\chat5_6_documentation.md` - update with PDF pipeline.
- Chat UI in separate project, will be implemented based on `socket_io\chat5_6\chat5_6_documentation.md`.

## Implementation Notes
1. **Conversion module** – Wrap Poppler logic in a promise-based utility that outputs metadata (page number, file path, preview URL). Add max-page limit via env var (e.g., `CHAT_PDF_MAX_PAGES`).
2. **Upload UX** – Build a modal or separate route where the user uploads a PDF, inspects generated thumbnails, selects pages, and chooses conversation target (`new` or existing).
3. **Conversation seeding** – Create a backend handler that takes page image IDs, stores them via `MessageService`, and emits placeholder messages akin to user image append events.
4. **Cleanup** – Ensure `setup.js` or a scheduled job purges stale PDF conversions.
5. **Documentation** – Update `documentation/app-overview.md` and the Chat5 docs summarising the PDF pipeline and configuration.

## Dependencies / Follow-ups
- Relies on the modular Chat5 event system for clean image append events.
- Pairs well with future knowledge ingestion pipelines and AI summarisation agents (Project 009/010).
