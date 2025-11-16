# Lentmiien Personal Platform

This Node.js/Express application drives my personal website—a hybrid portfolio, experimentation lab, and daily-operations hub where I explore AI-assisted workflows, data tooling, and household automation. The codebase bundles production-ready utilities (budgeting, cooking, health tracking, payroll), rich AI tooling (multi-provider chat, document knowledge base, batch workflows), and media pipelines (Sora video, ComfyUI image generation, Dropbox backups).

## Highlights

- **Chat5 Studio:** Real-time chat workspace with Socket.IO, model switching (OpenAI, Anthropic, Google, Groq, LM Studio), knowledge injection, reusable templates, AI model cards, story mode playback, and audit-friendly message editing.
- **Media Generation Pipeline:** Sora 2 Studio for OpenAI video jobs, background polling/webhooks, ComfyUI-powered image generation with caching, PDF-to-image conversion, and gallery ratings with Dropbox backups.
- **Operations & Productivity Suite:** Unified accounting workspace (budgets, cards, analytics), receipt OCR, customs-ready product summaries, payroll builder, cooking calendar v2 with analytics, health tracker, quick notes, emergency stock, and a new schedule-task planner.
- **Automation & Integrations:** Startup maintenance, OpenAI usage harvesting, Dropbox sync, GitHub repository mirroring, temporary file transfer tool, Mailgun notifications, and bearer-protected API access.
- **Experimentation Sandbox:** Sensor dashboards (MPU6050, DHT22), markdown editor demos, browser games with Brotli assets, reference materials, and agent orchestration docs (`AGENTS.md`, `documentation/framework.md`).
- **Documentation & Quality:** Centralized guides and prompt libraries in `documentation/`, plus Jest-backed service tests with coverage artifacts under `coverage/`.

## Architecture

- **Server & Domain Layer:** `app.js` wires Express, session management, Passport-local auth, and role-based permissions. Routers in `routes/` map to task-focused controllers inside `controllers/`, which delegate domain logic to `services/` and persistence to Mongoose models (`models/` via `database.js`).
- **Realtime Collaboration:** `socket_io/` exposes namespaces for Chat5 conversation updates, typing indicators, and notification fan-out.
- **Data & Storage:** MongoDB backs all domain entities (chat transcripts, knowledge, budgets, cooking schedules, Sora videos, etc.). Local directories (`cache/`, `tmp_data/`, `public/`, `logs/`, `github-repos/`) store generated media, working files, log archives, repo mirrors, and cached prompts.
- **Background Workflows:** `setup.js` provisions folders, converts legacy images, prunes logs, syncs OpenAI usage, and clears temp data before each start. `utils/OpenAI_API.js` manages Sora polling and downloads, while `controllers/webhook.js` consumes OpenAI webhooks to finalize batches and media jobs.
- **Frontend Rendering:** Views live in `views/` (Pug) and ship compiled assets from `public/` (JS/CSS/mp3/video). `/games` serves static WebAssembly/HTML bundles with gzip/Brotli.

## Directory Reference

| Path | Description |
| --- | --- |
| `app.js` | Express entry point, auth wiring, route registration, game hosting. |
| `routes/` | HTTP routers that enforce auth and forward requests to controllers. |
| `controllers/` | Feature-specific request handlers (Chat5, cooking, budget, Sora, image generation, admin, etc.). |
| `services/` | Domain services for chat, messaging, cooking calendars, budgets, scheduling, GitHub sync, and more. |
| `models/` | Mongoose schemas (chat history, AI cards, payroll, receipts, schedule tasks, Sora videos, prompts). |
| `socket_io/` | Socket.IO bootstrap and chat event handlers. |
| `views/` | Pug templates for dashboards, forms, modals, and media viewers. |
| `public/` | Client assets including compiled JS, CSS, `imgen/` cache, `video/` output, and `temp/` uploads. |
| `public/yaml/` | OpenAPI/Swagger specs exposed through `/yaml-viewer`. |
| `games/` | Standalone web games served via `express-static-gzip`. |
| `github-repos/` | Local clone cache managed by `GitHubService`. |
| `schedulers/` | Background triggers (e.g., batch queue helpers) invoked during startup flows. |
| `tests/` | Jest unit tests (see `tests/unit`) covering service-layer contracts. |
| `documentation/` | Architecture notes, testing guide, prompt catalog, and color reference used alongside `AGENTS.md`. |
| `coverage/` | Generated Jest coverage reports (`npm test`). |
| `cache/`, `tmp_data/`, `logs/` | Generated caches, ephemeral transfers, and rolling log files maintained by `setup.js`. |
| `sample_data/`, `reference_material/` | Datasets and docs used by demos and knowledge ingestion. |

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
  - ComfyUI HTTP API if you want on-prem image generation.
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
5. Visit `http://localhost:3000` (or your chosen `PORT`). Authenticated features require a Mongo user entry; create one manually or via the admin tools after logging in.

### Useful Local Routes

- `/chat5` - Chat workspace with templates, knowledge browser, and pending queue.
- `/sora` - Sora 2 Studio dashboard with job filters, polling, and ratings.
- `/image_gen` - ComfyUI job queue, cached output browser, prompt library.
- `/budget` - Budget v2 dashboard, transaction review, analytics APIs.
- `/cooking` - Cooking calendar v2, recipe usage stats, request queue.
- `/scheduleTask/calendar` - Task & presence planner with overlap detection.
- `/tmp-files` - Authenticated temporary file shuttle (admin only).
- `/admin/manage_users` & `/admin/manage_roles` - User/role management and log viewer.
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
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | Optional provider keys surfaced in Chat5. |
| `DISABLE_LOCAL` | Set to `TRUE` to hide the LM Studio provider integration. |
| `GITHUB_TOKEN` | GitHub PAT used by `GitHubService` to mirror repos under `github-repos/`. |
| `DROPBOX_API_KEY`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `DROPBOX_REDIRECT_URI` | Dropbox credentials for image backups. |
| `MAILGUN_API_KEY` | Optional Mailgun key for notifications in `MessageService`. |
| `MAILGUN_DOMAIN` | Mailgun domain used for startup/crash alerts. |
| `STARTUP_ALERT_EMAIL` | Comma-separated list of recipients for startup diagnostics emails (Mailgun). |
| `STARTUP_ALERT_FROM` | Optional friendly from name for diagnostics emails. |
| `STARTUP_SLACK_WEBHOOK_URL` | Incoming webhook for Slack/Teams alerts when diagnostics fail. |
| `STARTUP_MIN_DISK_MB` | Minimum free disk (in MB) enforced during preflight (defaults to `200`). |
| `STARTUP_REQUIRED_ENV_VARS` | Comma-separated overrides for the env vars validated during preflight. |
| `STARTUP_SKIP_MONGO_CHECK` | Set to `true` to bypass the Mongo connectivity check (e.g., offline dev). |
| `COMFY_API_BASE`, `COMFY_API_KEY` | ComfyUI REST endpoint + key for `/image_gen`. |
| `GALLERY_PATH` | Filesystem path scanned by the gallery for image ratings/slideshows. |
| `VUE_PATH` | Optional absolute path to a built Vue frontend served to authenticated users. |
| `API_KEY` | Bearer token required for `/api` automation routes. |
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
| `npm run codex` | Launches the Codex CLI helper. |
| `npm run codex-update` | Installs the latest `@openai/codex` globally. |
| `npm run codex-todo` | Directs Codex to action tasks from `todo.txt`. |

> `npm run git_test` expects a local `git_test.js` (ignored by git) for ad-hoc GitHub automation experiments.

## Feature Deep Dive

- **Chat5 & Knowledge Ops:** Multi-conversation management, knowledge tagging, template injection, AI model card catalog, story mode audio/cover builder, batch processing via `BatchService`, webhook-driven streaming into Socket.IO rooms, and conversation editing with media uploads.
- **Batch & Repository Automation:** `batchService` queues OpenAI batch jobs, while `GitHubService` mirrors repos under `github-repos/` for offline browsing with folder trees and file previews.
- **Media Workflows:** `/sora` orchestrates Sora 2/2 Pro jobs with background polling, webhook reconciliation, rating filters, and video caching under `public/video`. `/image_gen` manages ComfyUI prompt libraries, caching of bucket assets, and image ratings. Dropbox helpers back up generated assets automatically.
- **Life & Finance Tooling:** Cooking calendar v2 tracks actuals versus planned meals, analytics, and recipe library usage. Budget v2 exposes dashboards plus JSON APIs for category analysis. Receipts and payroll controllers parse uploads into structured records. Product customs summaries use GPT-4.1 with Zod validation. The schedule task planner blocks overlapping presence events.
- **Health Analytics & Alerts:** `/health` now layers moving averages, Chart.js trends, alert banners, and CSV exports on top of daily health logs. Each entry captures measurement metadata, tags, notes, and personalised thresholds that feed the `/health/analytics` API plus cached summaries in `cache/health_insights.json`.
- **Admin & Utilities:** Admin module manages users/roles, views JSON log files (`logs/*.log`), and inspects OpenAI usage. `/tmp-files` offers a size-limited drop zone that cleans up automatically. `/games` lists bundled games served with gzip/Brotli.
- **Documentation & OpenAPI:** `/yaml-viewer` renders stored OpenAPI specs through Swagger UI, and `documentation/` houses living architecture/testing/prompt guides that complement `AGENTS.md`.

## Data & File Management

- `public/img`, `public/video`, and `public/imgen` hold generated media. `setup.js` converts legacy PNGs to JPG and removes low-rated Sora videos (rating 1).
- `tmp_data/` is purged on every startup; use `/tmp-files` for transient transfers.
- `cache/` stores JSON caches (`chat3vdb.json`, `default_models.json`, embeddings).
- `logs/` retains seven days of structured logs (JSON-per-line). Older files are pruned automatically.
- `sample_data/` and `reference_material/` contain datasets used in demos and ingestion flows.
- `coverage/` is produced by Jest runs; open `coverage/lcov-report/index.html` after `npm test` for an HTML report.

## Testing & Verification

- Jest is configured via `jest.config.js` to target service-layer units under `tests/unit`. Run `npm test` to execute the suite and generate coverage inside `coverage/`.
- Use `npm test -- --watch` for iterative development; HTML coverage lives at `coverage/lcov-report/index.html`.
- `documentation/testing-guide.md` outlines additional manual scenarios (Sora, ComfyUI, Dropbox). When running those flows, monitor `logs/` for notices/errors emitted by `utils/logger`.
- Keep Mongo indexes aligned with new models and confirm external integrations with sandbox credentials before enabling them in production.

## Contributing & Support

This is primarily a personal playground, but ideas, bug reports, and pull requests are welcome. Highlight API key requirements, potential data migration steps, and include screenshots/GIFs for UI tweaks.

## License

Distributed under the MIT License. See [`LICENCE`](LICENCE) for details.
