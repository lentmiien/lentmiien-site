'use strict';

const NATIONAL_GUIDANCE_SOURCE = Object.freeze({
  label: 'Cabinet Office of Japan — disaster preparedness checklist',
  url: 'https://www.bousai.go.jp/kyoiku/hokenkyousai/check.html',
  lastReviewedAt: new Date('2026-08-22T00:00:00.000Z'),
});

const TOKYO_STOCKPILE_SOURCE = Object.freeze({
  label: 'Tokyo Metropolitan Government — Tokyo Stockpile Navi',
  url: 'https://www.bichiku.metro.tokyo.lg.jp/why/',
  lastReviewedAt: new Date('2026-08-22T00:00:00.000Z'),
});

const DURABLE_PATTERN = /bag|backpack|charger|charging cable|charging capability|power bank|battery pack|flashlight|torch|radio|stove|lantern|multi.?tool|first.?aid (box|container|kit)|work glove|helmet|whistle|blanket|sleeping bag|water container|bucket|can opener|lighter|match|thermometer|fire extinguisher/i;
const ROLLING_PATTERN = /toilet paper|tissue|rice|bottled water|packaged food|canned|drink|beverage|wipe|mask|saniti[sz]er|soap|shampoo|medicine|medication|bandage|gauze|diaper|nappy|menstrual|sanitary|skincare|skin care|tooth|garbage bag|plastic bag|wrap|foil|battery|pet food/i;
const EXPIRY_PATTERN = /emergency food|survival food|long.?life|hand warmer|gas canister|cassette gas|fuel|chemical light|glow stick/i;

function categoryName(categoryOrName) {
  if (typeof categoryOrName === 'string') {
    return categoryOrName.trim();
  }
  return String(categoryOrName?.name || '').trim();
}

function inferManagementMode(categoryOrName) {
  const explicit = categoryOrName && typeof categoryOrName === 'object'
    ? categoryOrName.managementMode
    : null;
  if (['rolling', 'expiry-managed', 'durable'].includes(explicit)) {
    return explicit;
  }

  const name = categoryName(categoryOrName);
  if (EXPIRY_PATTERN.test(name)) return 'expiry-managed';
  if (DURABLE_PATTERN.test(name)) return 'durable';
  if (ROLLING_PATTERN.test(name)) return 'rolling';
  return 'expiry-managed';
}

function inferPreparednessDomain(categoryOrName) {
  const explicit = categoryOrName && typeof categoryOrName === 'object'
    ? categoryOrName.preparednessDomain
    : null;
  if (explicit && explicit !== 'other') {
    return explicit;
  }

  const name = categoryName(categoryOrName);
  if (/portable toilet|emergency toilet|toilet bag|waste bag.*toilet/i.test(name)) return 'toilet';
  if (/drinking water|bottled water|long.?life water|emergency water|^water$/i.test(name)) return 'water';
  if (/prescription|critical medication|essential medication|daily medication/i.test(name)) return 'critical-medication';
  if (/gas canister|cassette gas|cooking fuel|solid fuel|camp stove|cassette stove|portable stove|^stove/i.test(name)) return 'cooking-fuel';
  if (/power bank|battery pack|backup power|portable power|generator/i.test(name)) return 'power';
  if (/rice|noodle|pasta|cereal|food|meal|canned|protein|fruit|vegetable|snack|bread|cracker|biscuit/i.test(name)) return 'food';
  return 'other';
}

function genericGuidance(name, mode, unit) {
  const readableUnit = unit || 'recorded units';
  if (mode === 'durable') {
    return {
      purpose: `Keep ${name} accessible and usable during an outage or evacuation.`,
      whyItMatters: 'Equipment only helps when it can be found, is compatible, and works when tested.',
      qualifies: `Usable ${name} that is stored accessibly and has passed its latest inspection.`,
      doesNotQualify: 'Missing, damaged, incompatible, inaccessible, or untested equipment.',
      calculationRule: `Condition-based checklist measured in ${readableUnit}; it does not add preparedness days.`,
      examples: [`A tested ${name} already used by the household`],
    };
  }
  if (mode === 'rolling') {
    return {
      purpose: `Maintain enough ${name} for routine use without consuming the emergency floor.`,
      whyItMatters: 'Normal household consumption should trigger replenishment before emergency reserves are breached.',
      qualifies: `Usable household stock that can be reasonably measured in ${readableUnit}.`,
      doesNotQualify: 'Unusable, discarded, unmeasurable, or already consumed stock.',
      calculationRule: `Sum active stock in ${readableUnit}; reorder at the configured point and replenish to the restock-to amount.`,
      examples: [`Ordinary ${name} currently available to the household`],
    };
  }
  return {
    purpose: `Keep a protected reserve of ${name} available for disruption.`,
    whyItMatters: 'Reserve stock needs enough replacement lead time without being removed before its actual rotation date.',
    qualifies: `Usable, unresolved ${name} within its recorded rotation date.`,
    doesNotQualify: 'Consumed, discarded, resolved, or past-date stock.',
    calculationRule: `Sum active lots in ${readableUnit}; warn 30 days before rotation and keep counting each lot through its rotation date.`,
    examples: [`A dated reserve lot of ${name}`],
  };
}

function matchedGuidance(name) {
  if (/menstrual|sanitary pad|tampon/i.test(name)) {
    return {
      purpose: 'Cover the normal menstrual-care needs of household members during disruption.',
      whyItMatters: 'Preferred products can be difficult to obtain after a disaster.',
      qualifies: 'Products normally used by a household member, measured as individual items or days of normal use.',
      doesNotQualify: 'Arbitrary “sets,” unsuitable products, or stock for a household with no applicable need.',
      calculationRule: 'Count usable individual products or convert them to days using the household member’s normal rate; mark N/A when not applicable.',
      examples: ['Pads', 'Tampons', 'Reusable products with the supplies needed to use them safely'],
      conditional: true,
      recommendedUnit: 'items',
    };
  }
  if (/skincare|skin care|moisturi[sz]er/i.test(name)) {
    return {
      purpose: 'Maintain products whose absence would cause a meaningful health or comfort problem.',
      whyItMatters: 'Some skin conditions need continuity, while optional cosmetics are not emergency essentials.',
      qualifies: 'A normally used product needed for a skin condition or material comfort need.',
      doesNotQualify: 'An arbitrary bottle purchased only to complete a checklist.',
      calculationRule: 'Track the normal usable quantity, or mark N/A when the household has no meaningful need.',
      examples: ['Prescribed emollient', 'Normally required fragrance-free moisturiser'],
      conditional: true,
    };
  }
  if (/phone charg|charging capability|charger|charging cable/i.test(name) && !/power bank|backup/i.test(name)) {
    return {
      purpose: 'Keep every essential phone or communication device chargeable when mains power is available.',
      whyItMatters: 'A correct cable and charger are necessary for communications and alerts.',
      qualifies: 'A compatible charger and cable that have been tested with each essential device; ordinary household chargers count.',
      doesNotQualify: 'A cable with no compatible power adapter, an incompatible connector, or untested hardware.',
      calculationRule: 'Binary checklist: all essential devices have a compatible, tested charging path. This does not add outage duration.',
      examples: ['Existing USB-C charger and tested cable', 'Required adapter for an older device'],
      recommendedUnit: 'essential devices covered',
    };
  }
  if (/power bank|backup power|portable power|battery pack/i.test(name)) {
    return {
      purpose: 'Provide device power when mains electricity is unavailable.',
      whyItMatters: 'Wall chargers alone cannot keep communications running through an outage.',
      qualifies: 'A tested power bank or portable power supply with known usable capacity and compatible cables.',
      doesNotQualify: 'A wall charger, depleted battery, unknown-condition device, or incompatible cable.',
      calculationRule: 'Track tested usable capacity or expected essential-device recharges; show as a capability until duration is configured.',
      examples: ['Tested 20,000 mAh USB power bank', 'Portable power station with a recent capacity test'],
    };
  }
  if (/emergency bag|go bag|evacuation bag|backpack/i.test(name)) {
    return {
      purpose: 'Keep the household evacuation load accessible and ready to carry.',
      whyItMatters: 'Supplies may need to move quickly if remaining at home is unsafe.',
      qualifies: 'One accessible, inspected bag that fits the household evacuation plan.',
      doesNotQualify: 'An inaccessible, damaged, overloaded, or uninspected bag.',
      calculationRule: 'Binary inspected checklist item; it never contributes preparedness days.',
      examples: ['A labelled go-bag stored by the exit'],
      conditional: true,
    };
  }
  if (/drinking water|bottled water|long.?life water|emergency water|^water$/i.test(name)) {
    return {
      purpose: 'Provide safe drinking and basic food-preparation water while supply is disrupted.',
      whyItMatters: 'Water is a limiting life-safety domain and may be unavailable immediately after a disaster.',
      qualifies: 'Sealed drinking water plus opened household water that remains safe and can be reasonably measured.',
      doesNotQualify: 'Non-potable water or an opened amount that cannot be estimated reliably.',
      calculationRule: 'Water days = usable litres ÷ (household members × 3 litres per day), unless the household overrides the rate.',
      examples: ['Sealed 2 L bottles', 'A measurable, recently opened drinking-water container'],
      contributionPerUnit: { domainUnits: 1 },
      officialBaseline: 27,
      personalTarget: 63,
      milestones: [
        { deadline: new Date('2026-09-30T00:00:00.000Z'), target: 36 },
        { deadline: new Date('2026-10-31T00:00:00.000Z'), target: 45 },
        { deadline: new Date('2026-11-30T00:00:00.000Z'), target: 54 },
        { deadline: new Date('2026-12-31T00:00:00.000Z'), target: 63 },
      ],
    };
  }
  if (/portable toilet|emergency toilet|toilet bag/i.test(name)) {
    return {
      purpose: 'Provide sanitary toilet uses while sewerage or water service is unavailable.',
      whyItMatters: 'Loss of toilet access becomes an immediate hygiene and health problem.',
      qualifies: 'A complete portable-toilet use, including the required bag and coagulant or treatment material.',
      doesNotQualify: 'Loose bags or components that cannot make a complete usable toilet setup.',
      calculationRule: 'Toilet days = complete uses ÷ (applicable household members × configured uses per person per day).',
      examples: ['One bag-and-coagulant kit counted as one use'],
      recommendedUnit: 'uses',
      contributionPerUnit: { domainUnits: 1 },
      officialBaseline: 45,
      personalTarget: 105,
      milestones: [
        { deadline: new Date('2026-09-30T00:00:00.000Z'), target: 60 },
        { deadline: new Date('2026-10-31T00:00:00.000Z'), target: 75 },
        { deadline: new Date('2026-11-30T00:00:00.000Z'), target: 90 },
        { deadline: new Date('2026-12-31T00:00:00.000Z'), target: 105 },
      ],
    };
  }
  if (/canned (fish|meat|bean|protein)|tinned (fish|meat|bean|protein)/i.test(name)) {
    return {
      purpose: 'Supply main-dish or protein servings within the shared food pool.',
      whyItMatters: 'Staples alone do not form the complete meal capacity used for preparedness days.',
      qualifies: 'A person-sized, household-compatible protein or main-dish serving.',
      doesNotQualify: 'A can counted as one serving when its usable serving count differs.',
      calculationRule: 'Convert each inventory unit to person-servings and add it to the main/protein pool.',
      examples: ['Canned fish', 'Canned meat', 'Beans used as the meal protein'],
      contributionPerUnit: { mainDishServings: 1 },
    };
  }
  if (/canned (fruit|vegetable)|tinned (fruit|vegetable)/i.test(name)) {
    return {
      purpose: 'Provide fruit and vegetable sources within the food plan.',
      whyItMatters: 'Produce improves dietary quality but does not substitute for complete meal capacity.',
      qualifies: 'A measurable person-serving the household can eat within its dietary restrictions.',
      doesNotQualify: 'A whole multipack counted as one serving or an unsuitable product.',
      calculationRule: 'Track person-servings in the produce pool; show them alongside, but do not add them to, core meal capacity.',
      examples: ['Canned tomatoes', 'Canned fruit in individual servings'],
      contributionPerUnit: { produceServings: 1 },
    };
  }
  if (/canned food|packaged food|mixed food/i.test(name)) {
    return {
      purpose: 'Group shelf-stable foods while preserving their actual role in the shared food pool.',
      whyItMatters: 'A mixed category can contain complete meals, staples, proteins, and produce that are not interchangeable one-for-one.',
      qualifies: 'Usable food with a lot-level or category-level serving contribution and dietary fit recorded.',
      doesNotQualify: 'An unclassified can or package assumed to be a complete meal solely because it is food.',
      calculationRule: 'Assign each lot as complete meals, staple servings, main/protein servings, or produce servings; preparedness uses the resulting pools.',
      examples: ['A canned-meal lot marked complete', 'Canned fish marked main/protein', 'Canned fruit marked produce'],
    };
  }
  if (/emergency meal|survival meal|complete meal|meal ration/i.test(name)) {
    return {
      purpose: 'Provide complete person-meals from specialist or shelf-stable food.',
      whyItMatters: 'A complete meal supplies both staple and complementary food without double counting separate pools.',
      qualifies: 'One nutritionally meaningful person-meal that fits household dietary needs.',
      doesNotQualify: 'A snack, drink, or staple-only serving labelled as a complete meal.',
      calculationRule: 'Count person-meals directly in the complete-meal pool and record no-cook, water, and fuel needs separately.',
      examples: ['One complete emergency ration', 'A shelf-stable meal with staple and main dish'],
      contributionPerUnit: { completeMeals: 1 },
    };
  }
  if (/dry rice|uncooked rice|^rice$/i.test(name)) {
    return {
      purpose: 'Supply staple servings within the household food pool.',
      whyItMatters: 'Rice can cover many staple portions but still needs water, fuel, and complementary food.',
      qualifies: 'Usable dry rice that can be cooked with the available water and fuel plan.',
      doesNotQualify: 'An amount that cannot be measured or prepared under the household plan.',
      calculationRule: 'Convert dry rice to staple servings at 75 g per serving; pool it with other staples rather than scoring rice separately.',
      examples: ['2 kg dry rice ≈ 26.7 staple servings'],
    };
  }
  if (/ready rice|retort rice|pre.?cooked rice/i.test(name)) {
    return {
      purpose: 'Supply quickly prepared staple servings within the household food pool.',
      whyItMatters: 'Ready rice reduces preparation demands compared with dry staples.',
      qualifies: 'One edible person-sized rice serving.',
      doesNotQualify: 'A multipack counted as one when it contains several individual servings.',
      calculationRule: 'Count individual staple servings and pool them with rice, noodles, cereal, and other substitutable staples.',
      examples: ['One 180–200 g ready-rice tray = one staple serving'],
      contributionPerUnit: { stapleServings: 1, fuelMealsRequired: 1 },
    };
  }
  if (/noodle|pasta|cereal|bread|cracker|biscuit/i.test(name)) {
    return {
      purpose: 'Supply substitutable staple servings within the household food pool.',
      whyItMatters: 'A varied staple pool avoids false shortages caused by isolated category quotas.',
      qualifies: 'A measurable person-sized serving that fits household dietary needs.',
      doesNotQualify: 'An entire multipack counted as a single serving or food the household cannot eat.',
      calculationRule: 'Count person-servings and add them to the shared staple pool.',
      examples: ['One portion of noodles', 'One normal cereal serving'],
      contributionPerUnit: { stapleServings: 1 },
    };
  }
  if (/critical medication|essential medication|daily medication|prescription/i.test(name)) {
    return {
      purpose: 'Maintain uninterrupted access to medication whose absence creates material health risk.',
      whyItMatters: 'Critical medication may be difficult to replace during a disruption.',
      qualifies: 'Usable doses for the specific person who needs them, stored according to medical instructions.',
      doesNotQualify: 'General first-aid products or medication not prescribed/appropriate for the household member.',
      calculationRule: 'Medication days are calculated per required medicine; the least-covered applicable medicine limits the domain.',
      examples: ['Daily prescribed doses with a recorded dose rate'],
      conditional: true,
    };
  }
  if (/gas canister|cassette gas|cooking fuel/i.test(name)) {
    return {
      purpose: 'Keep a tested cooking method supplied while household gas and electricity are unavailable.',
      whyItMatters: 'A food plan that depends on heating also depends on enough compatible fuel.',
      qualifies: 'Compatible, undamaged fuel canisters stored safely and within their manufacturer guidance.',
      doesNotQualify: 'Incompatible, damaged, leaking, or improperly stored canisters.',
      calculationRule: 'Track canisters as a required capability using the household transition milestones; do not convert them to preparedness days until measured burn tests support that model.',
      examples: ['Cassette-gas canister compatible with the inspected household stove'],
      officialBaseline: 12,
      personalTarget: 18,
      milestones: [
        { deadline: new Date('2026-09-30T00:00:00.000Z'), target: 12 },
        { deadline: new Date('2026-10-31T00:00:00.000Z'), target: 13 },
        { deadline: new Date('2026-11-30T00:00:00.000Z'), target: 16 },
        { deadline: new Date('2026-12-31T00:00:00.000Z'), target: 18 },
      ],
    };
  }
  return null;
}

function getCategoryGuidance(category = {}) {
  const name = categoryName(category) || 'this category';
  const managementMode = inferManagementMode(category);
  const preparednessDomain = inferPreparednessDomain(category);
  const specific = matchedGuidance(name) || {};
  const generic = genericGuidance(name, managementMode, category.unit);
  const hasSafeSourceUrl = /^https?:\/\//i.test(String(category.source?.url || ''));
  const source = hasSafeSourceUrl
    ? category.source
    : (preparednessDomain === 'other' ? TOKYO_STOCKPILE_SOURCE : NATIONAL_GUIDANCE_SOURCE);

  return {
    managementMode,
    preparednessDomain,
    conditional: category.conditional ?? specific.conditional ?? false,
    purpose: category.purpose || specific.purpose || generic.purpose,
    whyItMatters: category.whyItMatters || specific.whyItMatters || generic.whyItMatters,
    qualifies: category.qualifies || specific.qualifies || generic.qualifies,
    doesNotQualify: category.doesNotQualify || specific.doesNotQualify || generic.doesNotQualify,
    calculationRule: category.calculationRule || specific.calculationRule || generic.calculationRule,
    examples: category.examples?.length ? category.examples : (specific.examples || generic.examples),
    source,
    contributionPerUnit: category.contributionPerUnit || specific.contributionPerUnit,
    officialBaseline: category.officialBaseline ?? specific.officialBaseline,
    personalTarget: category.personalTarget ?? specific.personalTarget,
    milestones: category.milestones?.length ? category.milestones : specific.milestones,
    goalDate: category.goalDate ?? (specific.milestones?.length ? new Date('2026-12-31T00:00:00.000Z') : undefined),
    recommendedUnit: specific.recommendedUnit,
  };
}

function buildMigrationFields(category = {}) {
  const guidance = getCategoryGuidance(category);
  const fields = {};
  [
    'managementMode',
    'preparednessDomain',
    'conditional',
    'purpose',
    'whyItMatters',
    'qualifies',
    'doesNotQualify',
    'calculationRule',
    'examples',
    'source',
    'contributionPerUnit',
    'officialBaseline',
    'personalTarget',
    'milestones',
    'goalDate',
  ].forEach((key) => {
    const current = category[key];
    const missing = current === undefined || current === null || current === '' ||
      (Array.isArray(current) && current.length === 0);
    if (missing && guidance[key] !== undefined) {
      fields[key] = guidance[key];
    }
  });

  if (guidance.recommendedUnit && /^(set|sets|unit|units)$/i.test(String(category.unit || '').trim())) {
    fields.unit = guidance.recommendedUnit;
  }

  if ((category.officialBaseline === undefined || category.officialBaseline === null) && fields.officialBaseline === undefined) {
    fields.officialBaseline = Number(category.recommendedStock) || 0;
  }
  if (guidance.managementMode === 'rolling') {
    const baseline = Number(category.emergencyFloor ?? fields.officialBaseline ?? category.officialBaseline ?? category.recommendedStock) || 0;
    if (category.emergencyFloor === undefined || category.emergencyFloor === null) fields.emergencyFloor = baseline;
    if (category.reorderPoint === undefined || category.reorderPoint === null) {
      const rate = Number(category.normalConsumptionRate) || 0;
      const periodDays = Number(category.consumptionPeriodDays) || 30;
      const leadDays = Number(category.shoppingLeadDays) || 7;
      fields.reorderPoint = baseline + (rate * leadDays / periodDays);
    }
    if (category.restockToAmount === undefined || category.restockToAmount === null) {
      fields.restockToAmount = Number(category.personalTarget ?? fields.personalTarget ?? category.recommendedStock) || baseline;
    }
  }
  return fields;
}

module.exports = {
  NATIONAL_GUIDANCE_SOURCE,
  TOKYO_STOCKPILE_SOURCE,
  buildMigrationFields,
  getCategoryGuidance,
  inferManagementMode,
  inferPreparednessDomain,
};
