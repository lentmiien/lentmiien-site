# Project Idea 005 – Health Analytics & Trend Insights

## Goal
Enhance the health tracker with analytical views that surface trends, thresholds, and actionable summaries. Users should see rolling averages, alerts when metrics cross personalised limits, and visualisations that make longitudinal data useful.

## Scope Overview
- Expand health data models to store richer metadata (measurement context, tags).
- Implement analytics helpers to compute moving averages, min/max windows, and alert conditions.
- Update the health dashboard UI with charts, alert banners, and export options.
- Optionally integrate wearable data imports for automated updates.

## Key Code Touchpoints
- `controllers/healthcontroller.js`, `services/healthService.js`.
- `models/Health*` schemas.
- `views/health_*` templates plus client-side chart scripts.
- `utils/healthAnalytics.js` (new) for aggregation logic.
- Webhook or ingestion scripts if connecting to external wearable data.

## Implementation Notes
1. **Data enrichment** – Add fields to health entries (e.g., `measurementType`, `measurementContext`, `tags`, `notes`). Migrate existing data carefully with scripts.
2. **Analytics layer** – Write helper functions for rolling averages, trend direction, and thresholds (configurable per metric). Persist computed insights for quick rendering.
3. **UI redesign** – Display sparkline charts, highlight alerts (e.g., high blood pressure streak), and provide quick filters by date range or metric type.
4. **Notifications** – Optionally trigger email or in-app notifications when alert thresholds are breached.
5. **Documentation** – Update health tool docs and README sections to explain new analytics.

## Dependencies / Follow-ups
- Reuses chart patterns from the unified accounting project (Project Idea 003).
- Insights can feed into the Master Feed (Project Idea 011) and agent recommendations (Project Idea 013).
