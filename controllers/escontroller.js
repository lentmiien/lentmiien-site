'use strict';

const mongoose = require('mongoose');
const {
  ESCategory,
  ESItem,
  ESProfile,
  ESShoppingRequirement,
  ESMenuEntry,
  ESUnitConversion,
} = require('../database');
const logger = require('../utils/logger');
const { parseOptionalDateOnly } = require('../utils/dateOnly');
const {
  buildEmergencyStockSnapshot,
  buildFiveDayMenuExercise,
  buildMilestoneForecast,
  buildShoppingRequirements,
  normalizeCategory,
} = require('../services/emergencyStockService');
const { syncShoppingRequirements } = require('../services/emergencyStockMaintenanceService');
const {
  convertCategoryUnit,
  unitKey,
} = require('../services/emergencyStockUnitService');

function optionalNumber(value, fieldName, { min = 0, integer = false } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || (integer && !Number.isInteger(number))) {
    const error = new RangeError(`${fieldName} must be ${integer ? 'a whole number' : 'a number'} of at least ${min}.`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function requiredText(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) {
    const error = new RangeError(`${fieldName} is required.`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function assertUnitConversionUnlocked(category) {
  if (category?.unitConversionLock?.operationId) {
    const error = new Error('This category is locked by an unfinished unit conversion. Recover that conversion before changing its stock.');
    error.statusCode = 409;
    throw error;
  }
}

function optionalDate(value, fieldName) {
  try {
    return parseOptionalDateOnly(value);
  } catch (error) {
    error.message = `${fieldName}: ${error.message}`;
    error.statusCode = 400;
    throw error;
  }
}

function splitExamples(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function optionalHttpUrl(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.toString();
  } catch (_error) {
    const error = new RangeError(`${fieldName} must be an HTTP or HTTPS URL.`);
    error.statusCode = 400;
    throw error;
  }
}

function addUtcMonths(date, months) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

async function loadEmergencyStockData(now = new Date()) {
  const [categories, items, profile, persistedRequirements, menuEntries] = await Promise.all([
    ESCategory.find({}).sort({ name: 1 }).lean(),
    ESItem.find({}).lean(),
    ESProfile.findOne({ key: 'household' }).lean(),
    ESShoppingRequirement.find({ status: { $in: ['needed', 'planned', 'purchased'] } }).lean(),
    ESMenuEntry.find({}).sort({ day: 1, meal: 1 }).lean(),
  ]);
  const snapshot = buildEmergencyStockSnapshot({ categories, items, profile: profile || {}, now });
  const forecast = buildMilestoneForecast({ categories, items, profile: profile || {}, now });
  const calculatedRequirements = buildShoppingRequirements({
    categories,
    items,
    profile: profile || {},
    existingRequirements: persistedRequirements,
    now,
  });
  const requirementIds = new Map(persistedRequirements.map(requirement => [
    requirement.fingerprint,
    requirement._id?.toString(),
  ]));
  const shoppingRequirements = calculatedRequirements.map(requirement => ({
    ...requirement,
    recordId: requirementIds.get(requirement.fingerprint) || null,
  }));
  const menuExercise = buildFiveDayMenuExercise(menuEntries, profile || {});
  return {
    categories,
    items,
    profile,
    persistedRequirements,
    snapshot,
    forecast,
    shoppingRequirements,
    menuExercise,
  };
}

async function refreshShoppingRequirements(now = new Date()) {
  try {
    const [categories, items, profile, existingRequirements] = await Promise.all([
      ESCategory.find({}).lean(),
      ESItem.find({}).lean(),
      ESProfile.findOne({ key: 'household' }).lean(),
      ESShoppingRequirement.find({ status: { $in: ['needed', 'planned', 'purchased', 'resolved'] } }).lean(),
    ]);
    await syncShoppingRequirements({
      RequirementModel: ESShoppingRequirement,
      categories,
      items,
      profile: profile || {},
      existingRequirements,
      now,
    });
  } catch (error) {
    await logger.warning('Emergency stock changed but shopping requirements could not be refreshed', {
      category: 'emergency-stock',
      metadata: { error: error.message },
    });
  }
}

function handleControllerError(res, error, operation) {
  const status = error.statusCode || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500);
  const logMethod = status >= 500 ? 'error' : 'warning';
  logger[logMethod](`Emergency stock ${operation} failed`, {
    category: 'emergency-stock',
    metadata: { error: error.message },
  });
  return res.status(status).send(status === 500 ? 'Unable to update Emergency Stock.' : error.message);
}

exports.es_dashboard = async (_req, res) => {
  try {
    const data = await loadEmergencyStockData();
    res.render('es_dashboard', data);
  } catch (error) {
    logger.error('Emergency stock dashboard failed to load', {
      category: 'emergency-stock',
      metadata: { error: error.message },
    });
    res.status(500).send('Unable to load Emergency Stock.');
  }
};

exports.es_view_stock = async (_req, res) => {
  try {
    const data = await loadEmergencyStockData();
    res.render('es_view_stock', data);
  } catch (error) {
    logger.error('Emergency stock inventory failed to load', {
      category: 'emergency-stock',
      metadata: { error: error.message },
    });
    res.status(500).send('Unable to load Emergency Stock inventory.');
  }
};

exports.edit_category = async (req, res) => {
  try {
    const body = req.body || {};
    const name = requiredText(body.name, 'Category name');
    const unit = requiredText(body.unit, 'Unit');
    const managementMode = requiredText(body.managementMode, 'Management mode');
    if (!['rolling', 'expiry-managed', 'durable'].includes(managementMode)) {
      const error = new RangeError('Choose a valid management mode.');
      error.statusCode = 400;
      throw error;
    }

    const preparednessDomain = body.preparednessDomain || 'other';
    const validDomains = ['water', 'food', 'toilet', 'critical-medication', 'cooking-fuel', 'power', 'other'];
    if (!validDomains.includes(preparednessDomain)) {
      const error = new RangeError('Choose a valid preparedness domain.');
      error.statusCode = 400;
      throw error;
    }
    const conditional = body.conditional === 'on' || body.conditional === 'true';
    const applicabilityStatus = body.applicabilityStatus || (
      conditional ? 'undecided' : 'applicable'
    );
    if (!['applicable', 'not-applicable', 'undecided'].includes(applicabilityStatus)) {
      const error = new RangeError('Choose applicable, not applicable, or needs a decision.');
      error.statusCode = 400;
      throw error;
    }
    const targetStrategy = body.targetStrategy || 'duration-scaled';
    if (!['duration-scaled', 'fixed'].includes(targetStrategy)) {
      const error = new RangeError('Choose a duration-scaled or fixed target.');
      error.statusCode = 400;
      throw error;
    }

    if (body.category_id) {
      const existingCategory = await ESCategory.findById(body.category_id).lean();
      if (!existingCategory) {
        const error = new Error('Category not found.');
        error.statusCode = 404;
        throw error;
      }
      assertUnitConversionUnlocked(existingCategory);
      if (unitKey(existingCategory.unit) !== unitKey(unit)) {
        const error = new RangeError('Use the guarded unit-conversion form to change an existing category unit.');
        error.statusCode = 400;
        throw error;
      }
    }

    const contributionPerUnit = {
      domainUnits: optionalNumber(body.domainUnits, 'Domain units per inventory unit') || 0,
      completeMeals: optionalNumber(body.completeMeals, 'Complete meals per unit') || 0,
      stapleServings: optionalNumber(body.stapleServings, 'Staple servings per unit') || 0,
      mainDishServings: optionalNumber(body.mainDishServings, 'Main-dish servings per unit') || 0,
      produceServings: optionalNumber(body.produceServings, 'Produce servings per unit') || 0,
      supplementalServings: optionalNumber(body.supplementalServings, 'Supplemental servings per unit') || 0,
      noCookMeals: optionalNumber(body.noCookMeals, 'No-cook meals per unit') || 0,
      waterLitresRequired: optionalNumber(body.waterLitresRequired, 'Preparation water per unit') || 0,
      fuelMealsRequired: optionalNumber(body.fuelMealsRequired, 'Fuel-requiring meals per unit') || 0,
    };

    const update = {
      name,
      unit,
      managementMode,
      preparednessDomain,
      applicable: applicabilityStatus === 'applicable',
      applicabilityStatus,
      conditional,
      targetStrategy,
      recommendedStock: optionalNumber(body.recommendedStock, 'Legacy recommended stock') || 0,
      rotationPeriodMonths: optionalNumber(body.rotationPeriodMonths, 'Rotation period', { min: 1, integer: true }) || 12,
      officialBaseline: optionalNumber(body.officialBaseline, 'Official baseline'),
      personalTarget: optionalNumber(body.personalTarget, 'Personal target'),
      goalDate: optionalDate(body.goalDate, 'Goal date'),
      emergencyFloor: optionalNumber(body.emergencyFloor, 'Emergency floor'),
      reorderPoint: optionalNumber(body.reorderPoint, 'Reorder point'),
      restockToAmount: optionalNumber(body.restockToAmount, 'Restock-to amount'),
      normalConsumptionRate: optionalNumber(body.normalConsumptionRate, 'Consumption rate'),
      consumptionPeriodDays: optionalNumber(body.consumptionPeriodDays, 'Consumption period', { min: 1, integer: true }) || 30,
      shoppingLeadDays: optionalNumber(body.shoppingLeadDays, 'Days until the next shopping opportunity', { min: 0 }),
      packageSize: optionalNumber(body.packageSize, 'Package size'),
      unitsPerPersonDay: optionalNumber(body.unitsPerPersonDay, 'Units per person per day'),
      dependentCount: optionalNumber(body.dependentCount, 'Applicable household members'),
      inspectionIntervalMonths: optionalNumber(body.inspectionIntervalMonths, 'Inspection interval', { min: 1, integer: true }) || 6,
      purpose: String(body.purpose || '').trim() || undefined,
      whyItMatters: String(body.whyItMatters || '').trim() || undefined,
      qualifies: String(body.qualifies || '').trim() || undefined,
      doesNotQualify: String(body.doesNotQualify || '').trim() || undefined,
      calculationRule: String(body.calculationRule || '').trim() || undefined,
      examples: splitExamples(body.examples),
      householdNote: String(body.householdNote || '').trim() || undefined,
      contributionPerUnit,
      source: {
        label: String(body.sourceLabel || '').trim() || undefined,
        url: optionalHttpUrl(body.sourceUrl, 'Official source URL'),
        sourceDate: optionalDate(body.sourceDate, 'Source date'),
        lastReviewedAt: optionalDate(body.sourceLastReviewedAt, 'Source review date'),
      },
      recommendationReviewedAt: optionalDate(body.recommendationReviewedAt, 'Recommendation review date'),
    };

    let category;
    if (body.category_id) {
      category = await ESCategory.findByIdAndUpdate(body.category_id, update, {
        new: true,
        runValidators: true,
      });
      if (!category) {
        const error = new Error('Category not found.');
        error.statusCode = 404;
        throw error;
      }
    } else {
      category = await ESCategory.create(update);
    }
    await refreshShoppingRequirements();
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'category update');
  }
};

exports.add_item = async (req, res) => {
  try {
    const body = req.body || {};
    const categoryId = requiredText(body.add_category_id, 'Category');
    const amount = optionalNumber(body.amount, 'Amount', { min: Number.EPSILON });
    if (!amount) {
      const error = new RangeError('Amount must be greater than zero.');
      error.statusCode = 400;
      throw error;
    }
    const categoryDocument = await ESCategory.findById(categoryId).lean();
    if (!categoryDocument) {
      const error = new Error('Category not found.');
      error.statusCode = 404;
      throw error;
    }
    assertUnitConversionUnlocked(categoryDocument);
    const category = normalizeCategory(categoryDocument);
    const actionDate = optionalDate(body.actionDate || body.rotateDate, 'Expiry or inspection date');
    if (category.managementMode === 'expiry-managed' && !actionDate) {
      const error = new RangeError('An expiry or rotation date is required for expiry-managed reserve stock.');
      error.statusCode = 400;
      throw error;
    }

    const now = new Date();
    const itemData = {
      categoryId,
      amount,
      label: String(body.label || '').trim() || undefined,
      opened: body.opened === 'on' || body.opened === 'true',
      packageSize: optionalNumber(body.itemPackageSize, 'Item package size'),
      notes: String(body.notes || '').trim() || undefined,
      quantityUpdatedAt: now,
      status: 'active',
    };
    const foodContributionType = String(body.foodContributionType || 'category').trim();
    if (foodContributionType !== 'category') {
      if (category.preparednessDomain !== 'food') {
        const error = new RangeError('Food contribution overrides can only be added to food-domain inventory.');
        error.statusCode = 400;
        throw error;
      }
      const contributionFields = {
        complete: 'completeMeals',
        staple: 'stapleServings',
        main: 'mainDishServings',
        produce: 'produceServings',
        supplemental: 'supplementalServings',
      };
      const contributionField = contributionFields[foodContributionType];
      if (!contributionField) {
        const error = new RangeError('Choose a valid food contribution type.');
        error.statusCode = 400;
        throw error;
      }
      const servingsPerUnit = optionalNumber(body.foodServingsPerUnit, 'Food servings per inventory unit', { min: 0.01 });
      if (!servingsPerUnit) {
        const error = new RangeError('Food servings per inventory unit must be greater than zero.');
        error.statusCode = 400;
        throw error;
      }
      itemData.contributionOverride = {
        [contributionField]: servingsPerUnit,
        noCookMeals: body.foodNoCook === 'on' || body.foodNoCook === 'true' ? servingsPerUnit : 0,
        waterLitresRequired: optionalNumber(body.foodWaterLitresRequired, 'Preparation water per inventory unit') || 0,
        fuelMealsRequired: body.foodRequiresFuel === 'on' || body.foodRequiresFuel === 'true' ? servingsPerUnit : 0,
      };
      itemData.foodRole = foodContributionType;
    }
    if (category.managementMode === 'durable') {
      itemData.inspectionDueAt = actionDate || addUtcMonths(now, category.inspectionIntervalMonths);
      if (body.verified === 'on' || body.verified === 'true') itemData.lastVerifiedAt = now;
    } else if (actionDate) {
      itemData.expiresAt = actionDate;
    }
    await ESItem.create(itemData);
    await ESCategory.updateOne({ _id: categoryId }, { $set: { lastStockCheck: now } });
    await refreshShoppingRequirements(now);
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'item creation');
  }
};

exports.adjust_item = async (req, res) => {
  try {
    const itemId = requiredText(req.body?.item_id, 'Item');
    const delta = optionalNumber(req.body?.delta, 'Adjustment', { min: -100000 });
    if (!delta || Math.abs(delta) > 100000) {
      const error = new RangeError('Enter a non-zero stock adjustment.');
      error.statusCode = 400;
      throw error;
    }
    const item = await ESItem.findById(itemId);
    if (!item || (item.status && item.status !== 'active')) {
      const error = new Error('Active stock item not found.');
      error.statusCode = 404;
      throw error;
    }
    const categoryDocument = await ESCategory.findById(item.categoryId).lean();
    assertUnitConversionUnlocked(categoryDocument);
    const now = new Date();
    item.amount = Math.max(0, Number(item.amount || 0) + delta);
    item.quantityUpdatedAt = now;
    if (item.amount === 0) {
      item.status = 'consumed';
      item.resolvedAt = now;
    }
    await item.save();
    await ESCategory.updateOne({ _id: item.categoryId }, { $set: { lastStockCheck: now } });
    await refreshShoppingRequirements(now);
    res.redirect(req.body?.returnTo === 'inventory' ? '/es/es_view_stock' : '/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'quantity adjustment');
  }
};

exports.resolve_item = async (req, res) => {
  try {
    const itemId = requiredText(req.body?.item_id, 'Item');
    const resolution = requiredText(req.body?.resolution, 'Resolution');
    if (!['consumed', 'discarded', 'replaced'].includes(resolution)) {
      const error = new RangeError('Choose consumed, discarded, or replaced.');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date();
    const existingItem = await ESItem.findById(itemId).lean();
    if (!existingItem || (existingItem.status && existingItem.status !== 'active')) {
      const error = new Error('Active stock item not found.');
      error.statusCode = 404;
      throw error;
    }
    const categoryDocument = await ESCategory.findById(existingItem.categoryId).lean();
    assertUnitConversionUnlocked(categoryDocument);
    const item = await ESItem.findOneAndUpdate(
      { _id: itemId, status: { $in: ['active', null] } },
      {
        $set: {
          status: resolution,
          resolvedAt: now,
          resolutionNote: String(req.body?.resolutionNote || '').trim() || undefined,
        },
      },
      { new: true, runValidators: true },
    );
    if (!item) {
      const error = new Error('Active stock item not found.');
      error.statusCode = 404;
      throw error;
    }
    await refreshShoppingRequirements(now);
    res.redirect(req.body?.returnTo === 'inventory' ? '/es/es_view_stock' : '/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'item resolution');
  }
};

exports.inspect_item = async (req, res) => {
  try {
    const itemId = requiredText(req.body?.item_id, 'Item');
    const item = await ESItem.findById(itemId);
    if (!item) {
      const error = new Error('Equipment item not found.');
      error.statusCode = 404;
      throw error;
    }
    const categoryDocument = await ESCategory.findById(item.categoryId).lean();
    assertUnitConversionUnlocked(categoryDocument);
    const category = normalizeCategory(categoryDocument || {});
    if (category.managementMode !== 'durable') {
      const error = new RangeError('Only durable equipment can be inspected.');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date();
    item.lastVerifiedAt = now;
    item.inspectionDueAt = addUtcMonths(now, category.inspectionIntervalMonths);
    item.status = 'active';
    item.resolvedAt = undefined;
    await item.save();
    await refreshShoppingRequirements(now);
    res.redirect(req.body?.returnTo === 'inventory' ? '/es/es_view_stock' : '/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'equipment inspection');
  }
};

exports.review_stock = async (_req, res) => {
  try {
    const now = new Date();
    await ESCategory.updateMany({
      unitConversionLock: { $exists: false },
      $or: [
        { applicabilityStatus: 'applicable' },
        {
          applicabilityStatus: { $exists: false },
          conditional: { $ne: true },
          applicable: { $ne: false },
        },
        {
          applicabilityStatus: { $exists: false },
          conditional: true,
          applicable: true,
        },
      ],
    }, { $set: { lastStockCheck: now } });
    await refreshShoppingRequirements(now);
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'monthly stock review');
  }
};

exports.set_applicability = async (req, res) => {
  try {
    const categoryId = requiredText(req.body?.category_id, 'Category');
    const applicabilityStatus = requiredText(req.body?.applicabilityStatus, 'Applicability');
    if (!['applicable', 'not-applicable', 'undecided'].includes(applicabilityStatus)) {
      const error = new RangeError('Choose applicable, not applicable, or needs a decision.');
      error.statusCode = 400;
      throw error;
    }
    const existingCategory = await ESCategory.findById(categoryId).lean();
    if (!existingCategory) {
      const error = new Error('Category not found.');
      error.statusCode = 404;
      throw error;
    }
    assertUnitConversionUnlocked(existingCategory);
    const category = await ESCategory.findByIdAndUpdate(categoryId, {
      $set: {
        applicabilityStatus,
        applicable: applicabilityStatus === 'applicable',
      },
    }, { new: true, runValidators: true });
    if (!category) {
      const error = new Error('Category not found.');
      error.statusCode = 404;
      throw error;
    }
    await refreshShoppingRequirements();
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'applicability update');
  }
};

exports.classify_food_item = async (req, res) => {
  try {
    const itemId = requiredText(req.body?.item_id, 'Food item');
    const contributionType = requiredText(req.body?.foodContributionType, 'Food contribution type');
    const contributionFields = {
      complete: 'completeMeals',
      staple: 'stapleServings',
      main: 'mainDishServings',
      produce: 'produceServings',
      supplemental: 'supplementalServings',
    };
    const contributionField = contributionFields[contributionType];
    if (!contributionField) {
      const error = new RangeError('Choose complete meal, staple, main/protein, produce, or supplemental food.');
      error.statusCode = 400;
      throw error;
    }
    const servingsPerUnit = optionalNumber(
      req.body?.foodServingsPerUnit,
      'Food servings per inventory unit',
      { min: 0.01 },
    );
    if (!servingsPerUnit) {
      const error = new RangeError('Food servings per inventory unit must be greater than zero.');
      error.statusCode = 400;
      throw error;
    }
    const item = await ESItem.findById(itemId).lean();
    if (!item || (item.status && item.status !== 'active')) {
      const error = new Error('Active food item not found.');
      error.statusCode = 404;
      throw error;
    }
    const categoryDocument = await ESCategory.findById(item.categoryId).lean();
    assertUnitConversionUnlocked(categoryDocument);
    const category = normalizeCategory(categoryDocument || {});
    if (category.preparednessDomain !== 'food') {
      const error = new RangeError('Only food-domain inventory can receive a food classification.');
      error.statusCode = 400;
      throw error;
    }
    const contributionOverride = {
      [contributionField]: servingsPerUnit,
      noCookMeals: req.body?.foodNoCook === 'on' || req.body?.foodNoCook === 'true'
        ? servingsPerUnit
        : 0,
      waterLitresRequired: optionalNumber(
        req.body?.foodWaterLitresRequired,
        'Preparation water per inventory unit',
      ) || 0,
      fuelMealsRequired: req.body?.foodRequiresFuel === 'on' || req.body?.foodRequiresFuel === 'true'
        ? servingsPerUnit
        : 0,
    };
    const updatedItem = await ESItem.findByIdAndUpdate(itemId, {
      $set: { contributionOverride, foodRole: contributionType },
    }, { new: true, runValidators: true });
    if (!updatedItem) {
      const error = new Error('Active food item not found.');
      error.statusCode = 404;
      throw error;
    }
    await refreshShoppingRequirements();
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'food classification');
  }
};

exports.convert_unit = async (req, res) => {
  try {
    await convertCategoryUnit({
      CategoryModel: ESCategory,
      ItemModel: ESItem,
      connection: mongoose.connection,
      JournalModel: ESUnitConversion,
      logger,
      categoryId: requiredText(req.body?.category_id, 'Category'),
      newUnit: requiredText(req.body?.newUnit, 'New unit'),
      expectedCurrentUnit: requiredText(req.body?.currentUnit, 'Current unit'),
      customFactor: req.body?.conversionFactor,
    });
    await refreshShoppingRequirements();
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'unit conversion');
  }
};

exports.edit_profile = async (req, res) => {
  try {
    const body = req.body || {};
    const update = {
      householdSize: optionalNumber(body.householdSize, 'Household size', { min: 1, integer: true }),
      officialFloorDays: optionalNumber(body.officialFloorDays, 'Official floor', { min: 1 }),
      longTermTargetDays: optionalNumber(body.longTermTargetDays, 'Long-term target', { min: 1 }),
      longTermGoalDate: optionalDate(body.longTermGoalDate, 'Long-term goal date'),
      mealsPerPersonDay: optionalNumber(body.mealsPerPersonDay, 'Meals per person per day', { min: 1 }),
      waterLitresPerPersonDay: optionalNumber(body.waterLitresPerPersonDay, 'Water litres per person per day', { min: 0.1 }),
      toiletUsesPerPersonDay: optionalNumber(body.toiletUsesPerPersonDay, 'Toilet uses per person per day', { min: 0.1 }),
      assumptions: String(body.assumptions || '').trim() || undefined,
      lastHouseholdReviewAt: new Date(),
      recommendationReviewedAt: optionalDate(body.recommendationReviewedAt, 'Recommendation review date'),
      recommendationNextReviewAt: optionalDate(body.recommendationNextReviewAt, 'Next recommendation review'),
      timeZone: String(body.timeZone || 'Asia/Tokyo').trim(),
    };
    Object.keys(update).forEach(key => update[key] === undefined && delete update[key]);
    await ESProfile.findOneAndUpdate(
      { key: 'household' },
      { $set: update, $setOnInsert: { key: 'household' } },
      { upsert: true, new: true, runValidators: true },
    );
    await refreshShoppingRequirements();
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'household profile update');
  }
};

exports.update_requirement = async (req, res) => {
  try {
    let requirementId = String(req.body?.requirement_id || '').trim();
    const fingerprint = String(req.body?.requirement_fingerprint || '').trim();
    if (!requirementId && fingerprint) {
      await refreshShoppingRequirements();
      const saved = await ESShoppingRequirement.findOne({ fingerprint }).select({ _id: 1 }).lean();
      requirementId = saved?._id?.toString() || '';
    }
    requiredText(requirementId, 'Shopping requirement');
    const status = requiredText(req.body?.status, 'Status');
    if (!['needed', 'planned', 'purchased'].includes(status)) {
      const error = new RangeError('Choose needed, planned, or purchased.');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date();
    const setFields = { status };
    if (status === 'planned') setFields.plannedAt = now;
    if (status === 'purchased') setFields.purchasedAt = now;
    const unsetFields = { resolvedAt: 1 };
    if (status !== 'planned') unsetFields.plannedAt = 1;
    if (status !== 'purchased') unsetFields.purchasedAt = 1;
    const requirement = await ESShoppingRequirement.findByIdAndUpdate(
      requirementId,
      { $set: setFields, $unset: unsetFields },
      { new: true, runValidators: true },
    );
    if (!requirement) {
      const error = new Error('Shopping requirement not found.');
      error.statusCode = 404;
      throw error;
    }
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'shopping status update');
  }
};

exports.save_menu_entry = async (req, res) => {
  try {
    const body = req.body || {};
    const day = optionalNumber(body.day, 'Menu day', { min: 1, integer: true });
    if (day > 5) {
      const error = new RangeError('Menu day must be between 1 and 5.');
      error.statusCode = 400;
      throw error;
    }
    const meal = requiredText(body.meal, 'Meal');
    if (!['breakfast', 'lunch', 'dinner'].includes(meal)) {
      const error = new RangeError('Choose breakfast, lunch, or dinner.');
      error.statusCode = 400;
      throw error;
    }
    await ESMenuEntry.findOneAndUpdate(
      { day, meal },
      {
        $set: {
          day,
          meal,
          label: requiredText(body.label, 'Menu label'),
          servings: optionalNumber(body.servings, 'Servings', { min: 0.1 }),
          stapleSource: String(body.stapleSource || '').trim() || undefined,
          mainDishSource: String(body.mainDishSource || '').trim() || undefined,
          produceSource: String(body.produceSource || '').trim() || undefined,
          noCook: body.noCook === 'on' || body.noCook === 'true',
          waterLitresRequired: optionalNumber(body.waterLitresRequired, 'Preparation water') || 0,
          requiresFuel: body.requiresFuel === 'on' || body.requiresFuel === 'true',
          dietaryNote: String(body.dietaryNote || '').trim() || undefined,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'menu exercise update');
  }
};

exports.delete_menu_entry = async (req, res) => {
  try {
    const entryId = requiredText(req.body?.entry_id, 'Menu entry');
    await ESMenuEntry.deleteOne({ _id: entryId });
    res.redirect('/es/es_dashboard');
  } catch (error) {
    handleControllerError(res, error, 'menu exercise removal');
  }
};

exports._private = {
  addUtcMonths,
  loadEmergencyStockData,
  optionalDate,
  optionalNumber,
  refreshShoppingRequirements,
};
