# Project Idea 012 – Master Feed & Sensor Analytics Revival

## Goal
Re-enable home sensor dashboards and aggregate events from across the platform (finance, cooking, health, media, agents) into a unified “Master Feed” that powers personalised dashboards and an audit-friendly timeline.

## Scope Overview
- Restore MPU6050/DHT22 ingestion, ensuring data is stored reliably with timestamps and device metadata.
- Build a feed aggregation service that normalises events from multiple domains (budget anomalies, new Sora jobs, grocery list updates, health alerts, sensor readings).
- Expose feed endpoints for different audiences (personal homepage, admin audit view).
- Design UI components for the feed with filters, severity tags, and quick actions.

## Key Code Touchpoints
- Sensor routes/controllers (`controllers/indexcontroller.js` for `/mpu6050`, `/dht22`), hardware ingestion scripts, and Mongo collections storing readings.
- New `services/feedService.js` to collate events; updates to existing services to publish feed events.
- `models/FeedEvent`, `models/SensorReading`.
- `routes/index.js`, new `/feed` or `/mypage` endpoints, plus Pug templates (`views/mypage_feed.pug`).
- Client-side scripts for real-time updates via Socket.IO (`socket_io` namespace for feeds).

## Implementation Notes
1. **Sensor revival** – Audit existing sensor ingestion code, ensure reliability (queue readings, fallback storage). Add analytics functions (averages, thresholds).
2. **Event schema** – Define a unified feed event format (source, type, payload, severity, user, timestamp). Update domain services (budget, cooking, health, agents) to emit events when key actions occur.
3. **Aggregation service** – Implement `FeedService` with pagination, filtering, and summarisation. Use Mongo aggregation or pipeline to merge data efficiently.
4. **UI/UX** – Create feed cards grouped by day, with icons per source. Provide filters (e.g., Sensors, Finance, Media, Agents) and quick links back into the originating tool.
5. **Notifications** – Optionally push high-severity feed events to email or agent workflows for follow-up.

## Dependencies / Follow-ups
- Hooks into Project Idea 010 (agents) for automated monitoring output.
- Supplies data for public-facing portfolio feeds (Project Idea 015) after curation.
