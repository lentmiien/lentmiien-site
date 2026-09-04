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
- **Background Workflows:** `setup.js` provisions folders, converts legacy images, prunes logs, syncs OpenAI usage, and clears temp data before each start. Schedulers handle log retention, batch triggers, DB usage monitoring, Agent5 runs, and pending AI response recovery, while `controllers/webhook.js` consumes OpenAI and Ollama Gateway webhooks.
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
| `schedulers/` | Background triggers (batch automation, DB usage checks, Agent5 runner, AI response recovery) started at app boot. |
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
- `/codex` - Persisted Codex workspace sessions, turns, queue state, and usage accounting.
- `/admin/ask-lennart` - Durable inbox for responding to Chat5 human-action tool calls.
- `/codex-log-review` - Admin workflow for scheduled production-log analysis, reviewed fixes, and commit/push follow-ups.
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
- `/admin/runpod` - Admin-only Runpod REST API v2 catalog, durable account/per-Pod billing, usage archives, private Ollama templates, GPU picker, and guarded Pod lifecycle controls.
- `/admin/qwen3-lora`, `/admin/qwen3-qlora` - Train and test Qwen3 LoRA and 32B QLoRA adapters through the AI Gateway.
- `/yaml-viewer` - Swagger UI for YAML specs stored under `public/yaml/`.

## Environment Variables

| Variable | Notes |
| --- | --- |
| `PORT` | Express listen port (defaults to 8080). |
| `SESSION_SECRET` | Required session signing secret. |
| `MONGOOSE_URL` | MongoDB connection string. |
| `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_RETRY_INITIAL_MS`, `DATABASE_RETRY_MAX_MS` | MongoDB startup attempt deadline and capped exponential retry delays (defaults: 10 seconds, 2 seconds, and 30 seconds). |
| `DATABASE_OUTAGE_ALERT_AFTER_MS`, `DATABASE_OUTAGE_NOTIFICATION_RETRY_MS`, `DATABASE_OUTAGE_NOTIFICATION_MAX_ATTEMPTS` | Grace period and bounded delivery retry policy for the emergency Pushover alert (defaults: 30 seconds, five minutes, three attempts). |
| `DATABASE_INCIDENT_FLUSH_RETRY_MS`, `DATABASE_INCIDENT_RETENTION_DAYS` | Retry cadence for importing the local outage spool and MongoDB TTL retention for recovered incident records (defaults: one minute and 90 days). |
| `OPENAI_API_KEY` | Primary OpenAI key for chat, OCR, and product summaries. |
| `OPENAI_API_KEY_PRIVATE` | Elevated OpenAI key for Sora/video and image pipelines. |
| `OPENAI_ADMIN_KEY` | Usage-scoped key used by `setup.js` to archive daily usage stats. |
| `OPENAI_WEBHOOK_SECRET` | Shared secret to validate OpenAI webhook payloads (`/webhook/openai`). |
| `OPENAI_WEBHOOK_TOLERANCE_SECONDS`, `OPENAI_WEBHOOK_FALLBACK_TOLERANCE_SECONDS` | Strict and fallback timestamp windows for webhook signature verification. |
| `OPENAI_PENDING_RECONCILE_INTERVAL_MS`, `OPENAI_PENDING_RECONCILE_BATCH_SIZE` | Cadence and batch size for recovering pending OpenAI or Ollama responses when webhook delivery is missed. |
| `OPENAI_PENDING_MAX_AGE_MS`, `OPENAI_PENDING_MAX_ATTEMPTS` | Shared pending-response recovery limits (defaults: 48 hours and 50 attempts). Polling runs every minute for 10 minutes, every 5 minutes until one hour, hourly until one day, then every 6 hours. |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | Optional provider keys surfaced in Chat5. |
| `DISABLE_LOCAL` | Set to `TRUE` to hide the LM Studio provider integration. |
| `AI_GATEWAY_BASE_URL` | Local AI gateway base URL used by admin dashboards, music generation, and Ollama fallback clients. |
| `RUNPOD_API_KEY` | Dedicated Runpod REST API v2 credential for catalog/billing reads plus Pod and private-template management. Use the narrowest provider scope that supports those operations. |
| `RUNPOD_API_TIMEOUT_MS`, `RUNPOD_API_CACHE_TTL_MS` | Runpod v2 outbound request deadline and short in-memory cache duration (defaults: 10 seconds and 30 seconds). |
| `RUNPOD_MAX_ACTIVE_PODS`, `RUNPOD_MAX_GPU_COUNT`, `RUNPOD_MAX_HOURLY_COST_USD` | Server-side Runpod concurrency and cost ceilings (defaults: 2 active Pods, 4 GPUs per Pod, and $10/hour). |
| `RUNPOD_DEFAULT_AUTO_STOP_MINUTES`, `RUNPOD_MAX_RUNTIME_MINUTES` | Default and maximum automatic Pod stop windows (defaults: 60 minutes and 24 hours). |
| `RUNPOD_PROVISION_TIMEOUT_MS`, `RUNPOD_OLLAMA_PULL_TIMEOUT_MS`, `RUNPOD_POLL_INTERVAL_MS` | Bounded Ollama provisioning, model-pull, and polling timings (defaults: 10 minutes, 10 minutes, and 5 seconds). |
| `RUNPOD_BILLING_HISTORY_START`, `RUNPOD_BILLING_SYNC_INTERVAL_MS` | First persisted UTC billing month and periodic v2 billing refresh interval (defaults: `2025-11-01` and 6 hours; interval is bounded to 15 minutes–24 hours). |
| `CSRF_ALLOWED_ORIGINS` | Optional comma-separated browser origins accepted by the shared session CSRF guard when the trusted-proxy-derived origin is insufficient. |
| `QWEN3_QLORA_INFO_TIMEOUT_MS`, `QWEN3_QLORA_ACTION_TIMEOUT_MS`, `QWEN3_QLORA_UPLOAD_TIMEOUT_MS` | Optional QLoRA metadata, job-creation, and CSV upload timeouts. Defaults follow the Gateway's long-running heavy-service contract. |
| `QWEN3_QLORA_DOWNLOAD_TIMEOUT_MS`, `QWEN3_QLORA_GENERATE_TIMEOUT_MS` | Optional QLoRA model preparation and generation timeouts (defaults: 75 minutes and 12 hours 10 minutes). |
| `QWEN3_QLORA_CSV_UPLOAD_MAX_MB`, `QWEN3_QLORA_MAX_COMPARE_TARGETS` | QLoRA dashboard upload and sequential comparison caps (defaults: 200 MiB and 4 targets). |
| `LLM_ADMIN_TOKEN` | Optional `X-Admin-Token` sent to protected AI Gateway admin endpoints. |
| `OLLAMA_BASE_URL`, `OLLAMA_GEMMA4_MODEL` | Optional Ollama host/model overrides for local model testing. |
| `OLLAMA_WEBHOOK_BASE_URL` | Public callback base for Gateway chat jobs (defaults to `https://my.lentmiien.com/`; endpoint is `/webhook/ollama`). |
| `OLLAMA_WEBHOOK_SECRET` | Recommended dedicated secret used to derive the Ollama callback token. If omitted, the app derives it from `SESSION_SECRET`. |
| `OLLAMA_MAX_TOOL_ROUNDS` | Maximum consecutive background tool-call rounds for one local-model response (defaults to `4`, hard-capped at `20`). |
| `GITHUB_TOKEN` | GitHub PAT used by `GitHubService` to mirror repos under `github-repos/`. |
| `DROPBOX_API_KEY`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `DROPBOX_REDIRECT_URI` | Dropbox credentials for image backups. |
| `MAILGUN_API_KEY` | Optional Mailgun key for notifications in `MessageService`. |
| `MAILGUN_DOMAIN` | Mailgun domain used for startup/crash alerts. |
| `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY` | Pushover credentials used for database emergency/recovery alerts and reminder delivery. |
| `LOG_LEVEL` | Minimum JSON log level (`debug`, `notice`, `warning`, or `error`; defaults to `debug`). |
| `LOG_RETENTION_DAYS`, `LOG_PRUNE_INTERVAL_MS` | Structured-log retention window and independent pruning cadence (defaults to seven days and once daily). |
| `STARTUP_ALERT_EMAIL` | Comma-separated list of recipients for startup diagnostics emails (Mailgun). |
| `STARTUP_ALERT_FROM` | Optional friendly from name for diagnostics emails. |
| `STARTUP_SLACK_WEBHOOK_URL` | Incoming webhook for Slack/Teams alerts when diagnostics fail. |
| `STARTUP_MIN_DISK_MB` | Minimum free disk (in MB) enforced during preflight (defaults to `200`). |
| `STARTUP_REQUIRED_ENV_VARS` | Comma-separated overrides for the env vars validated during preflight. |
| `STARTUP_SKIP_MONGO_CHECK` | Set to `true` to bypass the Mongo connectivity check (e.g., offline dev). |
| `PERFORMANCE_METRICS_ENABLED` | Set to `false` to disable request/task performance snapshots. |
| `PERFORMANCE_METRICS_INTERVAL_MS`, `PERFORMANCE_SLOW_REQUEST_THRESHOLD_MS`, `PERFORMANCE_EVENT_LOOP_RESOLUTION_MS` | Collector interval, slow-request threshold, and event-loop sampling resolution. |
| `PERFORMANCE_SNAPSHOT_RETENTION_DAYS`, `PERFORMANCE_SLOW_REQUEST_RETENTION_DAYS` | Mongo TTL retention for performance snapshots and slow request records. |
| `HTML_SAMPLES_CACHE_TTL_MS` | TTL for the shared public HTML-samples navigation query (defaults to five minutes). |
| `DB_USAGE_ALERT_WEBHOOK`, `DB_USAGE_ALERT_INTERVAL_MINUTES` | Optional webhook and polling interval for database usage alerts. |
| `SORA_STATUS_POLL_MS`, `SORA_STATUS_POLL_BATCH` | Background polling interval and batch size for pending Sora videos. |
| `COMFY_API_BASE`, `COMFY_API_KEY` | ComfyUI REST endpoint + key for `/image_gen`. |
| `COMFY_REQUEST_TIMEOUT_MS`, `COMFY_ACTION_TIMEOUT_MS` | ComfyUI Gateway deadlines for short reads and cold-start-capable mutations. |
| `COMFY_STREAM_HEADER_TIMEOUT_MS`, `COMFY_STREAM_IDLE_TIMEOUT_MS` | Separate response-header and idle-body deadlines for streamed ComfyUI previews. |
| `ASR_API_BASE`, `TTS_API_BASE` | Local ASR and TTS service endpoints used by `/asr`, `/ocr-tts`, and the audio workflow. |
| `ASR_CRISPERWHISPER_TIMEOUT_MS` | CrisperWhisper request timeout; defaults to `2800000` ms to cover gateway queueing and inference. |
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
| `CODEX_BINARY_PATH` | Optional absolute path to the Codex CLI executable used by the Codex queue worker. The installed CLI must provide App Server `turn/steer` support. |
| `CODEX_HOME` | Optional Codex state directory for auth/config when the worker runs under a service or scheduled task. |
| `CODEX_WORKER_ENABLED` | Enables the Codex queue worker for worker processes (defaults to `true`). |
| `CODEX_WEB_WORKER_ENABLED` | Enables the embedded Codex worker inside `app.js` (defaults to `CODEX_WORKER_ENABLED`). Set this to `false` when running the worker as a separate user-login process. |
| `CODEX_GLOBAL_CONCURRENCY` | Maximum Codex turns this worker may run at once across different workspaces. Each workspace is still locked to one running turn. Defaults to `1`; set higher, such as `5`, on a remote Linux worker with multiple workspaces. |
| `CODEX_COMPLETION_EXIT_GRACE_MS` | Maximum time to wait for terminal App Server event persistence before finalizing and closing the turn connection. Defaults to `2000` ms. |
| `CODEX_MAX_EVENTS_PER_TURN` | Maximum number of detail events persisted for each Codex turn before a truncation warning is stored. Defaults to `2000`. |
| `CODEX_MAX_ADDITIONAL_MESSAGES_PER_TURN` | Maximum mid-turn messages accepted for one running Codex turn. Defaults to `20`. |
| `CODEX_MESSAGE_POLL_MS` | How often a running worker checks for queued mid-turn messages. Defaults to `1000` ms. |
| `CODEX_MESSAGE_TIMEOUT_MS` | Maximum time allowed for one App Server `turn/steer` request. Defaults to `15000` ms. |
| `CODEX_YOLO_ENABLED` | Enables server-side acceptance of yolo Codex turns when the selected workspace also allows yolo. Defaults to `false`. |
| `CODEX_CHAT_TOOL_WAIT_TIMEOUT_MS`, `CODEX_CHAT_TOOL_POLL_INTERVAL_MS` | Bound how long Chat5's Codex bridge waits for a terminal turn and how often it checks. Defaults to two hours and two seconds. |
| `HUMAN_TOOL_RESPONSE_TIMEOUT_MS`, `HUMAN_TOOL_POLL_INTERVAL_MS`, `HUMAN_TOOL_RECOVERY_INTERVAL_MS` | Configure the durable Ask Lennart response deadline, live wait polling, and restart-recovery reconciliation. Defaults to 24 hours, two seconds, and one minute. |
| `HUMAN_TOOL_RETENTION_DAYS`, `HUMAN_TOOL_MAX_PENDING_PER_USER` | Configure Ask Lennart history retention and the per-creator pending-request ceiling. Defaults to 90 days and 10. |
| `CODEX_OLLAMA_PROFILE` | Codex profile-v2 config applied to every Ollama App Server thread. Defaults to `ollama`, which the worker loads from `$CODEX_HOME/ollama.config.toml` on the execution target. |
| `CODEX_RUNPOD_PROFILE_ENV_FILE` | Shell environment file sourced before Runpod-backed Qwen or GLM Codex turns. Defaults to `~/.codex/lentmiien.env` on the machine executing Codex. |
| `CODEX_RUNPOD_PROFILE_SHELL` | Shell used to source the Runpod profile environment locally and on SSH targets without an explicit target shell. Defaults to `/bin/bash`. |
| `CODEX_OLLAMA_RESERVATION_CONTAINER` | AI Gateway container reserved before a local Codex turn. Defaults to `ollama`. |
| `CODEX_OLLAMA_RESERVATION_SECONDS` | AI Gateway reservation idle timeout for local Codex turns. Values below six hours are raised to `21600` seconds. |
| `CODEX_OLLAMA_RESERVATION_TIMEOUT_MS` | Maximum time to wait for AI Gateway reservation and release requests. Defaults to `630000`. |
| `CODEX_REMOTE_SSH_ENABLED` | Seeds an SSH-backed Linux Codex execution target when set to `true`. |
| `CODEX_REMOTE_SSH_DESTINATION` | SSH destination for the seeded target, such as `user@host`. |
| `CODEX_REMOTE_SSH_CODEX_BINARY` | Codex command on the remote machine. Defaults to `codex`. |
| `CODEX_REMOTE_SSH_ENV_WRAPPER` | Optional remote environment wrapper prepended before the Codex command, such as `/home/lennart/bin/codex-env`. |
| `CODEX_REMOTE_SSH_OPTIONS` | Optional SSH options. Use a JSON array for values with spaces, for example `["-i","C:/Users/Lennart/.ssh/id_ed25519"]`. |
| `CODEX_REMOTE_SSH_WORKSPACE_PATH` | First remote workspace folder to seed for the SSH target. Additional folders can be added from `/codex/workspaces`. |
| `CODEX_REMOTE_SSH_WORKSPACE_ALLOW_YOLO` | Allows dangerous mode for the seeded remote workspace when global `CODEX_YOLO_ENABLED` is also enabled. |
| `PUBLIC_TOBUY_LIST_PATH` | Hidden public route for the shared to-buy form; generated and persisted to `.env` if omitted. |
| `REQUEST_COUNTER_PATH` | Hidden public GET endpoint for the request counter; `GET <path>?package=<name>` records and evaluates by package category, missing packages are stored as `unknown`, and `GET <path>/status` returns the same plain `OK`/`NG` format without recording. Generated and persisted to `.env` if omitted. |
| `employeeNo`, `employeeName`, `department` | Default payroll metadata injected into forms. |
| `HIDE_GTAG` | Set to `YES` to suppress Google Analytics tags. |

> Keep `.env` out of version control. `setup.js` warns if the file is missing.

The Ollama model choices shown by `/codex` are stored in the `app_settings` collection under `codex.local_models`, initially seeded as `qwen3.6:27b`. Set its value to a comma-separated list such as `qwen3.6:27b,qwen3.6:14b,llama4:scout`. Manage it at `/admin/app-settings`; changes apply on the next Codex page load or Ollama request without restarting the app. The legacy `CODEX_LOCAL_MODELS` environment variable is no longer read.

### Startup Diagnostics & Alerts

`setup.js` now runs a structured diagnostics pipeline before `npm start` completes:

- **Preflight** validates required env vars, disk space, and Mongo connectivity (configurable via `STARTUP_*` vars). A transient Mongo connectivity failure skips database maintenance and is deferred to the application lifecycle; missing non-database configuration and low disk remain fatal.
- **Section runners** wrap each maintenance task (temp cleanup, PDF pruning, DB hygiene, Dropbox sync) with scoped logging, retries for network operations, and a final JSON summary logged under `startup:summary`.
- **Alerting** optionally sends Slack webhook and/or Mailgun emails when diagnostics fail. Configure `STARTUP_SLACK_WEBHOOK_URL`, `STARTUP_ALERT_EMAIL`, `STARTUP_ALERT_FROM`, and `MAILGUN_DOMAIN` to receive notifications.
- **Interpretation guide** lives in `documentation/startup-diagnostics.md` with troubleshooting steps and log categories.

The summary object contains section-level timings and statuses (`ok`, `warning`, `failed`, `skipped`). Critical configuration or disk failures stop startup. When only MongoDB is unavailable, the HTTP process exposes `/apphealth` as `503`, rejects other traffic, retries with capped backoff, and starts database workers exactly once after recovery. A dedicated outage record is kept locally during the failure, imported into MongoDB after recovery, and an emergency Pushover alert is cancelled when service resumes.

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
| `npm run codex-worker` | Runs only the Codex queue worker without starting the Express web server. |
| `npm run codex-update` | Installs the latest `@openai/codex` globally. |
| `npm run codex-todo` | Directs Codex to action tasks from `todo.txt`. |
| `npm run codex-commit` | Runs Codex in commit mode to create a commit for pending changes. |

> `npm run git_test` expects a local `git_test.js` (ignored by git), so it will fail on a fresh clone unless you create that script.

### Codex Worker Split on Windows

When the Express web server runs as a Windows service, keep it from claiming Codex jobs and run the Codex worker from the interactive Windows user instead.

1. In the service environment, set `CODEX_WEB_WORKER_ENABLED=false`.
2. Leave `CODEX_WORKER_ENABLED=true` or unset for the scheduled worker process.
3. Create a Windows Task Scheduler task that runs only when your user is logged on:
   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd C:\Projects\lentmiien-site; npm run codex-worker"
   ```
4. Make sure that scheduled task runs as the same Windows account that owns `CODEX_HOME` and can run `codex doctor`.

The web UI still creates and displays Codex turns through MongoDB. The separate user-login worker is the only process that should execute queued turns.

To enable local models, configure an Ollama-only Codex profile on the machine that executes Codex. The worker defaults `CODEX_OLLAMA_PROFILE` to `ollama`, so local turns load `$CODEX_HOME/ollama.config.toml`. Use a custom provider ID because Codex's built-in `ollama` provider is reserved and cannot be overridden:

```toml
oss_provider = "local_ollama"
model_catalog_json = "/home/your-user/.codex/ollama-models.json"

[model_providers.local_ollama]
name = "Local Ollama"
base_url = "http://localhost:11434/v1"
wire_api = "responses"
stream_idle_timeout_ms = 900000
stream_max_retries = 5
```

The `900000` ms SSE idle timeout lets Ollama spend up to 15 minutes without emitting a stream event. Selecting Ollama in `/codex` launches `codex app-server`, reads the bounded profile-v2 file on the execution target, passes the startup-only `model_catalog_json` setting when starting App Server, and sends the remaining config, `oss_provider`, and selected model through `thread/start` or `thread/resume`. Profile files larger than 1 MiB are rejected, and their raw contents are not included in command summaries or logs. The worker reserves the AI Gateway `ollama` container for at least six hours before each local turn and releases it once no other local Ollama turn is queued or running. OpenAI and Ollama token prices and cost estimates are stored and displayed separately.

The Codex provider selector also supports two fixed Runpod-backed profiles. `Qwen (Runpod)` uses `lentmiien-qwen` and is shown only while the `/admin/runpod` record named `ollama-qwen` is `RUNNING`; `GLM-5.3 Flash (Runpod)` similarly uses `lentmiien-glm` and requires a running `glm53-flash` record. These options are restricted to administrators by default (or accounts explicitly granted `codex.run.runpod_model`). The worker checks the pod state again when accepting and claiming a turn, sources `CODEX_RUNPOD_PROFILE_ENV_FILE`, launches `codex app-server`, and applies the fixed profile through the App Server thread protocol. Both providers are included in the Ollama usage and cost totals. See [documentation/codex-runpod-model-providers.md](documentation/codex-runpod-model-providers.md) for setup and security details.

For SSH-backed Linux targets, make sure the worker account can run a non-interactive SSH command such as:
```powershell
ssh -o BatchMode=yes lennart@192.168.0.20 "test -d /home/lennart/Programming/lentmiien-site && /home/lennart/bin/codex-env codex --version"
```
The web process stores remote workspace paths as allowlist metadata; the worker validates the path over SSH when it claims a queued turn.

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
- `logs/` retains seven days of structured logs (JSON-per-line). Older files are pruned at startup and daily even when the app is launched directly with `node app`.
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
