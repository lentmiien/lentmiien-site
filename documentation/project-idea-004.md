# Project Idea 004 – Meal Plan → Stock Check → Grocery Workflow

## Goal
Connect the cooking calendar with pantry stock tracking and grocery list generation to create an end-to-end workflow: pick meals, verify ingredient availability, and push missing items into a grocery list ready for ordering.

## Scope Overview
- Extend the cooking planner to tag recipes with ingredient requirements and quantities.
- Integrate inventory data (existing pantry/stock tables or new collection) to detect shortages versus upcoming meals.
- Build a grocery list module that consolidates shortages, lets users adjust quantities/substitutions, and exports to CSV or connected delivery APIs.
- Provide UI flows in the cooking dashboard to confirm each step (plan → check → add to list).

## Key Code Touchpoints
- `controllers/cookingcontroller.js`, `services/cookingCalendarService.js`.
- `services/messageService.js` or new `services/groceryListService.js` for list persistence.
- `models/Cooking*`, `models/Inventory*` (create if missing).
- `views/cooking_*` templates, any client-side scripts for planner interactions.
- Potential API integrations (e.g., meal planner route updates in `routes/cooking.js`).

## Implementation Notes
1. **Recipe metadata** – Add structured ingredient lists to recipe definitions (Mongo schema update). Include units, optional substitutes, and pantry category tags.
2. **Inventory checks** – Implement a service function to compare upcoming meals against inventory counts, returning shortage summaries.
3. **Grocery list builder** – Create UI modal or page that lists shortages, allows edits, and persists the final list (with status tracking like pending/purchased).
4. **Workflow UI** – Embed action buttons on the cooking calendar (e.g., “Check stock” → “Add to grocery list”) and surface alerts when shortages exist.
5. **Notifications/Exports** – Optionally send a summary email (Mailgun) or integrate with external grocery APIs in later iterations.

## Dependencies / Follow-ups
- Relies on accurate recipe data; coordinate with knowledge ingestion agents (Project Idea 009/013) to keep recipes updated.
- Grocery events can feed into the Master Feed (Project Idea 011) for a consolidated timeline.
