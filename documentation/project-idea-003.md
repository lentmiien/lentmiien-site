# Project Idea 003 – Unified Accounting Workspace
`codex resume 019a8547-3d99-7f41-8fcb-9124e6803974`

## Goal
Merge the existing budget dashboards and credit card views into a cohesive accounting hub that shares the modern styling from the credit card tool, while adding deeper analytics. The unified tool should let users ingest transactions, reconcile credit card spend, view cash-flow summaries, and surface anomaly alerts in one experience.

## Scope Overview
- Consolidate routing so `/accounting` (or updated `/budget`) loads a single controller that orchestrates both budget and credit card data.
- Refactor `BudgetService` and `CreditCardService` to expose composable APIs for balances, categories, statements, and trends.
- Refresh the Pug templates to use a shared component set (charts, tables, filters) with responsive design.
- Introduce analytics panels (e.g., spend by category, month-over-month deltas, credit utilisation) leveraging existing services or new aggregation helpers.

## Key Code Touchpoints
- `controllers/accountingController.js`, `services/budgetService.js`.
- `services/creditCardService.js`, any credit-card-specific routes or views.
- `routes/accounting.js` and associated middleware.
- `views/budget_*` templates, shared partials, and static assets under `public/js/budget/*.js`.
- Mongo models feeding budget/credit card data (`models/Budget*`).

## Implementation Notes
1. **Routing & controller structure** – Create a single controller (e.g., `controllers/accountingController.js`) that composes dashboard, review, and statement subviews. Deprecate redundant routes while adding redirects for backwards compatibility.
2. **Service harmonisation** – Standardise method signatures (e.g., `getTransactions`, `getSummary`, `getAnomalies`) and move shared logic (date filtering, currency formatting) into `utils/finance.js`.
3. **UI overhaul** – Adopt the newer credit card styling as the base layout. Introduce tabs or stacked cards for budgets, credit cards, and analytics. Add charts (using existing chart libs) for top categories, monthly trendlines, and credit utilisation.
4. **Analytics enhancements** – Implement new aggregation queries (e.g., Mongo pipelines) to surface anomalies, recurring payments, or statement reconciliation status.
5. **Migration plan** – Update navigation links, adjust access control in `routes/index.js`, and update documentation/readme references.

## Dependencies / Follow-ups
- Coordinate with Project Idea 005 (Health analytics) and Project Idea 011 (Master feed) to reuse analytics patterns and feed financial events into the unified audit trail.
- Add Jest coverage for new service methods (tie into Project Idea 007).

---

**Implementation Notes (Nov 2025)**  
- `/accounting` and `/budget` now share `controllers/accountingController.js` and render `views/accounting_dashboard.pug`.  
- Legacy routes live under `/accounting/legacy` if the original budget UI is still needed.
