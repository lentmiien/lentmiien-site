# Project Idea 005 - Health Analytics & Trend Insights
`codex resume 019a8cb8-b95f-78d1-8075-ebe01cc71015`

## Goal
Enhance the health tracker with analytical views that surface trends, thresholds, and actionable summaries. Users should see rolling averages, alerts when metrics cross personalised limits, and visualisations that make longitudinal data useful.

## Status
- ✅ Health analytics dashboard shipped (Nov 2025): rolling averages, Chart.js visualisations, alert banners, CSV export.
- ✅ Health entry schema enriched with measurement metadata, tags, notes, personalised thresholds, and cached insights per entry.
- ✅ `/health/analytics` API endpoint plus cache file (`cache/health_insights.json`) persist computed insights for reuse.
- ✅ Views (`health_top`, `health_edit`) refreshed to manage metadata, thresholds, inline alerts, and viewing enhancements.

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
1. **Data enrichment** - Add fields to health entries (e.g., `measurementType`, `measurementContext`, `tags`, `notes`). Migrate existing data carefully with scripts.
2. **Analytics layer** - Write helper functions for rolling averages, trend direction, and thresholds (configurable per metric). Persist computed insights for quick rendering.
3. **UI redesign** - Display sparkline charts, highlight alerts (e.g., high blood pressure streak), and provide quick filters by date range or metric type.
4. **Notifications** - Optionally trigger email or in-app notifications when alert thresholds are breached.
5. **Documentation** - Update health tool docs and README sections to explain new analytics.

## Usage Notes
1. Visit `/health` to open the dashboard, adjust the date range + rolling window (7/14/30 days), and optionally focus on a specific metric.
2. Alert banners summarise streaks above/below personalised thresholds; filter high/low alerts or export series via “Export analytics CSV”.
3. Use the “View” action per day to inspect metadata, tags, diary context, personalised thresholds, and cached insights.
4. Edit/create days via `/health/edit/:date` to capture measurement type/context, tags, notes, and per-metric min/max thresholds that drive alerting.
5. The analytics endpoint caches to `cache/health_insights.json`, so downstream services can re-use snapshots without recomputing trends.

## Dependencies / Follow-ups
- Reuses chart patterns from the unified accounting project (Project Idea 003).
- Insights can feed into the Master Feed (Project Idea 011) and agent recommendations (Project Idea 013).
