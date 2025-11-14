# Project Idea 011 – Personal Data Warehouse & Knowledge Graph

## Goal
Create a unified analytics backend that consolidates financial, health, chat, and media data into a personal warehouse, layering a knowledge graph on top to reveal relationships across domains. This foundation supports advanced insights for agents and future BI tooling.

## Scope Overview
- Choose a warehouse engine (DuckDB/Postgres/Snowflake) and design ETL pipelines from Mongo collections and log archives.
- Model a lightweight knowledge graph that connects entities (people, conversations, recipes, budgets, media assets) with explicit relationships.
- Build ingestion scripts and schedulers that refresh both the warehouse and the graph on a cadence.
- Expose query interfaces (SQL endpoints, GraphQL resolvers, or materialised views) for agents, dashboards, and external BI tools.

## Key Code Touchpoints
- New ETL modules under `services/dataWarehouseService.js` and `services/knowledgeGraphService.js`.
- Nightly jobs in `schedulers/` to orchestrate extracts and loads.
- Utility helpers (`utils/warehouse/*.js`) for schema definitions, connection pooling, and batch inserts.
- `.env` additions for warehouse DSN, credentials, and tuning knobs.
- Documentation describing data lineage and governance.

## Implementation Notes
1. **Schema design** – Define warehouse tables (finance_transactions, health_metrics, chat_messages, media_jobs, agent_runs) plus dimension tables for dates, categories, and users.
2. **ETL pipelines** – Write extract/transform/load jobs that pull from Mongo, normalise nested JSON, and upsert into the warehouse using incremental checkpoints.
3. **Knowledge graph** – Represent relationships (conversation ↔ template, recipe ↔ grocery list, agent ↔ task) using a graph database (Neo4j) or adjacency tables. Provide API endpoints to query linked entities.
4. **Access layer** – Surface SQL/GraphQL endpoints so agents and dashboards can run analytics. Document exemplar queries (e.g., “Which templates correlate with budget savings?”).
5. **Security & retention** – Enforce access controls, strip sensitive fields for external exports, and define retention policies for warehouse snapshots.

## Dependencies / Follow-ups
- Supplies richer datasets for Project Idea 010 (Operational Monitoring Agents).
- Powers Project Idea 012 (Master Feed) and Project Idea 014 (Courseware) with enriched context.
