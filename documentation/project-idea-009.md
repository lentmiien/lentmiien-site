# Project Idea 009 – In-App Roadmap DB & Automation Agents

## Goal
Establish an internal project/todo database and a lightweight agent orchestration framework that can flesh out ideas, write code, review changes, and mark tasks complete. This creates a foundation for autonomous maintenance informed by the ideas captured in `ideas.md`.

## Scope Overview
- Design a Mongo-backed schema for project ideas, tasks, statuses, and ownership metadata.
- Build CRUD UI within the app (admin panel or new `/roadmap` route) to add, prioritise, and track tasks.
- Extend `agentService` to support specialised agents (planner, coder, reviewer, deployer), each with scoped tools and triggers.
- Implement automation hooks that listen to task status changes and orchestrate agent workflows (e.g., planner expands idea → coder attempts change → reviewer validates → deployer merges/marks done).

## Key Code Touchpoints
- `models/` – add `RoadmapProject`, `RoadmapTask`, `AgentRun` schemas.
- `services/agentService.js` – extend with orchestration logic, tool registry, and execution policies.
- New service modules (`services/roadmapService.js`, `services/agentWorkflowService.js`).
- `controllers/admincontroller.js` or new `controllers/roadmapcontroller.js`; routes under `routes/admin.js` or new `routes/roadmap.js`.
- `views/admin/*` or new Pug templates for roadmap dashboards.
- Background runners/schedulers (reuse `schedulers/` for periodic agent checks).

## Implementation Notes
1. **Data model** – Define project document (title, description, priority, tags) and task subdocuments (status, assigned agent type, linked code refs). Include audit trail fields.
2. **UI & API** – Build forms/table views to create and manage tasks. Provide REST endpoints for agents to claim work, post updates, and upload artifacts (logs, diffs).
3. **Agent framework** – Within `agentService`, register agent roles with capabilities (e.g., planner uses GPT to expand idea, coder interacts with Codex CLI, reviewer runs tests). Ensure execution is sandboxed and auditable.
4. **Workflow automation** – Implement a simple state machine: when a task enters “Ready”, planner agent expands spec; upon approval, coder agent executes; reviewer runs tests; deployer finalises and marks complete. Use message queues or Mongo watchers to trigger jobs.
5. **Governance** – Add permission checks, manual override options, and notification hooks (Mailgun or in-app alerts) for each transition.

## Dependencies / Follow-ups
- Builds on Project Idea 008 (API docs) so agents can self-discover endpoints.
- Future projects (010–014) can be seeded as roadmap entries consumed by these agents.
