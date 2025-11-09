# Future Work Brainstorm

This living list captures ideas for evolving the Lentmiien platform. It pairs incremental enhancements that build on today’s tooling with bigger bets that could broaden the app’s scope.

## Building on Current Capabilities

### Chat & Knowledge Ops
1. **Ship `chat5_6` modular events** — Split the monolithic `chat5-append` handler into focused Socket.IO events (create, copy, append, batch, etc.) while reusing `ConversationService` and `MessageService` internals for shared logic.
2. **Template system upgrade (`chat5_template`)** — Track template conversation IDs, cache them for quick injection, and expose template-aware UI states in Chat5. Extend `TemplateService` without breaking existing workflows.
3. **Conversation analytics overlays** — Add usage dashboards (message counts, AI spend estimates, completion latency) powered by aggregated `Conversation5Model` data to surface chat health insights.
4. **Knowledge ingestion pipeline** — Automate document intake via `github-repos/` mirrors and `documentation/` assets, tagging entries with embeddings so the knowledge browser stays current with fewer manual steps.
5. **Conversation branching & version history** — Allow users to fork conversations, view diffs, and roll back to earlier states by leveraging the existing message history storage.

### Media Workflows (Sora & ComfyUI)
1. **Scheduled Sora batches** — Layer a scheduler atop `BatchService` to queue nightly discounted renders, with status emails via Mailgun when runs complete.
2. **Asset lifecycle policies** — Move low-rated Sora or ComfyUI outputs to deep storage after configurable aging periods, using Dropbox APIs and local pruning scripts.
3. **Prompt A/B testing** — Capture prompt metadata and outcomes so users can compare generation quality, time, and ratings side-by-side.
4. **ComfyUI node presets** — Store reusable graph configurations and expose a quick-start gallery that streams node lists from the ComfyUI API.
5. **Inline editing & remix** — Allow direct prompt edits with side-by-side previews, reusing existing job queue endpoints for diff runs.

### Operations, Finance, and Household
1. **Bank API importers** — Replace manual CSV uploads by connecting to Plaid/Finch-like APIs, feeding data into `BudgetService` with automated reconciliation.
2. **Budget anomaly detector** — Flag out-of-pattern spending categories using lightweight statistical models and alert via `/admin` notifications.
3. **Meal plan → grocery list automation** — Generate grocery lists from upcoming meals, integrating with third-party delivery APIs for order drafts.
4. **Health trend insights** — Visualise rolling averages and threshold alerts for vitals, optionally syncing with wearable exports.
5. **Scheduling + calendar sync** — Push schedule tasks to Google Calendar or Outlook, keeping presence overlaps visible across devices.

### Admin, Automation, and Infrastructure
1. **Role-aware dashboards** — Tailor `/admin` views and navigation based on user roles stored in Mongo to reduce UI noise.
2. **Audit log enrichment** — Expand `logger` outputs with user context, request metadata, and cross-linking to relevant domain entities for quicker debugging.
3. **Self-healing setup** — Enhance `setup.js` with health checks (Mongo availability, disk usage) and optional Slack/Mailgun alerts when startup anomalies occur.
4. **Test coverage growth** — Continue expanding Jest suites (e.g., `chat5_template`, budget calculators) and enforce thresholds via CI hooks.
5. **Swagger authoring workflow** — Create CLI helpers to lint and publish OpenAPI specs into `public/yaml/`, keeping `/yaml-viewer` fresh.

## New Horizons & Expansion Ideas

### Autonomous Agents & Workflows
- **Task orchestration agents** — Compose multistep agents that mix chat, scheduling, and media generation (e.g., create promo video, update site, email result) leveraging existing services plus new workflow runners.
- **Inbox-to-action bridge** — Parse email or webhook payloads and route them into conversations, schedules, or budget entries using structured automation recipes.

### Data & Intelligence Layer
- **Personal data warehouse** — Centralise logs, finance data, health stats, and AI usage into a warehouse (DuckDB/Snowflake) with BI dashboards (Metabase/Superset).
- **Recommendation engine** — Suggest recipes, budgets, or AI templates based on historical usage patterns and ratings.
- **Insights timeline** — Merge events (budget anomalies, Sora outputs, schedule changes) into a chronological feed for daily review.

### Experience & Interface Expansion
- **Voice assistant mode** — Add speech-to-text and text-to-speech for Chat5, enabling hands-free interactions via browser or smart speaker integration.
- **Mobile companion app** — Build a lightweight React Native or Capacitor client that surfaces dashboards, quick actions, and notifications.
- **Wearable-friendly glances** — Publish micro dashboards (budget balance, health vitals) formatted for watch widgets or Apple complications.
- **Multi-tenant scenarios** — Extend auth and data partitioning to support household members or collaborators with scoped access.

### Home & IoT Integrations
- **Sensor automations** — Tie MPU6050/DHT22 readings to actual automations (trigger fans, lights) via Home Assistant or MQTT bridges.
- **Energy usage optimisation** — Track electricity usage trends, predict high-consumption windows, and recommend scheduling adjustments for heavy appliances.
- **Security & presence detection** — Fuse schedule tasks, sensor data, and manual overrides to power occupancy-aware alerts.

### Content & Knowledge Ecosystem
- **Personal knowledge graph** — Link documents, conversations, prompts, and media outputs to uncover relationships and suggest relevant assets contextually.
- **Curated AI courseware** — Package prompts, documentation, and media into lesson flows for self-learning or sharing with others.
- **Public portfolio subset** — Automatically curate safe-to-share assets and publish them to a static site or newsletter generator.

## Prioritisation Seeds

| Category | Sample Impact | Effort Signal | Suggested Horizon |
| --- | --- | --- | --- |
| `chat5_6` modular events | ↑ Maintainability, ↓ bug risk | Medium (requires socket refactor + UI tweaks) | Near-term |
| Template rework | ↑ Productivity for recurring tasks | Medium-high (data model + caching + UI) | Near-term |
| Scheduled Sora batches | ↓ manual babysitting, ↓ cost | Medium (cron + webhooks + UI messaging) | Near-term |
| Bank API importer | ↑ Data freshness | High (API integration, auth flows) | Mid-term |
| Voice assistant mode | ↑ Accessibility & novelty | Medium (speech stack) | Mid-term |
| Personal data warehouse | ↑ Analytics depth | High (infra + ETL) | Long-term |

Use this list as a launchpad for roadmapping. When you pick an idea, spin up a dedicated spec in `documentation/` or a ticket in your task tracker to chase details.
