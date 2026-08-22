'use strict';

const {
  NATIONAL_GUIDANCE_SOURCE,
  getCategoryGuidance,
} = require('./emergencyStockCategoryGuidance');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const EXPIRY_WARNING_DAYS = 30;
const EXPIRY_STRONG_WARNING_DAYS = 14;
const SANITY_MAX_DOMAIN_DAYS = 365;
const POOLED_DOMAINS = Object.freeze(['water', 'food', 'toilet']);
const FOOD_CLASSIFICATION_KEYS = Object.freeze([
  'completeMeals',
  'stapleServings',
  'mainDishServings',
  'produceServings',
]);
const CONTRIBUTION_KEYS = [
  'domainUnits',
  'completeMeals',
  'stapleServings',
  'mainDishServings',
  'produceServings',
  'noCookMeals',
  'waterLitresRequired',
  'fuelMealsRequired',
];

const DEFAULT_MILESTONES = Object.freeze([
  { deadline: new Date('2026-09-30T00:00:00.000Z'), targetDays: 4 },
  { deadline: new Date('2026-10-31T00:00:00.000Z'), targetDays: 5 },
  { deadline: new Date('2026-11-30T00:00:00.000Z'), targetDays: 6 },
  { deadline: new Date('2026-12-31T00:00:00.000Z'), targetDays: 7 },
]);

const DEFAULT_PROFILE = Object.freeze({
  key: 'household',
  householdSize: 3,
  officialFloorDays: 3,
  longTermTargetDays: 7,
  longTermGoalDate: new Date('2026-12-31T00:00:00.000Z'),
  mealsPerPersonDay: 3,
  waterLitresPerPersonDay: 3,
  toiletUsesPerPersonDay: 5,
  milestones: DEFAULT_MILESTONES,
  recommendationReviewedAt: new Date('2026-08-22T00:00:00.000Z'),
  recommendationNextReviewAt: new Date('2028-01-01T00:00:00.000Z'),
  recommendationSource: NATIONAL_GUIDANCE_SOURCE,
  timeZone: DEFAULT_TIME_ZONE,
});

function asPlain(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject({ depopulate: true });
  }
  return value || {};
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKeyInTimeZone(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = validDate(value);
  if (!date) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
  } catch (_error) {
    return date.toISOString().slice(0, 10);
  }
}

function dateOnlyKey(value) {
  const date = validDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function calendarDaysBetween(fromKey, toKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
    return null;
  }
  return Math.round((Date.parse(`${toKey}T00:00:00.000Z`) - Date.parse(`${fromKey}T00:00:00.000Z`)) / DAY_MS);
}

function addCalendarDays(value, days, timeZone = DEFAULT_TIME_ZONE) {
  const key = dateKeyInTimeZone(value, timeZone);
  const timestamp = Date.parse(`${key}T00:00:00.000Z`);
  return new Date(timestamp + days * DAY_MS);
}

function dateFromKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))
    ? new Date(`${key}T00:00:00.000Z`)
    : null;
}

function normalizeProfile(profile = {}) {
  const plain = asPlain(profile);
  const milestones = Array.isArray(plain.milestones) && plain.milestones.length
    ? plain.milestones
      .map(entry => ({
        deadline: validDate(entry.deadline),
        targetDays: positiveNumber(entry.targetDays),
      }))
      .filter(entry => entry.deadline && entry.targetDays > 0)
    : DEFAULT_MILESTONES.map(entry => ({ ...entry }));

  milestones.sort((a, b) => a.deadline - b.deadline);
  return {
    ...DEFAULT_PROFILE,
    ...plain,
    householdSize: positiveNumber(plain.householdSize, DEFAULT_PROFILE.householdSize),
    officialFloorDays: positiveNumber(plain.officialFloorDays, DEFAULT_PROFILE.officialFloorDays),
    longTermTargetDays: positiveNumber(plain.longTermTargetDays, DEFAULT_PROFILE.longTermTargetDays),
    longTermGoalDate: validDate(plain.longTermGoalDate) || DEFAULT_PROFILE.longTermGoalDate,
    mealsPerPersonDay: positiveNumber(plain.mealsPerPersonDay, DEFAULT_PROFILE.mealsPerPersonDay),
    waterLitresPerPersonDay: positiveNumber(plain.waterLitresPerPersonDay, DEFAULT_PROFILE.waterLitresPerPersonDay),
    toiletUsesPerPersonDay: positiveNumber(plain.toiletUsesPerPersonDay, DEFAULT_PROFILE.toiletUsesPerPersonDay),
    timeZone: plain.timeZone || DEFAULT_TIME_ZONE,
    milestones,
    recommendationReviewedAt: validDate(plain.recommendationReviewedAt) || DEFAULT_PROFILE.recommendationReviewedAt,
    recommendationNextReviewAt: validDate(plain.recommendationNextReviewAt) || DEFAULT_PROFILE.recommendationNextReviewAt,
    recommendationSource: plain.recommendationSource?.url
      ? plain.recommendationSource
      : DEFAULT_PROFILE.recommendationSource,
  };
}

function getCurrentMilestone(profileInput = {}, now = new Date()) {
  const profile = normalizeProfile(profileInput);
  const todayKey = dateKeyInTimeZone(now, profile.timeZone);
  const upcoming = profile.milestones.find(entry => dateOnlyKey(entry.deadline) >= todayKey);
  const selected = upcoming || profile.milestones[profile.milestones.length - 1] || {
    deadline: profile.longTermGoalDate,
    targetDays: profile.longTermTargetDays,
  };
  return {
    deadline: selected.deadline,
    deadlineKey: dateOnlyKey(selected.deadline),
    targetDays: selected.targetDays,
    isLongTerm: selected.targetDays >= profile.longTermTargetDays,
  };
}

function contributionValues(rawInput = {}) {
  const raw = asPlain(rawInput);
  return Object.fromEntries(CONTRIBUTION_KEYS.map(key => [key, finiteNumber(raw[key])]));
}

function litresPerWaterUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase().replace(/[.\s_-]+/g, '');
  if (['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(normalized)) return 0.001;
  if (['cl', 'centiliter', 'centilitre'].includes(normalized)) return 0.01;
  if (['dl', 'deciliter', 'decilitre'].includes(normalized)) return 0.1;
  if (['l', 'liter', 'liters', 'litre', 'litres'].includes(normalized)) return 1;
  return null;
}

function normalizeContribution(category, guidance) {
  const contribution = contributionValues(category.contributionPerUnit || guidance.contributionPerUnit || {});
  const explicitContribution = contributionValues(category.contributionPerUnit || {});

  const name = String(category.name || '');
  const unit = String(category.unit || '').toLowerCase();
  if (/dry rice|uncooked rice|^rice$/i.test(name) && contribution.stapleServings <= 0) {
    if (/kg|kilogram/.test(unit)) contribution.stapleServings = 1000 / 75;
    if (/gram|^g$/.test(unit)) contribution.stapleServings = 1 / 75;
  }

  if (guidance.preparednessDomain === 'water' && explicitContribution.domainUnits <= 0) {
    contribution.domainUnits = litresPerWaterUnit(category.unit) || 1;
  }
  if (guidance.preparednessDomain === 'toilet' && contribution.domainUnits <= 0) {
    contribution.domainUnits = 1;
  }
  if (guidance.preparednessDomain === 'critical-medication' && contribution.domainUnits <= 0) {
    contribution.domainUnits = 1;
  }
  return contribution;
}

function normalizeCategory(categoryInput) {
  const category = asPlain(categoryInput);
  const guidance = getCategoryGuidance(category);
  const explicitApplicability = ['applicable', 'not-applicable', 'undecided'].includes(category.applicabilityStatus)
    ? category.applicabilityStatus
    : null;
  const applicabilityStatus = explicitApplicability || (
    category.applicable === false
      ? 'not-applicable'
      : (guidance.conditional ? 'undecided' : 'applicable')
  );
  const officialBaseline = finiteNumber(category.officialBaseline, finiteNumber(guidance.officialBaseline, finiteNumber(category.recommendedStock)));
  const personalTarget = finiteNumber(category.personalTarget, finiteNumber(guidance.personalTarget));
  const emergencyFloor = finiteNumber(category.emergencyFloor, officialBaseline);
  const normalConsumptionRate = finiteNumber(category.normalConsumptionRate);
  const consumptionPeriodDays = positiveNumber(category.consumptionPeriodDays, 30);
  const shoppingLeadDays = finiteNumber(category.shoppingLeadDays, 7);
  const calculatedReorderPoint = emergencyFloor +
    (normalConsumptionRate * shoppingLeadDays / consumptionPeriodDays);
  return {
    ...category,
    id: String(category._id || category.id || ''),
    ...guidance,
    applicabilityStatus,
    applicable: applicabilityStatus === 'applicable',
    needsApplicabilityDecision: applicabilityStatus === 'undecided',
    managementMode: guidance.managementMode,
    preparednessDomain: guidance.preparednessDomain,
    targetStrategy: guidance.targetStrategy,
    targetManagedAtDomain: POOLED_DOMAINS.includes(guidance.preparednessDomain),
    contributionPerUnit: normalizeContribution(category, guidance),
    recommendedStock: finiteNumber(category.recommendedStock),
    officialBaseline,
    personalTarget,
    emergencyFloor,
    normalConsumptionRate,
    consumptionPeriodDays,
    shoppingLeadDays,
    reorderPoint: finiteNumber(category.reorderPoint, calculatedReorderPoint),
    restockToAmount: finiteNumber(
      category.restockToAmount,
      personalTarget > 0 ? personalTarget : finiteNumber(category.recommendedStock),
    ),
    packageSize: finiteNumber(category.packageSize),
    inspectionIntervalMonths: positiveNumber(category.inspectionIntervalMonths, 6),
  };
}

function categoryTarget(category, profile, milestone) {
  const explicitMilestones = Array.isArray(category.milestones)
    ? category.milestones
      .map(entry => ({ deadline: validDate(entry.deadline), target: finiteNumber(entry.target) }))
      .filter(entry => entry.deadline && entry.target >= 0)
      .sort((a, b) => a.deadline - b.deadline)
    : [];
  const milestoneTarget = explicitMilestones.find(entry => dateOnlyKey(entry.deadline) >= milestone.deadlineKey) ||
    explicitMilestones[explicitMilestones.length - 1];
  if (milestoneTarget) return milestoneTarget.target;

  if (category.managementMode === 'durable') {
    return category.personalTarget || category.officialBaseline || category.recommendedStock || 1;
  }
  if (category.targetStrategy === 'fixed') {
    return category.personalTarget || category.officialBaseline || category.recommendedStock || 0;
  }
  const baseline = category.officialBaseline || category.recommendedStock;
  if (baseline <= 0) return category.personalTarget || 0;
  const scaled = baseline * milestone.targetDays / profile.officialFloorDays;
  if (category.personalTarget > 0 && milestone.targetDays >= profile.longTermTargetDays) {
    return category.personalTarget;
  }
  return scaled;
}

function normalizeItem(itemInput) {
  const item = asPlain(itemInput);
  return {
    ...item,
    id: String(item._id || item.id || ''),
    categoryId: String(item.categoryId || ''),
    amount: Math.max(0, finiteNumber(item.amount)),
    status: item.status || 'active',
    expiresAt: validDate(item.expiresAt),
    inspectionDueAt: validDate(item.inspectionDueAt),
    rotateDate: validDate(item.rotateDate),
    lastVerifiedAt: validDate(item.lastVerifiedAt),
    resolvedAt: validDate(item.resolvedAt),
  };
}

function expiryDateFor(item, category) {
  if (category.managementMode === 'durable') return null;
  return item.expiresAt || item.rotateDate || null;
}

function inspectionDateFor(item, category) {
  if (category.managementMode !== 'durable') return null;
  return item.inspectionDueAt || item.rotateDate || null;
}

function classifyItem(item, category, todayKey) {
  if (item.status !== 'active' || item.amount <= 0) {
    return { counted: false, state: 'resolved', daysUntilAction: null };
  }

  if (category.managementMode === 'durable') {
    const due = inspectionDateFor(item, category);
    const dueKey = dateOnlyKey(due);
    const daysUntilAction = dueKey ? calendarDaysBetween(todayKey, dueKey) : null;
    if (!item.lastVerifiedAt) return { counted: true, state: 'inspection-unverified', daysUntilAction };
    if (!due) return { counted: true, state: 'inspection-due', daysUntilAction: null };
    if (daysUntilAction < 0) return { counted: true, state: 'inspection-due', daysUntilAction };
    if (daysUntilAction <= EXPIRY_WARNING_DAYS) return { counted: true, state: 'inspection-soon', daysUntilAction };
    return { counted: true, state: 'verified', daysUntilAction };
  }

  const expiry = expiryDateFor(item, category);
  const expiryKey = dateOnlyKey(expiry);
  if (!expiryKey) {
    return {
      counted: true,
      state: category.managementMode === 'expiry-managed' ? 'expiry-unrecorded' : 'current',
      daysUntilAction: null,
    };
  }
  const daysUntilAction = calendarDaysBetween(todayKey, expiryKey);
  if (daysUntilAction < 0) return { counted: false, state: 'expired', daysUntilAction };
  if (daysUntilAction <= EXPIRY_STRONG_WARNING_DAYS) return { counted: true, state: 'expiry-strong', daysUntilAction };
  if (daysUntilAction <= EXPIRY_WARNING_DAYS) return { counted: true, state: 'expiry-soon', daysUntilAction };
  return { counted: true, state: 'current', daysUntilAction };
}

function rollingHealth(category, stock) {
  if (stock < category.emergencyFloor) return 'below-floor';
  if (stock <= category.reorderPoint) return 'reorder-soon';
  return 'healthy';
}

function durableItemReady(itemState) {
  return itemState.state === 'verified' || itemState.state === 'inspection-soon';
}

function coverageStatus(days, floorDays, milestoneDays) {
  if (!Number.isFinite(days)) return 'not-measurable';
  if (days >= milestoneDays) return 'milestone-met';
  if (days >= floorDays) return 'floor-met';
  if (days >= Math.max(0, floorDays - 0.25)) return 'nearly-floor';
  return 'below-floor';
}

function createDomain(id, label, unit, targetAmount) {
  return {
    id,
    label,
    unit,
    applicable: false,
    measurable: false,
    currentAmount: 0,
    targetAmount,
    gap: targetAmount,
    days: null,
    status: 'not-measurable',
    details: {},
  };
}

function buildEmergencyStockSnapshot({ categories = [], items = [], profile: profileInput = {}, now = new Date() } = {}) {
  const profile = normalizeProfile(profileInput);
  const milestone = getCurrentMilestone(profile, now);
  const todayKey = dateKeyInTimeZone(now, profile.timeZone);
  const normalizedCategories = categories.map(normalizeCategory);
  const categoryMap = new Map(normalizedCategories.map(category => [category.id, category]));
  const normalizedItems = items.map(normalizeItem);

  const summaries = normalizedCategories.map(category => ({
    ...category,
    stock: 0,
    activeItemCount: 0,
    target: categoryTarget(category, profile, milestone),
    readyItemCount: 0,
    items: [],
    warnings: [],
    health: category.applicable
      ? 'healthy'
      : (category.needsApplicabilityDecision ? 'applicability-undecided' : 'not-applicable'),
  }));
  const summaryMap = new Map(summaries.map(summary => [summary.id, summary]));
  const orphanItems = [];
  const rotationItems = [];

  normalizedItems.forEach(item => {
    const category = categoryMap.get(item.categoryId);
    const summary = summaryMap.get(item.categoryId);
    if (!category || !summary) {
      orphanItems.push(item);
      return;
    }
    const classification = classifyItem(item, category, todayKey);
    const presented = { ...item, ...classification };
    summary.items.push(presented);
    if (item.status === 'active') summary.activeItemCount += 1;
    if (classification.counted) summary.stock += item.amount;
    if (category.managementMode === 'durable' && durableItemReady(classification)) {
      summary.readyItemCount += item.amount;
    }
    if (!['current', 'verified', 'resolved'].includes(classification.state)) {
      summary.warnings.push(presented);
      if (classification.state !== 'inspection-unverified' || item.status === 'active') {
        rotationItems.push({ ...presented, category });
      }
    }
  });

  summaries.forEach(summary => {
    summary.stock = round(summary.stock, 2);
    summary.target = round(summary.target, 2);
    if (!summary.applicable) {
      summary.health = summary.needsApplicabilityDecision ? 'applicability-undecided' : 'not-applicable';
      summary.percent = null;
      summary.ready = null;
      return;
    }
    if (summary.preparednessDomain === 'food') {
      summary.health = summary.stock > 0 ? 'contributing' : 'empty';
    } else if (summary.managementMode === 'rolling') {
      summary.health = rollingHealth(summary, summary.stock);
    } else if (summary.managementMode === 'durable') {
      if (summary.readyItemCount >= summary.target && summary.target > 0) summary.health = 'verified';
      else if (summary.activeItemCount > 0) summary.health = 'inspection-due';
      else summary.health = 'missing';
    } else if (summary.stock < summary.target) {
      summary.health = 'below-target';
    } else {
      summary.health = 'healthy';
    }
    const readinessAmount = summary.managementMode === 'durable' ? summary.readyItemCount : summary.stock;
    if (summary.targetManagedAtDomain) {
      summary.percent = null;
      summary.ready = null;
    } else {
      summary.percent = summary.target > 0 ? Math.min(100, round(100 * readinessAmount / summary.target, 0)) : 100;
      summary.ready = readinessAmount >= summary.target;
    }
    summary.items.sort((a, b) => {
      const firstDate = expiryDateFor(a, summary) || inspectionDateFor(a, summary);
      const secondDate = expiryDateFor(b, summary) || inspectionDateFor(b, summary);
      if (!firstDate && !secondDate) return 0;
      if (!firstDate) return 1;
      if (!secondDate) return -1;
      return firstDate - secondDate;
    });
  });

  const waterTarget = profile.householdSize * profile.waterLitresPerPersonDay * milestone.targetDays;
  const foodTarget = profile.householdSize * profile.mealsPerPersonDay * milestone.targetDays;
  const toiletTarget = profile.householdSize * profile.toiletUsesPerPersonDay * milestone.targetDays;
  const domains = {
    water: createDomain('water', 'Water', 'L', waterTarget),
    food: createDomain('food', 'Food', 'person-meals', foodTarget),
    toilet: createDomain('toilet', 'Portable toilets', 'uses', toiletTarget),
    criticalMedication: createDomain('critical-medication', 'Critical medication', 'days', milestone.targetDays),
  };
  const foodTotals = {
    completeMeals: 0,
    stapleServings: 0,
    mainDishServings: 0,
    produceServings: 0,
    noCookMeals: 0,
    waterLitresRequired: 0,
    fuelMealsRequired: 0,
  };
  const unclassifiedFoodItems = [];
  const medicationCoverage = [];

  summaries.filter(summary => summary.applicable).forEach(summary => {
    const contribution = summary.contributionPerUnit;
    if (summary.preparednessDomain === 'water') {
      domains.water.applicable = true;
      domains.water.measurable = contribution.domainUnits > 0;
      domains.water.currentAmount += summary.stock * contribution.domainUnits;
    } else if (summary.preparednessDomain === 'toilet') {
      domains.toilet.applicable = true;
      domains.toilet.measurable = contribution.domainUnits > 0;
      domains.toilet.currentAmount += summary.stock * contribution.domainUnits;
    } else if (summary.preparednessDomain === 'food') {
      domains.food.applicable = true;
      summary.items.filter(item => item.counted).forEach(item => {
        const itemContribution = item.contributionOverride
          ? contributionValues(item.contributionOverride)
          : contribution;
        const hasContribution = Object.values(itemContribution).some(value => value > 0);
        if (hasContribution) domains.food.measurable = true;
        const hasFoodClassification = FOOD_CLASSIFICATION_KEYS
          .some(key => itemContribution[key] > 0);
        if (!hasFoodClassification) {
          unclassifiedFoodItems.push({
            ...item,
            categoryName: summary.name,
            categoryUnit: summary.unit,
            possibleMeals: round(item.amount, 2),
          });
        }
        Object.keys(foodTotals).forEach(key => {
          foodTotals[key] += item.amount * itemContribution[key];
        });
      });
    } else if (summary.preparednessDomain === 'critical-medication') {
      domains.criticalMedication.applicable = true;
      const dailyRate = positiveNumber(summary.unitsPerPersonDay);
      const dependentCount = positiveNumber(summary.dependentCount, 1);
      const doses = summary.stock * positiveNumber(contribution.domainUnits, 1);
      medicationCoverage.push({
        categoryId: summary.id,
        label: summary.name,
        days: dailyRate > 0 ? doses / (dailyRate * dependentCount) : null,
      });
    }
  });

  domains.water.currentAmount = round(domains.water.currentAmount, 2);
  domains.water.days = domains.water.measurable
    ? domains.water.currentAmount / (profile.householdSize * profile.waterLitresPerPersonDay)
    : null;
  domains.toilet.currentAmount = round(domains.toilet.currentAmount, 2);
  domains.toilet.days = domains.toilet.measurable
    ? domains.toilet.currentAmount / (profile.householdSize * profile.toiletUsesPerPersonDay)
    : null;

  Object.keys(foodTotals).forEach(key => {
    foodTotals[key] = round(foodTotals[key], 2);
  });
  foodTotals.pairedMeals = round(Math.min(foodTotals.stapleServings, foodTotals.mainDishServings), 2);
  foodTotals.mealCapacity = round(foodTotals.completeMeals + foodTotals.pairedMeals, 2);
  domains.food.currentAmount = foodTotals.mealCapacity;
  domains.food.days = domains.food.measurable
    ? foodTotals.mealCapacity / (profile.householdSize * profile.mealsPerPersonDay)
    : null;
  domains.food.details = foodTotals;

  domains.criticalMedication.measurable = domains.criticalMedication.applicable &&
    medicationCoverage.length > 0 && medicationCoverage.every(entry => Number.isFinite(entry.days));
  domains.criticalMedication.days = domains.criticalMedication.measurable
    ? Math.min(...medicationCoverage.map(entry => entry.days))
    : null;
  domains.criticalMedication.currentAmount = round(domains.criticalMedication.days, 1) || 0;
  domains.criticalMedication.details = { medicines: medicationCoverage };

  Object.values(domains).forEach(domain => {
    domain.days = round(domain.days, 1);
    domain.currentAmount = round(domain.currentAmount, 1);
    domain.targetAmount = round(domain.targetAmount, 1);
    domain.gap = round(Math.max(0, domain.targetAmount - domain.currentAmount), 1);
    if (!domain.applicable && domain.id === 'critical-medication') {
      domain.status = 'not-applicable';
    } else {
      domain.status = coverageStatus(domain.days, profile.officialFloorDays, milestone.targetDays);
    }
  });

  const coreDomains = [domains.water, domains.food, domains.toilet];
  if (domains.criticalMedication.applicable) coreDomains.push(domains.criticalMedication);
  const coreMeasurable = coreDomains.every(domain => domain.measurable && Number.isFinite(domain.days));
  const coreDaysRaw = coreMeasurable ? Math.min(...coreDomains.map(domain => domain.days)) : null;
  const coreDays = round(coreDaysRaw, 1);

  const possibleUnclassifiedMeals = round(
    unclassifiedFoodItems.reduce((total, item) => total + item.possibleMeals, 0),
    1,
  );
  const possibleFoodDays = domains.food.measurable || possibleUnclassifiedMeals > 0
    ? round(
      (foodTotals.mealCapacity + possibleUnclassifiedMeals) /
        (profile.householdSize * profile.mealsPerPersonDay),
      1,
    )
    : null;
  const nonFoodCoreDomains = coreDomains.filter(domain => domain.id !== 'food');
  const nonFoodCoreMeasurable = nonFoodCoreDomains
    .every(domain => domain.measurable && Number.isFinite(domain.days));
  const possibleCoreDays = nonFoodCoreMeasurable && Number.isFinite(possibleFoodDays)
    ? round(Math.min(
      possibleFoodDays,
      ...nonFoodCoreDomains.map(domain => domain.days),
    ), 1)
    : null;

  const applicableSummaries = summaries.filter(summary => summary.applicable);
  const checklistSummaries = applicableSummaries.filter(summary => !summary.targetManagedAtDomain);
  const checklistReady = checklistSummaries.filter(summary => summary.ready).length;
  const checklistPercent = checklistSummaries.length
    ? round(100 * checklistReady / checklistSummaries.length, 0)
    : null;
  const rolling = summaries.filter(summary => summary.applicable && summary.managementMode === 'rolling');
  const durable = summaries.filter(summary => summary.applicable && summary.managementMode === 'durable');

  const capabilities = ['cooking-fuel', 'power'].map(domainId => {
    const matching = summaries.filter(summary => summary.applicable && summary.preparednessDomain === domainId);
    const categoryAvailable = summary => summary.managementMode === 'durable'
      ? summary.readyItemCount > 0
      : summary.stock > 0;
    let available = matching.some(categoryAvailable);
    let configured = matching.length > 0;
    if (domainId === 'cooking-fuel') {
      const equipment = matching.filter(summary => summary.managementMode === 'durable');
      const fuel = matching.filter(summary => summary.managementMode !== 'durable');
      configured = equipment.length > 0 && fuel.length > 0;
      available = equipment.some(categoryAvailable) && fuel.some(categoryAvailable);
    }
    return {
      id: domainId,
      label: domainId === 'cooking-fuel' ? 'Cooking fuel' : 'Backup power',
      status: !configured ? 'not-configured' : (available ? 'available' : 'attention'),
      categories: matching,
    };
  });

  const recommendationNextReviewKey = dateOnlyKey(profile.recommendationNextReviewAt);
  const sanityWarnings = Object.values(domains)
    .filter(domain => Number.isFinite(domain.days) && domain.days > SANITY_MAX_DOMAIN_DAYS)
    .map(domain => ({
      code: `implausible-${domain.id}-coverage`,
      domain: domain.id,
      value: domain.days,
      message: `${domain.label} calculates to ${round(domain.days, 1)} days. Check category units, item quantities, and per-unit contributions before relying on this result.`,
    }));
  const applicabilityDecisions = summaries.filter(summary => summary.needsApplicabilityDecision);
  return {
    generatedAt: now,
    todayKey,
    profile,
    milestone,
    categories: summaries,
    categoryMap: Object.fromEntries(summaries.map(summary => [summary.id, summary])),
    domains,
    core: {
      measurable: coreMeasurable,
      days: coreDays,
      limitingDomains: coreMeasurable
        ? coreDomains.filter(domain => domain.days === coreDays).map(domain => domain.id)
        : coreDomains.filter(domain => !domain.measurable).map(domain => domain.id),
      status: coverageStatus(coreDays, profile.officialFloorDays, milestone.targetDays),
    },
    checklist: {
      ready: checklistReady,
      applicable: checklistSummaries.length,
      percent: checklistPercent,
    },
    applicabilityReview: {
      due: applicabilityDecisions.length,
      categories: applicabilityDecisions,
    },
    unclassifiedFood: {
      items: unclassifiedFoodItems,
      count: unclassifiedFoodItems.length,
      possibleMeals: possibleUnclassifiedMeals,
      possibleFoodDays,
      possibleCoreDays,
      possibleCoreGain: Number.isFinite(possibleCoreDays) && Number.isFinite(coreDays)
        ? round(Math.max(0, possibleCoreDays - coreDays), 1)
        : null,
    },
    sanityWarnings,
    rollingHealth: {
      healthy: rolling.filter(category => category.health === 'healthy').length,
      reorderSoon: rolling.filter(category => category.health === 'reorder-soon').length,
      belowFloor: rolling.filter(category => category.health === 'below-floor').length,
    },
    rotationHealth: {
      dueSoon: rotationItems.filter(item => ['expiry-soon', 'expiry-strong'].includes(item.state)).length,
      expired: rotationItems.filter(item => item.state === 'expired').length,
      undated: rotationItems.filter(item => item.state === 'expiry-unrecorded').length,
    },
    durableHealth: {
      verified: durable.filter(category => category.health === 'verified').length,
      inspectionDue: durable.filter(category => category.health === 'inspection-due').length,
      missing: durable.filter(category => category.health === 'missing').length,
    },
    capabilities,
    rotationItems: rotationItems.sort((a, b) => {
      const first = a.daysUntilAction ?? Number.MAX_SAFE_INTEGER;
      const second = b.daysUntilAction ?? Number.MAX_SAFE_INTEGER;
      return first - second;
    }),
    orphanItems,
    monthlyReview: {
      due: summaries.filter(category => {
        if (!category.applicable) return false;
        const checkedKey = dateOnlyKey(category.lastStockCheck);
        return !checkedKey || calendarDaysBetween(checkedKey, todayKey) >= 30;
      }).length,
      total: applicableSummaries.length,
    },
    recommendationReview: {
      due: Boolean(recommendationNextReviewKey && recommendationNextReviewKey <= todayKey),
      nextReviewAt: profile.recommendationNextReviewAt,
      source: profile.recommendationSource,
    },
  };
}

function roundedPackageAmount(amount, packageSize) {
  const size = positiveNumber(packageSize);
  if (amount <= 0) return 0;
  return size > 0 ? Math.ceil(amount / size) * size : amount;
}

function requirementStatus(requirementsByFingerprint, fingerprint) {
  const status = requirementsByFingerprint.get(fingerprint)?.status;
  return status === 'resolved' || !status ? 'needed' : status;
}

function milestoneForecastDate(snapshot, now = new Date()) {
  const afterMilestone = addCalendarDays(
    snapshot.milestone.deadline,
    1,
    snapshot.profile.timeZone,
  );
  return dateKeyInTimeZone(afterMilestone, snapshot.profile.timeZone) < snapshot.todayKey
    ? now
    : afterMilestone;
}

function fixedMilestoneProfile(snapshot) {
  return {
    ...snapshot.profile,
    milestones: [{
      deadline: snapshot.milestone.deadline,
      targetDays: snapshot.milestone.targetDays,
    }],
  };
}

function earliestRotation(categories, cutoffKey, startKey = '') {
  let earliest = null;
  categories.forEach(category => {
    category.items.forEach(item => {
      if (item.status !== 'active' || item.amount <= 0) return;
      const expiry = expiryDateFor(item, category);
      const expiryKey = dateOnlyKey(expiry);
      if (!expiryKey || expiryKey > cutoffKey || (startKey && expiryKey < startKey)) return;
      if (!earliest || expiry < earliest.date) {
        earliest = {
          date: expiry,
          categoryId: category.id,
          shoppingLeadDays: category.shoppingLeadDays,
        };
      }
    });
  });
  return earliest;
}

function purchaseDueDate(actionDate, shoppingLeadDays, snapshot) {
  const action = validDate(actionDate);
  if (!action) return dateFromKey(snapshot.todayKey);
  const leadDays = Math.max(0, Math.ceil(finiteNumber(shoppingLeadDays, 7)));
  const planned = addCalendarDays(action, -leadDays, snapshot.profile.timeZone);
  return dateKeyInTimeZone(planned, snapshot.profile.timeZone) < snapshot.todayKey
    ? dateFromKey(snapshot.todayKey)
    : planned;
}

function foodPurchaseAdvice(domain) {
  const details = domain?.details || {};
  const pairedMealsNeeded = Math.max(0, finiteNumber(domain?.targetAmount) - finiteNumber(details.completeMeals));
  const stapleServings = finiteNumber(details.stapleServings);
  const mainDishServings = finiteNumber(details.mainDishServings);
  if (stapleServings >= pairedMealsNeeded && mainDishServings < pairedMealsNeeded) {
    return 'The staple pool already covers this milestone; prioritize main/protein servings or complete meals rather than more rice.';
  }
  if (mainDishServings >= pairedMealsNeeded && stapleServings < pairedMealsNeeded) {
    return 'The main/protein pool already covers this milestone; prioritize staple servings or complete meals.';
  }
  return 'Use complete meals, or add complementary staple and main/protein servings without double counting them.';
}

function pooledPackageSize(categories, domainId) {
  if (categories.length !== 1) return 0;
  const category = categories[0];
  const packageSize = positiveNumber(category.packageSize);
  if (!packageSize) return 0;
  if (['water', 'toilet'].includes(domainId)) {
    return packageSize * positiveNumber(category.contributionPerUnit?.domainUnits, 1);
  }
  if (domainId === 'food') {
    const contribution = contributionValues(category.contributionPerUnit);
    const onlyCompleteMeals = contribution.completeMeals > 0 &&
      contribution.stapleServings === 0 && contribution.mainDishServings === 0;
    return onlyCompleteMeals ? packageSize * contribution.completeMeals : 0;
  }
  return 0;
}

function buildShoppingRequirements({
  categories = [],
  items = [],
  profile = {},
  existingRequirements = [],
  now = new Date(),
} = {}) {
  const snapshot = buildEmergencyStockSnapshot({ categories, items, profile, now });
  const rotationForecastDate = milestoneForecastDate(snapshot, now);
  const rotationForecast = buildEmergencyStockSnapshot({
    categories,
    items,
    profile: fixedMilestoneProfile(snapshot),
    now: rotationForecastDate,
  });
  const existing = existingRequirements.map(asPlain);
  const requirementsByFingerprint = new Map(existing.map(item => [item.fingerprint, item]));
  const computed = [];

  snapshot.categories.forEach(category => {
    if (!category.applicable || category.managementMode === 'durable') return;
    // Duration domains are purchased as pools. This prevents water or food
    // appearing twice as both an isolated category quota and a domain gap.
    if (['water', 'food', 'toilet'].includes(category.preparednessDomain)) return;
    const forecastCategory = rotationForecast.categoryMap[category.id];
    const currentRollingNeed = ['below-floor', 'reorder-soon'].includes(category.health);
    const forecastRollingNeed = ['below-floor', 'reorder-soon'].includes(forecastCategory?.health);
    if (category.managementMode === 'rolling' && (currentRollingNeed || forecastRollingNeed)) {
      const target = Math.max(category.restockToAmount, category.target, category.emergencyFloor);
      const forecastStock = forecastRollingNeed && forecastCategory.stock < category.stock
        ? forecastCategory.stock
        : category.stock;
      const amount = roundedPackageAmount(Math.max(0, target - forecastStock), category.packageSize);
      if (amount > 0) {
        const fingerprint = `rolling:${category.id}`;
        const rotation = forecastRollingNeed && forecastCategory.stock < category.stock
          ? earliestRotation([category], snapshot.milestone.deadlineKey, snapshot.todayKey)
          : null;
        computed.push({
          fingerprint,
          categoryId: category.id,
          domain: category.preparednessDomain,
          label: category.name,
          unit: category.unit,
          requiredAmount: round(amount, 2),
          currentAmount: category.stock,
          forecastAmount: round(forecastStock, 2),
          targetAmount: round(target, 2),
          packageSize: category.packageSize || undefined,
          reason: !currentRollingNeed && rotation
            ? `Dated stock falls to ${round(forecastStock, 2)} ${category.unit} after rotations through ${snapshot.milestone.deadlineKey}. Replenish before the first rotation.`
            : category.health === 'below-floor'
            ? 'Current stock is below the protected emergency floor.'
            : 'Current stock has reached the reorder point.',
          trigger: !currentRollingNeed && rotation
            ? 'expiring-soon'
            : (category.health === 'below-floor' ? 'below-floor' : 'reorder-point'),
          dueDate: !currentRollingNeed && rotation
            ? purchaseDueDate(rotation.date, rotation.shoppingLeadDays, snapshot)
            : now,
          status: requirementStatus(requirementsByFingerprint, fingerprint),
        });
      }
    }
  });

  const domainDefinitions = [
    snapshot.domains.water,
    snapshot.domains.food,
    snapshot.domains.toilet,
  ];
  domainDefinitions.forEach(domain => {
    const forecastDomain = rotationForecast.domains[domain.id === 'critical-medication' ? 'criticalMedication' : domain.id];
    const forecastGap = forecastDomain?.measurable ? forecastDomain.gap : 0;
    const requiredGap = Math.max(domain.gap, forecastGap);
    if (!domain.measurable || requiredGap <= 0) return;
    const categoriesForDomain = snapshot.categories.filter(category =>
      category.applicable && category.preparednessDomain === domain.id);
    const packageSize = pooledPackageSize(categoriesForDomain, domain.id);
    const rotation = earliestRotation(categoriesForDomain, snapshot.milestone.deadlineKey, snapshot.todayKey);
    const domainShoppingLeadDays = Math.max(
      0,
      ...categoriesForDomain.map(category => finiteNumber(category.shoppingLeadDays, 7)),
    );
    const baseReason = forecastGap > domain.gap
      ? `Plan enough replacement stock to retain the ${snapshot.milestone.targetDays}-day milestone through upcoming rotations.`
      : `Close the gap to the ${snapshot.milestone.targetDays}-day milestone by ${snapshot.milestone.deadlineKey}.`;
    const fingerprint = `milestone:${domain.id}`;
    computed.push({
      fingerprint,
      domain: domain.id,
      label: `${domain.label} pool`,
      unit: domain.unit,
      requiredAmount: round(roundedPackageAmount(requiredGap, packageSize), 2),
      currentAmount: domain.currentAmount,
      forecastAmount: forecastDomain.currentAmount,
      targetAmount: domain.targetAmount,
      packageSize: packageSize || undefined,
      reason: domain.id === 'food'
        ? `${baseReason} ${foodPurchaseAdvice(forecastDomain)}`
        : baseReason,
      trigger: forecastGap > domain.gap ? 'expiring-soon' : 'milestone-gap',
      dueDate: purchaseDueDate(
        forecastGap > domain.gap && rotation ? rotation.date : snapshot.milestone.deadline,
        forecastGap > domain.gap && rotation ? rotation.shoppingLeadDays : domainShoppingLeadDays,
        snapshot,
      ),
      status: requirementStatus(requirementsByFingerprint, fingerprint),
    });
  });

  snapshot.categories.forEach(category => {
    if (!category.applicable || category.managementMode !== 'expiry-managed') return;
    if (['water', 'food', 'toilet'].includes(category.preparednessDomain)) return;
    const forecastCategory = rotationForecast.categoryMap[category.id];
    const effectiveStock = Math.min(category.stock, forecastCategory?.stock ?? category.stock);
    if (category.target <= 0 || effectiveStock >= category.target) return;
    const fingerprint = `reserve:${category.id}`;
    const amount = roundedPackageAmount(category.target - effectiveStock, category.packageSize);
    const upcomingRotation = effectiveStock < category.stock;
    const rotation = upcomingRotation
      ? earliestRotation([category], snapshot.milestone.deadlineKey, snapshot.todayKey)
      : null;
    computed.push({
      fingerprint,
      categoryId: category.id,
      domain: category.preparednessDomain,
      label: category.name,
      unit: category.unit,
      requiredAmount: round(amount, 2),
      currentAmount: category.stock,
      forecastAmount: round(effectiveStock, 2),
      targetAmount: category.target,
      packageSize: category.packageSize || undefined,
      reason: upcomingRotation
        ? `Plan enough replacement stock to retain the active ${snapshot.milestone.targetDays}-day milestone through upcoming rotations.`
        : `Bring this reserve up to the active ${snapshot.milestone.targetDays}-day milestone.`,
      trigger: upcomingRotation ? 'expiring-soon' : 'milestone-gap',
      dueDate: purchaseDueDate(
        upcomingRotation && rotation ? rotation.date : snapshot.milestone.deadline,
        upcomingRotation && rotation ? rotation.shoppingLeadDays : category.shoppingLeadDays,
        snapshot,
      ),
      status: requirementStatus(requirementsByFingerprint, fingerprint),
    });
  });

  existing.filter(requirement => requirement.trigger === 'manual' &&
    ['needed', 'planned'].includes(requirement.status) &&
    !computed.some(item => item.fingerprint === requirement.fingerprint))
    .forEach(requirement => computed.push(requirement));

  const deduplicated = new Map();
  computed.forEach(requirement => {
    const prior = deduplicated.get(requirement.fingerprint);
    if (!prior || requirement.requiredAmount > prior.requiredAmount) {
      deduplicated.set(requirement.fingerprint, requirement);
    }
  });
  return Array.from(deduplicated.values()).sort((a, b) => {
    if (a.status === 'planned' && b.status !== 'planned') return 1;
    if (b.status === 'planned' && a.status !== 'planned') return -1;
    const first = validDate(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
    const second = validDate(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
    return first - second;
  });
}

function buildThirtyDayForecast({ categories = [], items = [], profile = {}, now = new Date() } = {}) {
  const normalizedProfile = normalizeProfile(profile);
  const forecastDate = addCalendarDays(now, 30, normalizedProfile.timeZone);
  const forecast = buildEmergencyStockSnapshot({ categories, items, profile: normalizedProfile, now: forecastDate });
  return {
    date: forecastDate,
    dateKey: forecast.todayKey,
    core: forecast.core,
    domains: forecast.domains,
  };
}

function buildMilestoneForecast({ categories = [], items = [], profile = {}, now = new Date() } = {}) {
  const current = buildEmergencyStockSnapshot({ categories, items, profile, now });
  const forecastDate = milestoneForecastDate(current, now);
  const forecast = buildEmergencyStockSnapshot({
    categories,
    items,
    profile: fixedMilestoneProfile(current),
    now: forecastDate,
  });
  return {
    date: forecastDate,
    dateKey: forecast.todayKey,
    throughDate: current.milestone.deadline,
    throughDateKey: current.milestone.deadlineKey,
    core: forecast.core,
    domains: forecast.domains,
  };
}

function buildFiveDayMenuExercise(entries = [], profileInput = {}) {
  const profile = normalizeProfile(profileInput);
  const normalizedEntries = entries.map(entry => {
    const plain = asPlain(entry);
    return {
      ...plain,
      id: String(plain._id || plain.id || ''),
      day: finiteNumber(plain.day),
      servings: finiteNumber(plain.servings),
      waterLitresRequired: finiteNumber(plain.waterLitresRequired),
      noCook: Boolean(plain.noCook),
      requiresFuel: Boolean(plain.requiresFuel),
    };
  }).sort((a, b) => a.day - b.day || ['breakfast', 'lunch', 'dinner'].indexOf(a.meal) - ['breakfast', 'lunch', 'dinner'].indexOf(b.meal));
  const requiredServings = 5 * profile.householdSize * profile.mealsPerPersonDay;
  const plannedServings = normalizedEntries.reduce((total, entry) => total + entry.servings, 0);
  const noCookServings = normalizedEntries.filter(entry => entry.noCook)
    .reduce((total, entry) => total + entry.servings, 0);
  const fuelServings = normalizedEntries.filter(entry => entry.requiresFuel)
    .reduce((total, entry) => total + entry.servings, 0);
  const waterLitresRequired = normalizedEntries.reduce((total, entry) => total + entry.waterLitresRequired, 0);
  const missingMainDishServings = normalizedEntries.filter(entry => !String(entry.mainDishSource || '').trim())
    .reduce((total, entry) => total + entry.servings, 0);
  const missingStapleServings = normalizedEntries.filter(entry => !String(entry.stapleSource || '').trim())
    .reduce((total, entry) => total + entry.servings, 0);
  const usedSlots = new Set(normalizedEntries.map(entry => `${entry.day}:${entry.meal}`));
  const missingSlots = [];
  for (let day = 1; day <= 5; day += 1) {
    ['breakfast', 'lunch', 'dinner'].forEach(meal => {
      if (!usedSlots.has(`${day}:${meal}`)) missingSlots.push({ day, meal });
    });
  }
  return {
    entries: normalizedEntries,
    requiredServings,
    plannedServings: round(plannedServings, 1),
    gap: round(Math.max(0, requiredServings - plannedServings), 1),
    noCookServings: round(noCookServings, 1),
    fuelServings: round(fuelServings, 1),
    waterLitresRequired: round(waterLitresRequired, 1),
    missingMainDishServings: round(missingMainDishServings, 1),
    missingStapleServings: round(missingStapleServings, 1),
    missingSlots,
    complete: plannedServings >= requiredServings && missingSlots.length === 0 &&
      missingMainDishServings === 0 && missingStapleServings === 0,
  };
}

module.exports = {
  DEFAULT_MILESTONES,
  DEFAULT_PROFILE,
  EXPIRY_STRONG_WARNING_DAYS,
  EXPIRY_WARNING_DAYS,
  addCalendarDays,
  buildEmergencyStockSnapshot,
  buildFiveDayMenuExercise,
  buildMilestoneForecast,
  buildShoppingRequirements,
  buildThirtyDayForecast,
  calendarDaysBetween,
  categoryTarget,
  dateKeyInTimeZone,
  getCurrentMilestone,
  normalizeCategory,
  normalizeProfile,
  roundedPackageAmount,
};
