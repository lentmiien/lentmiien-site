# Emergency Stock v2

Emergency Stock v2 is a household stock-management system with preparedness calculations. It replaces the v1 average category score with a limiting-domain calculation while retaining every v1 category and inventory record.

## Targets

- Official floor: 3 days.
- Active transition target: the first milestone whose deadline has not passed in the configured household time zone.
- Long-term target: 7 days by 2026-12-31.

The default transition milestones are 4 days by 2026-09-30, 5 days by 2026-10-31, 6 days by 2026-11-30, and 7 days by 2026-12-31. Shopping requirements use only the active milestone. Forecast requirements evaluate stock immediately after every dated rotation through the milestone deadline, so a lot dated on the deadline still counts that day but its replacement is planned before the resulting next-day gap. The purchase-by date is the rotation or milestone date minus the applicable shopping lead time.

The default policy source is the [Cabinet Office disaster preparedness checklist](https://www.bousai.go.jp/kyoiku/hokenkyousai/check.html), which recommends at least three days and preferably one week of water and food, including 3 L of drinking water per person per day. Category explanations also use [Tokyo Stockpile Navi](https://www.bichiku.metro.tokyo.lg.jp/why/) for daily stockpiling and equipment-inspection guidance. Source metadata is stored separately from household overrides and never changes targets automatically.

## Management modes

- `rolling`: ordinary consumables. A requirement appears when stock reaches `reorderPoint`, and replenishes toward `restockToAmount`. `emergencyFloor` remains protected. When no override is stored, the reorder point is `emergencyFloor + normalConsumptionRate × shoppingLeadDays / consumptionPeriodDays`.
- `expiry-managed`: reserve lots. Warnings begin 30 days before the recorded date and become strong at 14 days. A lot continues to count through its actual date.
- `durable`: equipment. `lastVerifiedAt` and `inspectionDueAt` replace artificial expiry. Durable stock is excluded from preparedness days.

Items are only resolved by an explicit consumed, discarded, or replaced action. The scheduled maintenance task permanently removes resolved items after 30 days; it never deletes an expired but unresolved item.

Rolling and expiry-managed stock are both forecast through the active milestone. This means an otherwise healthy rolling category can create one advance requirement before dated stock rotates. Current and forecast quantities are retained separately in the requirement so the dashboard can explain the change.

## Applicability and targets

Conditional categories use three states: `applicable`, `not-applicable`, and `undecided`. An undecided category appears in the decision queue but is excluded from readiness and shopping, avoiding a purchase that exists only to satisfy a checklist. Legacy conditional records without an explicit decision become undecided during normalization and migration.

Category targets declare either `duration-scaled` or `fixed` behavior. Fixed targets remain whole at every milestone for one-off supplies and durable equipment; duration-scaled targets grow with preparedness days. Water, food, and toilet category records are presented as contributions to their domain pool rather than independent shortages, regardless of their target behavior.

## Preparedness calculation

Core preparedness is the minimum measurable coverage across water, pooled food, portable toilets, and applicable critical medications.

- Water days = usable litres / (household members × litres per person per day).
- Toilet days = complete uses / (household members × uses per person per day).
- Food capacity = complete meals + min(staple servings, main/protein servings).
- Food days = food capacity / (household members × meals per person per day).
- Critical-medication days = the least-covered applicable medicine, using its dose rate and dependent count.

Food categories contribute to pools through `contributionPerUnit`; an individual mixed or ambiguous lot can use `contributionOverride`. Dry rice stored in kilograms defaults to 1,000 / 75 staple servings per unit. Complete meals, staples, mains/protein, produce, no-cook meals, preparation water, and fuel dependence remain visible separately. Lots with no staple, main/protein, complete-meal, or produce classification appear in an evidence queue and count as zero. The queue shows a clearly labelled upper-bound scenario if each inventory unit were later verified as one complete meal, and provides a lot-level classification action. The five-day menu exercise checks 15 meal slots and surfaces missing complementary foods, preparation water, and cooking-fuel dependence.

Cooking fuel and backup power are shown as capabilities until household measurements support trustworthy duration models. N/A and undecided categories are excluded. Pooled domain categories are also excluded from the secondary category-target percentage because their readiness is already represented by the domain calculation. The percentage is never presented as overall preparedness.

## Unit safety

An existing category unit cannot be renamed through the general policy form. The dedicated converter performs compatible metric conversions automatically (including mL/L and g/kg), or requires an explicit factor for an unknown unit. It updates inventory quantities, targets, rates, package sizes, milestone overrides, and inverse per-unit contributions in one MongoDB transaction. Known incompatible dimensions are rejected.

The dashboard and daily maintenance task also flag any essential domain that calculates to more than 365 days. This does not change data; it is a sanity warning to inspect units, quantities, and contribution factors before relying on an implausible result.

## Migration

Preview the migration first:

```bash
npm run migrate:emergency-stock-v2
```

The preview reports how every existing category will be classified and how many items need compatibility fields. It does not write data. After reviewing the category list:

```bash
npm run migrate:emergency-stock-v2:execute
```

The migration adds missing v2 metadata without deleting or overwriting legacy `rotateDate` values. Implausibly distant dates on durable equipment, including the known year-3035 work-glove record, are preserved for audit history while the item becomes due for a real inspection.

## Review cycles

- Monthly: mark household quantities reviewed, handle expiry warnings, and close shopping gaps.
- Every six months: test durable equipment according to each category's inspection interval.
- After household changes: update people, medical needs, pets, residence, storage, and assumptions.
- Every two years: review the recommendation model and its official sources. The default next review is 2028-01-01.
