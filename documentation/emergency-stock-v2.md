# Emergency Stock v2

Emergency Stock v2 is a household stock-management system with preparedness calculations. It replaces the v1 average category score with a limiting-domain calculation while retaining every v1 category and inventory record.

## Targets

- Official floor: 3 days.
- Active transition target: the first milestone whose deadline has not passed in the configured household time zone.
- Long-term target: 7 days by 2026-12-31.

The default transition milestones are 4 days by 2026-09-30, 5 days by 2026-10-31, 6 days by 2026-11-30, and 7 days by 2026-12-31. Shopping requirements use only the active milestone.

The default policy source is the [Cabinet Office disaster preparedness checklist](https://www.bousai.go.jp/kyoiku/hokenkyousai/check.html), which recommends at least three days and preferably one week of water and food, including 3 L of drinking water per person per day. Category explanations also use [Tokyo Stockpile Navi](https://www.bichiku.metro.tokyo.lg.jp/why/) for daily stockpiling and equipment-inspection guidance. Source metadata is stored separately from household overrides and never changes targets automatically.

## Management modes

- `rolling`: ordinary consumables. A requirement appears when stock reaches `reorderPoint`, and replenishes toward `restockToAmount`. `emergencyFloor` remains protected. When no override is stored, the reorder point is `emergencyFloor + normalConsumptionRate × shoppingLeadDays / consumptionPeriodDays`.
- `expiry-managed`: reserve lots. Warnings begin 30 days before the recorded date and become strong at 14 days. A lot continues to count through its actual date.
- `durable`: equipment. `lastVerifiedAt` and `inspectionDueAt` replace artificial expiry. Durable stock is excluded from preparedness days.

Items are only resolved by an explicit consumed, discarded, or replaced action. The scheduled maintenance task permanently removes resolved items after 30 days; it never deletes an expired but unresolved item.

## Preparedness calculation

Core preparedness is the minimum measurable coverage across water, pooled food, portable toilets, and applicable critical medications.

- Water days = usable litres / (household members × litres per person per day).
- Toilet days = complete uses / (household members × uses per person per day).
- Food capacity = complete meals + min(staple servings, main/protein servings).
- Food days = food capacity / (household members × meals per person per day).
- Critical-medication days = the least-covered applicable medicine, using its dose rate and dependent count.

Food categories contribute to pools through `contributionPerUnit`; an individual mixed or ambiguous lot can use `contributionOverride`. Dry rice stored in kilograms defaults to 1,000 / 75 staple servings per unit. Complete meals, staples, mains/protein, produce, no-cook meals, preparation water, and fuel dependence remain visible separately. The five-day menu exercise checks 15 meal slots and surfaces missing complementary foods, preparation water, and cooking-fuel dependence.

Cooking fuel and backup power are shown as capabilities until household measurements support trustworthy duration models. N/A categories are excluded. The checklist percentage is secondary and never presented as overall preparedness.

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
