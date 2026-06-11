# Lentmiien Personal Platform

This Node.js/Express application drives my personal website—a hybrid portfolio, experimentation lab, and daily-operations hub where I explore AI-assisted workflows, data tooling, and household automation. The codebase bundles production-ready utilities (budgeting, cooking, health tracking, payroll), rich AI tooling (multi-provider chat, document knowledge base, batch workflows), and media pipelines (Sora video, ComfyUI/OpenAI image generation, ASR/TTS audio workflows, Dropbox backups).

## Highlights

- **Chat5 Studio:** Real-time chat workspace with Socket.IO, model switching (OpenAI, Anthropic, Google, Groq, LM Studio), knowledge injection, reusable templates, AI model cards, story mode playback, and audit-friendly message editing.
- **Media Generation Pipeline:** Sora 2 Studio for OpenAI video jobs, background polling/webhooks, ComfyUI and OpenAI image generation with caching, PDF-to-image conversion, ASR/TTS workflows, OCR tooling, and gallery ratings with Dropbox backups.
- **Operations & Productivity Suite:** Unified accounting workspace (budgets, cards, analytics), receipt OCR, customs-ready product summaries, payroll builder, cooking calendar v2 with cookbook-first recipe handling, a dedicated cookbook module, unified shopping list, health tracker, quick notes, emergency stock, and a schedule-task planner.
- **Automation & Integrations:** Startup maintenance, OpenAI usage harvesting, Dropbox sync, GitHub repository mirroring, temporary file transfer tool, Mailgun notifications, performance metrics, database usage alerts, hidden public to-buy intake, and bearer-protected API access.
- **Experimentation Sandbox:** Markdown editor demos, browser games with Brotli assets, reference materials, and agent orchestration docs (`AGENTS.md`, `documentation/framework.md`).
- **Documentation & Quality:** Centralized guides and prompt libraries in `documentation/`, plus Jest-backed service tests with coverage artifacts under `coverage/`.

## Architecture

- **Server & Domain Layer:** `app.js` wires Express, session management, Passport-local auth, and role-based permissions. Routers in `routes/` map to task-focused controllers inside `controllers/`, which delegate domain logic to `services/` and persistence to Mongoose models (`models/` via `database.js`).
- **Realtime Collaboration:** `socket_io/` exposes namespaces for Chat5 conversation updates, typing indicators, and notification fan-out.
- **Data & Storage:** MongoDB backs all domain entities (chat transcripts, knowledge, budgets, cooking schedules, Sora videos, audio jobs, OCR jobs, performance snapshots, etc.). Local directories (`cache/`, `tmp_data/`, `public/`, `logs/`, `github-repos/`) store generated media, working files, log archives, repo mirrors, and cached prompts.
- **Background Workflows:** `setup.js` provisions folders, converts legacy images, prunes logs, syncs OpenAI usage, and clears temp data before each start. Schedulers handle batch triggers, DB usage monitoring, Agent5 runs, and pending OpenAI response recovery, while `controllers/webhook.js` consumes OpenAI webhooks to finalize batches and media jobs.
- **Frontend Rendering:** Views live in `views/` (Pug) and ship compiled assets from `public/` (JS/CSS/audio/mp3/video). `/games` serves static WebAssembly/HTML bundles with gzip/Brotli.

## Directory Reference

| Path | Description |
| --- | --- |
| `app.js` | Express entry point, auth wiring, route registration, game hosting. |
| `routes/` | HTTP routers that enforce auth and forward requests to controllers. |
| `controllers/` | Feature-specific request handlers (Chat5, cooking + cookbook, shopping list, budget, Sora, image/OCR/audio generation, admin, etc.). |
| `services/` | Domain services for chat, messaging, cooking calendars, budgets, scheduling, GitHub sync, ASR/TTS, performance metrics, and more. |
| `middleware/` | Shared Express middleware, currently including request performance instrumentation. |
| `models/` | Mongoose schemas (chat history, AI cards, payroll, receipts, schedule tasks, cookbook recipes, Sora videos, prompts). |
| `socket_io/` | Socket.IO bootstrap and chat event handlers. |
| `views/` | Pug templates for dashboards, forms, modals, and media viewers. |
| `public/` | Client assets including compiled JS, CSS, `imgen/` cache, `audio/` uploads, generated `mp3/` and `video/` output, OCR previews, and `temp/` uploads. |
| `public/yaml/` | OpenAPI specs served via `/yaml-viewer` (`core-api.v1.yaml`, `schedule-task.v1.yaml`, `chat5-pdf.v1.yaml`, `chat5-realtime.v1.yaml`, `product-details.v1.yaml`). |
| `games/` | Standalone web games served via `express-static-gzip`. |
| `github-repos/` | Local clone cache managed by `GitHubService`. |
| `schedulers/` | Background triggers (batch automation, DB usage checks, Agent5 runner, OpenAI response recovery) started at app boot. |
| `scripts/` | Maintenance scripts such as OpenAPI validation. |
| `tests/` | Jest tests (`tests/unit` plus startup diagnostics coverage in `tests/startupChecks.test.js`). |
| `documentation/` | Architecture notes, testing guide, prompt catalog, and color reference used alongside `AGENTS.md`. |
| `coverage/` | Generated Jest coverage reports (`npm test`). |
| `cache/`, `tmp_data/`, `logs/` | Generated caches, ephemeral transfers, and rolling log files maintained by `setup.js`. |
| `sample_data/` | Sample datasets used by demos and import/testing flows. |

### Accounting Workspace

- Visit `/accounting` (or `/budget`) for the unified budgeting + credit card experience. Navigation links route to the same controller, and `/accounting/legacy` still exposes the pre-v2 screens.
- The hero summarises cash on hand, current spend, credit utilisation, and active alerts.
- Analytics cards render cash-flow trends, category breakdowns, and credit utilisation using the new `accounting_dashboard.js`.
- The workspace section keeps legacy transaction ingestion tooling (category chart, autocomplete form, last-30-day rollups) while the credit card panel embeds the richer tracker with CSV import, confirmations, and utilisation metrics.

## Getting Started

### Prerequisites
- Node.js 18+ and npm.
- MongoDB instance reachable via `MONGOOSE_URL`.
- API credentials for the services you plan to activate:
  - OpenAI (chat, Sora/video, usage API).
  - Anthropic, Google Gemini, Groq, LM Studio (optional chat providers).
  - Dropbox API (image backups), Mailgun (notifications), GitHub PAT (repo mirroring).
  - ComfyUI and/or OpenAI image APIs for generated-image workflows.
  - AI Gateway/Ollama, ASR, TTS, OCR, and bin-packing HTTP backends if you enable those local tools.
- (Optional) Access to a built Vue bundle for `VUE_PATH`.

### Setup

1. Clone the repository  
   ```bash
   git clone https://github.com/lentmiien/lentmiien-site.git
   cd lentmiien-site
   ```
2. Copy the environment template and fill in secrets  
   ```bash
   cp env_sample .env
   ```
3. Install dependencies  
   ```bash
   npm install
   ```
4. Run the app (executes `setup.js` first to prep caches/logs and fetch usage)  
   ```bash
   npm start
   ```
5. Visit `http://localhost:8080` (or your chosen `PORT`). Authenticated features require a Mongo user entry; create one manually or via the admin tools after logging in.

### Useful Local Routes

- `/chat5` - Chat workspace with templates, knowledge browser, and pending queue.
- `/sora` - Sora 2 Studio dashboard with job filters, polling, and ratings.
- `/image_gen` - ComfyUI job queue, cached output browser, prompt library.
- `/gpt-image` - OpenAI image generation workflow.
- `/accounting` or `/budget` - Budget v2 dashboard, transaction review, credit cards, analytics APIs.
- `/cooking` - Legacy cooking calendar (v1) view and edit flow.
- `/cooking/v2` - Cooking calendar v2 with recipe usage stats, recommendations, and cookbook-first selection.
- `/cooking/cookbook` - Cookbook management UI (list, create, edit, per-recipe ratings, optional variants).
- `/shopping-list` - Unified shopping checklist combining to-buy tasks, emergency stock gaps, and upcoming recipe ingredients.
- `PUBLIC_TOBUY_LIST_PATH` - Hidden public route for adding to-buy items without logging in.
- `/scheduleTask/calendar` - Task & presence planner with overlap detection.
- `/ocr`, `/ocr-tts`, `/asr`, `/music` - Local OCR, OCR-to-speech, ASR, and music generation tools.
- `/ai-cluster-planner` - AI hardware/cluster planning workspace.
- `/tmp-files` - Authenticated temporary file shuttle (admin only).
- `/admin` & `/admin/manage_roles` - User/role management.
- `/admin/performance`, `/admin/database_usage`, `/admin/ai-gateway`, `/admin/audio-workflow` - Runtime dashboards and admin tooling.
- `/yaml-viewer` - Swagger UI for YAML specs stored under `public/yaml/`.

## Environment Variables

| Variable | Notes |
| --- | --- |
| `PORT` | Express listen port (defaults to 8080). |
| `SESSION_SECRET` | Required session signing secret. |
| `MONGOOSE_URL` | MongoDB connection string. |
| `OPENAI_API_KEY` | Primary OpenAI key for chat, OCR, and product summaries. |
| `OPENAI_API_KEY_PRIVATE` | Elevated OpenAI key for Sora/video and image pipelines. |
| `OPENAI_ADMIN_KEY` | Usage-scoped key used by `setup.js` to archive daily usage stats. |
| `OPENAI_WEBHOOK_SECRET` | Shared secret to validate OpenAI webhook payloads (`/webhook/openai`). |
| `OPENAI_WEBHOOK_TOLERANCE_SECONDS`, `OPENAI_WEBHOOK_FALLBACK_TOLERANCE_SECONDS` | Strict and fallback timestamp windows for webhook signature verification. |
| `OPENAI_PENDING_RECONCILE_INTERVAL_MS`, `OPENAI_PENDING_RECONCILE_BATCH_SIZE` | Cadence and batch size for recovering pending OpenAI responses when webhook delivery is missed. |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | Optional provider keys surfaced in Chat5. |
| `DISABLE_LOCAL` | Set to `TRUE` to hide the LM Studio provider integration. |
| `AI_GATEWAY_BASE_URL` | Local AI gateway base URL used by admin dashboards, music generation, and Ollama fallback clients. |
| `LLM_ADMIN_TOKEN` | Optional `X-Admin-Token` sent to protected AI Gateway admin endpoints. |
| `OLLAMA_BASE_URL`, `OLLAMA_GEMMA4_MODEL` | Optional Ollama host/model overrides for local model testing. |
| `GITHUB_TOKEN` | GitHub PAT used by `GitHubService` to mirror repos under `github-repos/`. |
| `DROPBOX_API_KEY`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `DROPBOX_REDIRECT_URI` | Dropbox credentials for image backups. |
| `MAILGUN_API_KEY` | Optional Mailgun key for notifications in `MessageService`. |
| `MAILGUN_DOMAIN` | Mailgun domain used for startup/crash alerts. |
| `LOG_LEVEL` | Minimum JSON log level (`debug`, `notice`, `warning`, or `error`; defaults to `debug`). |
| `STARTUP_ALERT_EMAIL` | Comma-separated list of recipients for startup diagnostics emails (Mailgun). |
| `STARTUP_ALERT_FROM` | Optional friendly from name for diagnostics emails. |
| `STARTUP_SLACK_WEBHOOK_URL` | Incoming webhook for Slack/Teams alerts when diagnostics fail. |
| `STARTUP_MIN_DISK_MB` | Minimum free disk (in MB) enforced during preflight (defaults to `200`). |
| `STARTUP_REQUIRED_ENV_VARS` | Comma-separated overrides for the env vars validated during preflight. |
| `STARTUP_SKIP_MONGO_CHECK` | Set to `true` to bypass the Mongo connectivity check (e.g., offline dev). |
| `PERFORMANCE_METRICS_ENABLED` | Set to `false` to disable request/task performance snapshots. |
| `PERFORMANCE_METRICS_INTERVAL_MS`, `PERFORMANCE_SLOW_REQUEST_THRESHOLD_MS`, `PERFORMANCE_EVENT_LOOP_RESOLUTION_MS` | Collector interval, slow-request threshold, and event-loop sampling resolution. |
| `PERFORMANCE_SNAPSHOT_RETENTION_DAYS`, `PERFORMANCE_SLOW_REQUEST_RETENTION_DAYS` | Mongo TTL retention for performance snapshots and slow request records. |
| `DB_USAGE_ALERT_WEBHOOK`, `DB_USAGE_ALERT_INTERVAL_MINUTES` | Optional webhook and polling interval for database usage alerts. |
| `SORA_STATUS_POLL_MS`, `SORA_STATUS_POLL_BATCH` | Background polling interval and batch size for pending Sora videos. |
| `COMFY_API_BASE`, `COMFY_API_KEY` | ComfyUI REST endpoint + key for `/image_gen`. |
| `ASR_API_BASE`, `TTS_API_BASE` | Local ASR and TTS service endpoints used by `/asr`, `/ocr-tts`, and the audio workflow. |
| `AUDIO_WORKFLOW_LLM_MODEL` | Default model used by audio workflow triggers. |
| `AUDIO_WORKFLOW_TTS_VOICE`, `AUDIO_WORKFLOW_TTS_VOICE_EN`, `AUDIO_WORKFLOW_TTS_VOICE_JP`/`AUDIO_WORKFLOW_TTS_VOICE_JA`, `AUDIO_WORKFLOW_TTS_VOICE_SV` | Default TTS voices, including language-specific overrides. |
| `AUDIO_WORKFLOW_TTS_FORMAT`, `AUDIO_WORKFLOW_QUALITY_PLOT_LIMIT` | Output audio format and quality-review chart limit for the audio workflow admin page. |
| `OCR_API_BASE_URL`, `OCR_API_TIMEOUT_MS` | OCR/OCR-to-speech backend endpoint and timeout. |
| `OCR_JOB_MAX_FILES`, `OCR_JOB_PAGE_SIZE`, `OCR_JOB_RECENT_DAYS` | Upload limit and list filtering controls for OCR jobs. |
| `BIN_PACKING_API_URL` | External bin-packing service endpoint used by `/api/binpacking`. |
| `CHAT_PDF_MAX_PAGES` | Maximum pages accepted by Chat5 PDF conversion/import. |
| `CHAT_PDF_MAX_AGE_HOURS` | Retention window (hours) before stale PDF conversion jobs are cleaned up. |
| `EMBED_API_BASE` | Base URL for the standard embedding API backend. |
| `EMBED_API_BASE_HQ` (`EMBED_HQ_API_BASE`) | Optional high-quality embedding backend URL (falls back to `EMBED_API_BASE`). |
| `GALLERY_PATH` | Filesystem path scanned by the gallery for image ratings/slideshows. |
| `VUE_PATH` | Optional absolute path to a built Vue frontend served to authenticated users. |
| `API_KEY` | Bearer token required for `/api` automation routes. |
| `API_TIER1_USER_ID`, `API_TIER2_USER_ID` | User IDs required by `/api/records` endpoints after bearer-token authentication. |
| `PUBLIC_TOBUY_LIST_PATH` | Hidden public route for the shared to-buy form; generated and persisted to `.env` if omitted. |
| `REQUEST_COUNTER_PATH` | Hidden public GET endpoint for the request counter; `GET <path>?package=<name>` records and evaluates by package category, missing packages are stored as `unknown`, and `GET <path>/status` returns the same plain `OK`/`NG` format without recording. Generated and persisted to `.env` if omitted. |
| `employeeNo`, `employeeName`, `department` | Default payroll metadata injected into forms. |
| `HIDE_GTAG` | Set to `YES` to suppress Google Analytics tags. |

> Keep `.env` out of version control. `setup.js` warns if the file is missing.

### Startup Diagnostics & Alerts

`setup.js` now runs a structured diagnostics pipeline before `npm start` completes:

- **Preflight** validates required env vars, disk space, and Mongo connectivity (configurable via `STARTUP_*` vars).
- **Section runners** wrap each maintenance task (temp cleanup, PDF pruning, DB hygiene, Dropbox sync) with scoped logging, retries for network operations, and a final JSON summary logged under `startup:summary`.
- **Alerting** optionally sends Slack webhook and/or Mailgun emails when diagnostics fail. Configure `STARTUP_SLACK_WEBHOOK_URL`, `STARTUP_ALERT_EMAIL`, `STARTUP_ALERT_FROM`, and `MAILGUN_DOMAIN` to receive notifications.
- **Interpretation guide** lives in `documentation/startup-diagnostics.md` with troubleshooting steps and log categories.

The summary object contains section-level timings and statuses (`ok`, `warning`, `failed`, `skipped`). Any critical failure stops the start command and emits an alert so you can fix the underlying issue before the server boots.

## npm Scripts

| Script | Description |
| --- | --- |
| `npm start` | Runs `setup.js` (cache prep, cleanup, usage sync) and then launches `node app`. |
| `npm test` | Executes the Jest suite (`tests/**/*.test.js`) and writes coverage to `coverage/`. |
| `npm run cleanup:vector-embeddings` | Dry-runs the standard `vector_embeddings` cleanup using a 90-day retention window. |
| `npm run cleanup:vector-embeddings:execute` | Deletes standard `vector_embeddings` entries older than 90 days; high-quality embeddings are not touched. |
| `npm run test:ollama:gemma4` | Runs the standalone Gemma 4/Ollama tool-calling smoke test. |
| `npm run lint:openapi` | Validates curated YAML specs with `@apidevtools/swagger-parser`. |
| `npm run git_test` | Runs a local `git_test.js` ad-hoc GitHub automation script when that ignored file exists. |
| `npm run codex` | Launches the Codex CLI helper. |
| `npm run codex-update` | Installs the latest `@openai/codex` globally. |
| `npm run codex-todo` | Directs Codex to action tasks from `todo.txt`. |
| `npm run codex-commit` | Runs Codex in commit mode to create a commit for pending changes. |

> `npm run git_test` expects a local `git_test.js` (ignored by git), so it will fail on a fresh clone unless you create that script.

## Feature Deep Dive

- **Chat5 & Knowledge Ops:** Multi-conversation management, knowledge tagging, template injection, AI model card catalog, story mode audio/cover builder, batch processing via `BatchService`, webhook-driven streaming into Socket.IO rooms, and conversation editing with media uploads.
- **Batch & Repository Automation:** `batchService` queues OpenAI batch jobs, while `GitHubService` mirrors repos under `github-repos/` for offline browsing with folder trees and file previews.
- **Media Workflows:** `/sora` orchestrates Sora 2/2 Pro jobs with background polling, webhook reconciliation, rating filters, and video caching under `public/video`. `/image_gen` manages ComfyUI prompt libraries, caching of bucket assets, and image ratings, while `/gpt-image` covers OpenAI image generation. `/asr`, `/ocr`, `/ocr-tts`, and `/admin/audio-workflow` coordinate transcription, OCR extraction, TTS output, trigger rules, and quality review. Dropbox helpers back up generated assets automatically.
- **Life & Finance Tooling:** Cooking calendar v2 tracks actuals versus planned meals, analytics, and recipe library usage, now prioritising cookbook records when available. The cookbook module adds structured recipe storage, variant notes, and per-recipe ratings. `/shopping-list` unifies to-buy tasks, emergency stock deficits, and cookbook/knowledge-derived ingredients for upcoming meals. Budget v2 exposes dashboards plus JSON APIs for category analysis. Receipts and payroll controllers parse uploads into structured records. Product customs summaries use GPT-4.1 with Zod validation. The schedule task planner blocks overlapping presence events.
- **Health Analytics & Alerts:** `/health` now layers moving averages, Chart.js trends, alert banners, and CSV exports on top of daily health logs. Each entry captures measurement metadata, tags, notes, and personalised thresholds that feed the `/health/analytics` API plus cached summaries in `cache/health_insights.json`.
- **Admin & Utilities:** Admin module manages users/roles, views JSON log files (`logs/*.log`), inspects OpenAI usage, monitors AI Gateway health, surfaces performance snapshots, and reviews database usage. `/tmp-files` offers a size-limited drop zone that cleans up automatically. `/games` lists bundled games served with gzip/Brotli, and the generated `PUBLIC_TOBUY_LIST_PATH` route exposes a rate-limited public add form for shared shopping tasks.
- **Documentation & OpenAPI:** `/yaml-viewer` now highlights domain badges, spec summaries, and copy-ready cURL snippets for `core-api`, `schedule-task`, `chat5-pdf`, `chat5-realtime`, and `product-details` specs in `public/yaml/`; run `npm run lint:openapi` to validate the default curated set, and keep leveraging `documentation/` + `AGENTS.md` for the broader architecture/testing/prompt playbooks.

### API Documentation Workflow

- `public/yaml/core-api.v1.yaml` covers the `/api/*` endpoints (bin packing, health logs, chat exports, automation helpers) with shared schemas and sample payloads.
- `public/yaml/schedule-task.v1.yaml` documents `/scheduleTask/api/*` (task CRUD, presence overlap detection, palette feed) so automations can mirror the UI without reverse-engineering controllers.
- `public/yaml/chat5-pdf.v1.yaml` explains the PDF-to-image intake flow that precedes `chat5_6-importPdfPages`, while `public/yaml/chat5-realtime.v1.yaml` captures Socket.IO events via a custom `x-socketio` extension.
- `public/yaml/product-details.v1.yaml` documents customs/product summary endpoints used by the product details workflow.
- `/yaml-viewer` lists every spec with domain badges, highlights, and ready-to-run snippets; click “Open in Viewer” for Swagger UI or “View JSON” for the parsed document.
- `npm run lint:openapi` (powered by `scripts/validate-openapi.js` and `@apidevtools/swagger-parser`) validates the curated default set; pass filenames to include additional specs such as `product-details.v1.yaml`.

## Data & File Management

- `public/img`, `public/video`, `public/imgen`, `public/audio`, and generated `public/mp3` hold media outputs and uploads. `setup.js` converts legacy PNGs to JPG and removes low-rated Sora videos (rating 1).
- `public/ocr` and `public/ocr_tts` are generated preview/output folders for OCR tools.
- `tmp_data/` is purged on every startup; use `/tmp-files` for transient transfers.
- `cache/` stores JSON caches (`chat3vdb.json`, `default_models.json`, embeddings).
- `logs/` retains seven days of structured logs (JSON-per-line). Older files are pruned automatically.
- `sample_data/` contains datasets used in demos and ingestion flows.
- `coverage/` is produced by Jest runs; open `coverage/lcov-report/index.html` after `npm test` for an HTML report.

## Testing & Verification

- Jest is configured via `jest.config.js` to target `tests/**/*.test.js` (service-layer units plus startup diagnostics tests). Run `npm test` to execute the suite and generate coverage inside `coverage/`.
- Use `npm test -- --watch` for iterative development; HTML coverage lives at `coverage/lcov-report/index.html`.
- `documentation/testing-guide.md` outlines additional manual scenarios (Sora, ComfyUI, Dropbox). When running those flows, monitor `logs/` for notices/errors emitted by `utils/logger`.
- Keep Mongo indexes aligned with new models and confirm external integrations with sandbox credentials before enabling them in production.

## Contributing & Support

This is primarily a personal playground, but ideas, bug reports, and pull requests are welcome. Highlight API key requirements, potential data migration steps, and include screenshots/GIFs for UI tweaks.

## License

Distributed under the MIT License. See [`LICENCE`](LICENCE) for details.
