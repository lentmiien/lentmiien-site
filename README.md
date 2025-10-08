# Lentmiien Personal Platform

This Node.js/Express application drives my personal website—a hybrid portfolio, experimentation lab, and daily-operations hub where I explore AI-assisted workflows, data tooling, and household automation. The codebase bundles production-ready utilities (budgeting, cooking, health tracking, payroll), rich AI tooling (multi-provider chat, document knowledge base, batch workflows), and media pipelines (Sora video, ComfyUI image generation, Dropbox backups).

## Highlights

- **Chat5 Studio:** Real-time chat workspace with Socket.IO, model switching (OpenAI, Anthropic, Google, Groq, LM Studio), knowledge injection, reusable templates, AI model cards, story mode playback, and audit-friendly message editing.
- **Media Generation Pipeline:** Sora 2 Studio for OpenAI video jobs, background polling/webhooks, ComfyUI-powered image generation with caching, PDF-to-image conversion, and gallery ratings with Dropbox backups.
- **Operations & Productivity Suite:** Budget v2 dashboards and APIs, receipt OCR, customs-ready product summaries, payroll builder, cooking calendar v2 with analytics, health tracker, quick notes, emergency stock, and a new schedule-task planner.
- **Automation & Integrations:** Startup maintenance, OpenAI usage harvesting, Dropbox sync, GitHub repository mirroring, temporary file transfer tool, Mailgun notifications, and bearer-protected API access.
- **Experimentation Sandbox:** Sensor dashboards (MPU6050, DHT22), markdown editor demos, browser games with Brotli assets, reference materials, and agent orchestration docs (`AGENTS.md`, `framework.md`).

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
| `games/` | Standalone web games served via `express-static-gzip`. |
| `github-repos/` | Local clone cache managed by `GitHubService`. |
| `cache/`, `tmp_data/`, `logs/` | Generated caches, ephemeral transfers, and rolling log files maintained by `setup.js`. |
| `sample_data/`, `reference_material/` | Datasets and docs used by demos and knowledge ingestion. |
| `AGENTS.md`, `framework.md`, `testing-guide.md` | Living documentation for AI agents, architecture guidelines, and testing strategy. |

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

- `/chat5` – Chat workspace with templates, knowledge browser, and pending queue.
- `/sora` – Sora 2 Studio dashboard with job filters, polling, and ratings.
- `/image_gen` – ComfyUI job queue, cached output browser, prompt library.
- `/budget` – Budget v2 dashboard, transaction review, analytics APIs.
- `/cooking` – Cooking calendar v2, recipe usage stats, request queue.
- `/scheduleTask/calendar` – Task & presence planner with overlap detection.
- `/tmp-files` – Authenticated temporary file shuttle (admin only).
- `/admin/manage_users` & `/admin/manage_roles` – User/role management and log viewer.

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
| `COMFY_API_BASE`, `COMFY_API_KEY` | ComfyUI REST endpoint + key for `/image_gen`. |
| `GALLERY_PATH` | Filesystem path scanned by the gallery for image ratings/slideshows. |
| `VUE_PATH` | Optional absolute path to a built Vue frontend served to authenticated users. |
| `API_KEY` | Bearer token required for `/api` automation routes. |
| `employeeNo`, `employeeName`, `department` | Default payroll metadata injected into forms. |
| `HIDE_GTAG` | Set to `YES` to suppress Google Analytics tags. |

> Keep `.env` out of version control. `setup.js` warns if the file is missing.

## npm Scripts

| Script | Description |
| --- | --- |
| `npm start` | Runs `setup.js` (cache prep, cleanup, usage sync) then starts `node app`. |
| `npm test` | Executes `test.js`, triggering a Sora video generation job (consumes OpenAI credits). |
| `npm run git_test` | Helper script for GitHub automation experiments. |
| `npm run codex` | Launches the Codex CLI helper. |
| `npm run codex-update` | Installs the latest `@openai/codex` globally. |
| `npm run codex-todo` | Directs Codex to action tasks from `todo.txt`. |

## Feature Deep Dive

- **Chat5 & Knowledge Ops:** Multi-conversation management, knowledge tagging, template injection, AI model card catalog, story mode audio/cover builder, batch processing via `BatchService`, webhook-driven streaming into Socket.IO rooms, and conversation editing with media uploads.
- **Batch & Repository Automation:** `batchService` queues OpenAI batch jobs, while `GitHubService` mirrors repos under `github-repos/` for offline browsing with folder trees and file previews.
- **Media Workflows:** `/sora` orchestrates Sora 2/2 Pro jobs with background polling, webhook reconciliation, rating filters, and video caching under `public/video`. `/image_gen` manages ComfyUI prompt libraries, caching of bucket assets, and image ratings. Dropbox helpers back up generated assets automatically.
- **Life & Finance Tooling:** Cooking calendar v2 tracks actuals versus planned meals, analytics, and recipe library usage. Budget v2 exposes dashboards plus JSON APIs for category analysis. Receipts and payroll controllers parse uploads into structured records. Product customs summaries use GPT-4.1 with Zod validation. The schedule task planner blocks overlapping presence events.
- **Admin & Utilities:** Admin module manages users/roles, views JSON log files (`logs/*.log`), and inspects OpenAI usage. `/tmp-files` offers a size-limited drop zone that cleans up automatically. `/games` lists bundled games served with gzip/Brotli.

## Data & File Management

- `public/img`, `public/video`, and `public/imgen` hold generated media. `setup.js` converts legacy PNGs to JPG and removes low-rated Sora videos (rating 1).
- `tmp_data/` is purged on every startup; use `/tmp-files` for transient transfers.
- `cache/` stores JSON caches (`chat3vdb.json`, `default_models.json`, embeddings).
- `logs/` retains seven days of structured logs (JSON-per-line). Older files are pruned automatically.
- `sample_data/` and `reference_material/` contain datasets used in demos and ingestion flows.

## Testing & Verification

- The project currently relies on bespoke Node scripts instead of a formal test runner. `testing-guide.md` documents the preferred approach if/when Jest or other tooling is introduced.
- `npm test` launches a real Sora video job; run it only when you intend to spend OpenAI credits.
- For manual validation, exercise the key dashboards, ensure Mongo indexes exist for new models, and monitor `logs/` for structured notices/errors produced by `utils/logger`.

## Contributing & Support

This is primarily a personal playground, but ideas, bug reports, and pull requests are welcome. Highlight API key requirements, potential data migration steps, and include screenshots/GIFs for UI tweaks.

## License

Distributed under the MIT License. See [`LICENCE`](LICENCE) for details.
