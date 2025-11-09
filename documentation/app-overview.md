# Lentmiien Platform Overview

This document gives a high-level tour of the Lentmiien personal platform, highlighting each functional area and the tools that power it. Use it as a quick map when exploring the codebase or scoping new work.

## Platform Snapshot

| Domain | Primary Routes | Key Controllers/Services | Core Tools |
| --- | --- | --- | --- |
| Chat & Knowledge Ops | `/chat5` | `controllers/chat5controller`, `services/{conversation,message,knowledge,template}Service` | Model switcher, knowledge browser, template library, batch runner, media attachments |
| Video Generation (Sora) | `/sora` | `controllers/soracontroller`, `utils/OpenAI_API`, `services/batchService` | Prompt composer, background poller, webhook reconciler, asset rating, Dropbox backup hooks |
| Image Generation (ComfyUI) | `/image_gen` | `controllers/image_gencontroller`, `services/conversationService`, `utils/OpenAI_API` | Prompt collections, job queue viewer, cached gallery, metadata tagging |
| Budget & Finance | `/budget`, `/budget/review/:year/:month` | `controllers/budget2controller`, `services/{budget,creditCard}Service` | Dashboard KPIs, transaction review queue, categorisation helpers, credit card importer |
| Cooking & Household | `/cooking`, `/scheduleTask/calendar`, `/health` | `controllers/{cookingcontroller,scheduleTaskController,healthcontroller}`, `services/{cookingCalendar,scheduleTask,health}Service` | Meal planner, pantry analytics, task overlap detector, health logbook |
| Document & Prompt Ops | `/gptdocument`, `/framework`, `/documentation` | `controllers/gptdocumentcontroller`, `documentation/` resources | Document knowledge base, prompt catalog, framework guides, color and testing handbooks |
| Admin & Utilities | `/admin/*`, `/tmp-files`, `/yaml-viewer`, `/games` | `controllers/{admincontroller,tmpfilescontroller,yamlcontroller}`, `routes/yaml`, `services/githubService` | Role management, log viewer, temp file shuttle, Swagger UI, game hub, GitHub mirror |
| Automation & Background Jobs | `npm start` (prestart), schedulers | `setup.js`, `schedulers/batchTrigger`, `services/batchService` | Cache priming, OpenAI usage harvesting, directory hygiene, scheduled batch kicks |
| Testing & Quality | `npm test`, `/documentation/testing-guide.md` | `tests/unit/*.test.js`, `jest.config.js` | Jest service tests, coverage reports, manual scenario checklists |

## Functional Areas

### Chat5 Studio
- **Purpose:** Flagship chat workspace that orchestrates multi-model conversations, prompt engineering, and knowledge retrieval.
- **Tools:**
  - **Model Switcher:** Combines OpenAI, Anthropic, Gemini, Groq, and local LM Studio providers.
  - **Knowledge Browser:** Surfaces tagged snippets through `KnowledgeService` for in-context injection.
  - **Template Library:** Stores reusable prompts via `TemplateService`, including search and quick insert.
  - **Batch Runner:** Delegates long-running jobs to `BatchService` and streams updates over Socket.IO.
  - **Story Mode & Media Attachments:** Handles cover art, audio, and file uploads with `MessageService`.
  - **Audit-Friendly Editor:** Allows message edits while logging diffs for later review.
- **Backing Components:** `controllers/chat5controller`, `services/{conversation,message,knowledge,template}Service`, `socket_io/chat5`.

### Sora Video Studio
- **Purpose:** Manage OpenAI Sora 2/2 Pro video generation end-to-end.
- **Tools:**
  - **Prompt Composer:** Guides prompt text, frame duration, and aspect ratio selections.
  - **Background Poller:** `utils/OpenAI_API` polls queued jobs at configurable intervals.
  - **Webhook Reconciler:** `controllers/webhook.js` finalises job state when OpenAI callbacks fire.
  - **Input Conditioning:** Uses `sharp` to standardise uploaded reference images under `tmp_data/`.
  - **Rating & Gallery Filters:** Cached results under `public/video` with quality scoring, cleanup, and Dropbox mirroring.
  - **Usage Tracking:** Rolls video metadata into Mongo (`SoraVideo` model) for analytics and audits.
- **Backing Components:** `controllers/soracontroller`, `routes/sora`, `utils/OpenAI_API`, `services/batchService`, `public/video`.

### ComfyUI Image Generation
- **Purpose:** Interface for on-prem ComfyUI pipelines, cached output, and prompt management.
- **Tools:**
  - **Prompt Library:** Stores reusable workflows and metadata for quick recall.
  - **Job Queue Viewer:** Streams status from the ComfyUI REST API (`COMFY_API_BASE`).
  - **Gallery & Ratings:** Organises generated assets in `public/imgen` with filters and favourites.
  - **Cache Refinement:** Cleans temp payloads through `setup.js` and gallery maintenance scripts.
- **Backing Components:** `controllers/image_gencontroller`, `routes/image_gen`, `services/conversationService`, `utils/OpenAI_API`, `public/imgen`.

### Budget & Finance Suite
- **Purpose:** Track personal finances, credit card charges, and budgeting analytics.
- **Tools:**
  - **Dashboard KPIs:** Summaries of spend vs. target via `BudgetService.getDashboardData`.
  - **Transaction Review:** Period navigation with canonical URLs and CSV exports.
  - **Categorisation Helpers:** Auto-tags transactions and highlights anomalies.
  - **Credit Card Importer:** `CreditCardService` normalises bank exports for ingestion.
  - **Custom Reports:** APIs exposed under `/api/budget` for external tooling.
- **Backing Components:** `controllers/budget2controller`, `services/{budget,creditCard}Service`, `models/Budget*`, `views/budget_*`.

### Cooking, Health, and Scheduling
- **Purpose:** Support household operations through meal planning, health tracking, and scheduling.
- **Tools:**
  - **Cooking Calendar:** Weekly/monthly planner, pantry usage insights, recipe stats.
  - **Request Queue:** Collects meal requests and links to groceries inventory.
  - **Health Tracker:** Logs vitals, trends, and reminders with chart-ready datasets.
  - **Schedule Task Planner:** Detects overlapping presence events and notifies conflicts.
  - **Sensor Dashboards:** `/mpu6050` and `/dht22` visualise home IoT readings.
- **Backing Components:** `controllers/{cookingcontroller,healthcontroller,scheduleTaskController}`, `services/{cookingCalendar,health,scheduleTask}Service`, `models/*`, `views/*`.

### Document & Prompt Operations
- **Purpose:** Centralise knowledge that feeds the platform’s AI tooling and developer workflows.
- **Tools:**
  - **GPT Document Library:** Upload and search documents for chat knowledge injection.
  - **Prompt Catalog:** Curated prompts stored in `documentation/README-Prompts.md`.
  - **Framework & Testing Guides:** `documentation/framework.md`, `documentation/testing-guide.md` standardise contributions.
  - **Color & UI References:** Design tokens documented in `documentation/README-Colors.md`.
- **Backing Components:** `controllers/gptdocumentcontroller`, `models/AIModelCards`, `services/knowledgeService`, `documentation/` folder.

### Admin & Utility Center
- **Purpose:** Provide operational tooling for security, data hygiene, and maintenance.
- **Tools:**
  - **User & Role Management:** `/admin/manage_users` and `/admin/manage_roles` for CRUD over Mongo-backed auth.
  - **Log Viewer:** Streams JSON log files from `logs/` with date filters and severity badges.
  - **Temp File Shuttle:** `/tmp-files` handles time-boxed secure transfers with automatic cleanup.
  - **OpenAI Usage Harvesting:** `setup.js` archives daily usage stats through `OPENAI_ADMIN_KEY`.
  - **GitHub Mirror Browser:** `github-repos/` maintained by `GitHubService` with offline repository browsing.
  - **Swagger Viewer:** `/yaml-viewer` renders OpenAPI specs stored in `public/yaml/`.
  - **Games & Experiments:** `/games` serves WASM/HTML bundles, `/test_editor` exposes sandbox utilities.
- **Backing Components:** `controllers/admincontroller`, `controllers/tmpfilescontroller`, `controllers/yamlcontroller`, `services/githubService`, `utils/logger`.

### Automation & Background Processes
- **Purpose:** Keep local storage, integrations, and batch jobs healthy without manual intervention.
- **Tools:**
  - **Startup Orchestrator (`setup.js`):** Creates directories, compacts caches, fetches OpenAI usage, prunes logs, trims low-rated media.
  - **Batch Scheduler (`schedulers/batchTrigger.js`):** Dispatches queued OpenAI batch jobs.
  - **Dropbox Sync (`services/messageService`, `dropbox.js`):** Pushes generated media for off-site storage.
  - **Cache & Temp Hygiene:** `setup.js` and utility scripts purge `tmp_data/`, `cache/`, and `public/temp/`.
  - **Environment Guardrails:** `.env` generated from `env_sample`, with warnings when required keys are missing.
- **Backing Components:** `setup.js`, `schedulers/`, `services/{batch,message}Service`, `dropboxClient.js`, `utils/logger`.

### Testing & Quality Assurance
- **Purpose:** Ensure service-layer contracts remain reliable as new features ship.
- **Tools:**
  - **Jest Unit Suite:** Lives under `tests/unit`, mocked dependencies for database, filesystem, and third-party SDKs.
  - **Coverage Reports:** `npm test` writes LCOV/HTML output to `coverage/` for quick visual inspection.
  - **Manual Playbooks:** `documentation/testing-guide.md` outlines scenarios for Sora jobs, ComfyUI runs, Dropbox sync, and admin flows.
  - **CI-Ready Scripts:** `npm test -- --watch` for local loops; hookable into automation pipelines.

## Integrations & External Services
- **OpenAI:** Chat completions, Sora video, usage stats (keys: `OPENAI_API_KEY`, `OPENAI_API_KEY_PRIVATE`, `OPENAI_ADMIN_KEY`, `OPENAI_WEBHOOK_SECRET`).
- **Anthropic / Gemini / Groq / LM Studio:** Optional chat providers toggled in Chat5.
- **Dropbox:** Media backup via `dropbox.js` and `dropboxClient.js`.
- **Mailgun:** Outbound notifications in `MessageService`.
- **ComfyUI:** Local image generation through `COMFY_API_BASE` endpoints.
- **MongoDB:** Central datastore configured through `database.js` and `MONGOOSE_URL`.

## Navigating the Codebase
1. **Routes (`routes/`)** define URL structure; match names to controllers for quick discovery.
2. **Controllers (`controllers/`)** orchestrate requests, call services, and render Pug views.
3. **Services (`services/`)** encapsulate domain logic and external API access.
4. **Models (`models/`)** map Mongo schemas; review before changing data workflows.
5. **Views (`views/`)** render Pug templates that consume the data prepared by controllers.
6. **Utils (`utils/`)** store cross-cutting helpers (OpenAI integrations, logging, formatting).

## Getting Started Checklist
- Install dependencies (`npm install`) and copy `env_sample` to `.env`.
- Populate required API keys and Mongo connection string.
- Run `npm start` to execute `setup.js`, provision caches, and boot the Express server.
- Visit feature routes listed above to explore tooling; start with `/chat5` and `/sora`.
- Execute `npm test` to verify local setup and generate coverage reports in `coverage/`.

Keep this overview handy as a north-star when onboarding new collaborators or scoping larger changes. For deeper dives, pair it with the README, `documentation/framework.md`, and `documentation/testing-guide.md`.
