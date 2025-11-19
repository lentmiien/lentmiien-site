# Project Idea 008 – Comprehensive API Swagger Docs
`codex resume 019a9c6f-2188-7283-9c69-85b0e6bfd088`

## Goal
Author and publish clear OpenAPI/Swagger documentation for the app’s HTTP and Socket endpoints, making `/yaml-viewer` a single source of truth for API consumers and future automation work.

## Scope Overview
- Inventory existing routes and Socket.IO namespaces, documenting request/response schemas.
- Create modular OpenAPI specs (split by domain) and bundle them under `public/yaml/`.
- Wire generation scripts (optional) to keep specs up to date with minimal manual effort.
- Update `/yaml-viewer` landing page to highlight available specs and usage examples.

## Key Code Touchpoints
- `routes/*.js`, `controllers/*.js` – source of truth for API behaviour.
- `public/yaml/*.yaml` – new or updated OpenAPI documents (e.g., `core-api.yaml`, `chat.yaml`, `admin.yaml`).
- `controllers/yamlcontroller.js`, `routes/yaml.js` – ensure new specs appear in listings and previews.
- Documentation updates in `documentation/app-overview.md`, README.
- Optional helper scripts under `scripts/` or `utils/openapi`.

## Implementation Notes
1. **Route audit** – Catalogue REST endpoints and key Socket events. Define schemas for common models (conversation, message, budget transaction, etc.).
2. **Spec creation** – Author YAML files using shared components (`components/schemas`). Modularise by domain to keep files manageable.
3. **Validation** – Use Swagger CLI or `swagger-parser` to lint specs as part of a script (`npm run lint:openapi`).
4. **Viewer polish** – Enhance `/yaml-viewer` to include descriptions, tags, and quick links to relevant documentation.
5. **Process docs** – Add guidance on updating specs when routes change, potentially tying into Project Idea 007’s testing workflow.

## Dependencies / Follow-ups
- Supports agent automation (Project Idea 009) and voice assistant command discovery (Project Idea 012).
- Keep specs versioned if major breaking changes occur (tie into GitHub repo mirroring).
