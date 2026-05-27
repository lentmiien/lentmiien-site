# Project Idea 012 – Master Feed Analytics

## Goal
Aggregate events from across the platform (finance, cooking, health, media, agents) into a unified “Master Feed” that powers personalised dashboards and an audit-friendly timeline.

## Scope Overview
- Build a feed aggregation service that normalises events from multiple domains (budget anomalies, new Sora jobs, grocery list updates, health alerts).
- Expose feed endpoints for different audiences (personal homepage, admin audit view).
- Design UI components for the feed with filters, severity tags, and quick actions.

## Key Code Touchpoints
- New `services/feedService.js` to collate events; updates to existing services to publish feed events.
- `models/FeedEvent`.
- `routes/index.js`, new `/feed` or `/mypage` endpoints, plus Pug templates (`views/mypage_feed.pug`).
- Client-side scripts for real-time updates via Socket.IO (`socket_io` namespace for feeds).

## Implementation Notes
1. **Event schema** – Define a unified feed event format (source, type, payload, severity, user, timestamp). Update domain services (budget, cooking, health, agents) to emit events when key actions occur.
2. **Aggregation service** – Implement `FeedService` with pagination, filtering, and summarisation. Use Mongo aggregation or pipeline to merge data efficiently.
3. **UI/UX** – Create feed cards grouped by day, with icons per source. Provide filters (e.g., Finance, Media, Agents) and quick links back into the originating tool.
4. **Notifications** – Optionally push high-severity feed events to email or agent workflows for follow-up.

## Dependencies / Follow-ups
- Hooks into Project Idea 010 (agents) for automated monitoring output.
- Supplies data for public-facing portfolio feeds (Project Idea 015) after curation.
