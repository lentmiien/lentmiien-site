'use strict';

const { randomUUID } = require('node:crypto');

const CATEGORY_QUANTITY_FIELDS = Object.freeze([
  'recommendedStock',
  'officialBaseline',
  'personalTarget',
  'emergencyFloor',
  'reorderPoint',
  'restockToAmount',
  'normalConsumptionRate',
  'packageSize',
  'unitsPerPersonDay',
]);

const CONTRIBUTION_FIELDS = Object.freeze([
  'domainUnits',
  'completeMeals',
  'stapleServings',
  'mainDishServings',
  'produceServings',
  'supplementalServings',
  'noCookMeals',
  'waterLitresRequired',
  'fuelMealsRequired',
]);

const UNIT_DEFINITIONS = new Map([
  ['ml', { dimension: 'volume', baseFactor: 0.001, label: 'mL' }],
  ['milliliter', { dimension: 'volume', baseFactor: 0.001, label: 'mL' }],
  ['milliliters', { dimension: 'volume', baseFactor: 0.001, label: 'mL' }],
  ['millilitre', { dimension: 'volume', baseFactor: 0.001, label: 'mL' }],
  ['millilitres', { dimension: 'volume', baseFactor: 0.001, label: 'mL' }],
  ['cl', { dimension: 'volume', baseFactor: 0.01, label: 'cL' }],
  ['centiliter', { dimension: 'volume', baseFactor: 0.01, label: 'cL' }],
  ['centilitre', { dimension: 'volume', baseFactor: 0.01, label: 'cL' }],
  ['dl', { dimension: 'volume', baseFactor: 0.1, label: 'dL' }],
  ['deciliter', { dimension: 'volume', baseFactor: 0.1, label: 'dL' }],
  ['decilitre', { dimension: 'volume', baseFactor: 0.1, label: 'dL' }],
  ['l', { dimension: 'volume', baseFactor: 1, label: 'L' }],
  ['liter', { dimension: 'volume', baseFactor: 1, label: 'L' }],
  ['liters', { dimension: 'volume', baseFactor: 1, label: 'L' }],
  ['litre', { dimension: 'volume', baseFactor: 1, label: 'L' }],
  ['litres', { dimension: 'volume', baseFactor: 1, label: 'L' }],
  ['g', { dimension: 'mass', baseFactor: 0.001, label: 'g' }],
  ['gram', { dimension: 'mass', baseFactor: 0.001, label: 'g' }],
  ['grams', { dimension: 'mass', baseFactor: 0.001, label: 'g' }],
  ['kg', { dimension: 'mass', baseFactor: 1, label: 'kg' }],
  ['kilogram', { dimension: 'mass', baseFactor: 1, label: 'kg' }],
  ['kilograms', { dimension: 'mass', baseFactor: 1, label: 'kg' }],
]);

function asPlain(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject({ depopulate: true });
  }
  return value || {};
}

function requestError(message, statusCode = 400) {
  const error = new RangeError(message);
  error.statusCode = statusCode;
  return error;
}

function unitKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s_-]+/g, '');
}

function roundConverted(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round((value + Number.EPSILON) * 1e12) / 1e12;
}

function resolveUnitConversion(fromUnit, toUnit, customFactor) {
  const from = String(fromUnit || '').trim();
  const to = String(toUnit || '').trim();
  if (!from || !to) throw requestError('Both the current and new units are required.');

  const fromDefinition = UNIT_DEFINITIONS.get(unitKey(from));
  const toDefinition = UNIT_DEFINITIONS.get(unitKey(to));
  const providedFactor = customFactor === undefined || customFactor === null || customFactor === ''
    ? null
    : Number(customFactor);
  if (providedFactor !== null && (!Number.isFinite(providedFactor) || providedFactor <= 0 || providedFactor > 1e9)) {
    throw requestError('The custom conversion factor must be greater than zero and no more than 1,000,000,000.');
  }

  if (unitKey(from) === unitKey(to)) {
    return { fromUnit: from, toUnit: toDefinition?.label || to, factor: 1, automatic: true };
  }
  if (fromDefinition && toDefinition) {
    if (fromDefinition.dimension !== toDefinition.dimension) {
      throw requestError(`Cannot convert ${from} to ${to}: the units measure different things.`);
    }
    const factor = fromDefinition.baseFactor / toDefinition.baseFactor;
    if (providedFactor !== null && Math.abs(providedFactor - factor) > Math.max(1e-12, factor * 1e-9)) {
      throw requestError(`The supplied factor does not match the known ${from} to ${to} conversion.`);
    }
    return {
      fromUnit: from,
      toUnit: toDefinition.label,
      factor,
      automatic: true,
    };
  }
  if (providedFactor === null) {
    throw requestError(`No safe automatic conversion is known for ${from} to ${to}. Enter an explicit conversion factor.`);
  }
  return { fromUnit: from, toUnit: to, factor: providedFactor, automatic: false };
}

function convertContribution(input, factor) {
  const contribution = asPlain(input);
  if (!input) return undefined;
  return Object.fromEntries(CONTRIBUTION_FIELDS.map(field => {
    const value = Number(contribution[field]);
    return [field, Number.isFinite(value) ? roundConverted(value / factor) : 0];
  }));
}

function buildConvertedCategoryFields(categoryInput, conversion) {
  const category = asPlain(categoryInput);
  const fields = { unit: conversion.toUnit };
  CATEGORY_QUANTITY_FIELDS.forEach(field => {
    const value = Number(category[field]);
    if (Number.isFinite(value)) fields[field] = roundConverted(value * conversion.factor);
  });
  if (Array.isArray(category.milestones)) {
    fields.milestones = category.milestones.map(milestone => ({
      deadline: milestone.deadline,
      target: roundConverted(Number(milestone.target) * conversion.factor),
    }));
  }
  if (category.contributionPerUnit) {
    fields.contributionPerUnit = convertContribution(category.contributionPerUnit, conversion.factor);
  }
  return fields;
}

function buildConvertedItemFields(itemInput, conversion) {
  const item = asPlain(itemInput);
  const fields = {
    amount: roundConverted(Number(item.amount) * conversion.factor),
  };
  const packageSize = Number(item.packageSize);
  if (Number.isFinite(packageSize)) fields.packageSize = roundConverted(packageSize * conversion.factor);
  if (item.contributionOverride) {
    fields.contributionOverride = convertContribution(item.contributionOverride, conversion.factor);
  }
  return fields;
}

async function queryWithSession(query, session) {
  const sessionQuery = session && typeof query.session === 'function' ? query.session(session) : query;
  return typeof sessionQuery.lean === 'function' ? sessionQuery.lean() : sessionQuery;
}

function matchedCount(result) {
  const count = Number(result?.matchedCount ?? result?.n);
  return Number.isFinite(count) ? count : null;
}

async function databaseSupportsTransactions(connection) {
  if (!connection?.db || typeof connection.db.admin !== 'function') {
    // Lightweight test doubles and non-Mongo adapters cannot expose topology.
    // Preserve the established transactional path when a session API exists.
    return typeof connection?.startSession === 'function';
  }
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    return Boolean(hello?.setName || hello?.msg === 'isdbgrid' || hello?.serviceId);
  } catch (_error) {
    // A guarded conversion remains available when topology discovery is not.
    return false;
  }
}

async function loadConversionPlan({
  CategoryModel,
  ItemModel,
  categoryId,
  newUnit,
  expectedCurrentUnit,
  customFactor,
  session,
}) {
  const category = await queryWithSession(CategoryModel.findById(categoryId), session);
  if (!category) throw requestError('Category not found.', 404);
  if (expectedCurrentUnit && unitKey(category.unit) !== unitKey(expectedCurrentUnit)) {
    throw requestError('The category unit changed after this page loaded. Reload and try again.', 409);
  }
  if (category.unitConversionLock?.operationId) {
    throw requestError('A previous unit conversion is still locked. Review its rollback journal before retrying.', 409);
  }
  const conversion = resolveUnitConversion(category.unit, newUnit, customFactor);
  const items = await queryWithSession(
    ItemModel.find({ categoryId: String(category._id || categoryId) }),
    session,
  );
  return {
    category: asPlain(category),
    items: (items || []).map(asPlain),
    conversion,
    categoryFields: buildConvertedCategoryFields(category, conversion),
  };
}

async function applyItemConversions(ItemModel, items, conversion, options = {}) {
  if (items.length === 0) return;
  const result = await ItemModel.bulkWrite(items.map(item => ({
    updateOne: {
      filter: { _id: item._id, categoryId: item.categoryId },
      update: { $set: buildConvertedItemFields(item, conversion) },
    },
  })), { ordered: true, ...options });
  const matched = matchedCount(result);
  if (matched !== null && matched !== items.length) {
    throw requestError('One or more inventory records changed during conversion. No conversion was retained.', 409);
  }
}

function itemVersionFilter(item, changedFields) {
  const filter = {
    _id: item._id,
    categoryId: item.categoryId,
  };
  changedFields.forEach(field => {
    const exists = Object.prototype.hasOwnProperty.call(item, field) && item[field] !== undefined;
    if (field === 'contributionOverride' && exists) {
      Object.entries(contributionValuesForFilter(item[field])).forEach(([key, value]) => {
        filter[`contributionOverride.${key}`] = value;
      });
    } else {
      filter[field] = exists ? item[field] : { $exists: false };
    }
  });
  if (item.updatedAt) filter.updatedAt = item.updatedAt;
  return filter;
}

function contributionValuesForFilter(contribution) {
  const plain = asPlain(contribution);
  return Object.fromEntries(CONTRIBUTION_FIELDS.map(field => [field, Number(plain[field]) || 0]));
}

function assignConvertedFieldsToFilter(filter, convertedFields) {
  Object.entries(convertedFields).forEach(([field, value]) => {
    if (field === 'contributionOverride') {
      Object.entries(contributionValuesForFilter(value)).forEach(([key, contributionValue]) => {
        filter[`contributionOverride.${key}`] = contributionValue;
      });
    } else {
      filter[field] = value;
    }
  });
}

async function applyGuardedItemConversions(ItemModel, items, conversion, convertedItems) {
  for (const item of items) {
    const convertedFields = buildConvertedItemFields(item, conversion);
    const result = await ItemModel.updateOne(
      itemVersionFilter(item, Object.keys(convertedFields)),
      { $set: convertedFields },
      { runValidators: true },
    );
    if (matchedCount(result) !== 1) {
      throw requestError('An inventory record changed during conversion. No conversion was retained.', 409);
    }
    convertedItems.push({ item, convertedFields });
  }
}

async function verifyInventorySetUnchanged(ItemModel, categoryId, plannedItems) {
  const currentItems = await queryWithSession(ItemModel.find({ categoryId: String(categoryId) }));
  const plannedIds = plannedItems.map(item => String(item._id)).sort();
  const currentIds = (currentItems || []).map(item => String(item._id)).sort();
  if (plannedIds.length !== currentIds.length || plannedIds.some((id, index) => id !== currentIds[index])) {
    throw requestError('Inventory was added or removed during conversion. No conversion was retained.', 409);
  }
}

async function convertWithTransaction({
  CategoryModel,
  ItemModel,
  connection,
  categoryId,
  newUnit,
  expectedCurrentUnit,
  customFactor,
}) {
  if (typeof connection.startSession !== 'function') {
    throw new TypeError('The database reports transaction support but cannot start a session.');
  }
  const session = await connection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const plan = await loadConversionPlan({
        CategoryModel,
        ItemModel,
        categoryId,
        newUnit,
        expectedCurrentUnit,
        customFactor,
        session,
      });
      const categoryUpdate = await CategoryModel.updateOne(
        { _id: plan.category._id, unit: plan.category.unit },
        { $set: plan.categoryFields },
        { session, runValidators: true },
      );
      if (matchedCount(categoryUpdate) !== 1) {
        throw requestError('The category changed during conversion. Reload and try again.', 409);
      }
      await applyItemConversions(ItemModel, plan.items, plan.conversion, { session });
      result = {
        categoryId: String(plan.category._id || categoryId),
        convertedItems: plan.items.length,
        mode: 'transaction',
        ...plan.conversion,
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

function buildRestoreUpdate(snapshot, changedFields) {
  const setFields = {};
  const unsetFields = {};
  changedFields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(snapshot, field) && snapshot[field] !== undefined) {
      setFields[field] = snapshot[field];
    } else {
      unsetFields[field] = 1;
    }
  });
  const update = {};
  if (Object.keys(setFields).length > 0) update.$set = setFields;
  if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
  return update;
}

async function updateJournal(JournalModel, operationId, fields) {
  await JournalModel.updateOne(
    { operationId },
    { $set: fields },
    { runValidators: true },
  );
}

async function logConversionFailure(logger, method, message, metadata) {
  if (typeof logger?.[method] === 'function') {
    try {
      await logger[method](message, {
        category: 'emergency-stock',
        metadata,
      });
    } catch (_error) {
      // Logging must not change whether the database rollback succeeded.
    }
  }
}

async function rollbackGuardedConversion({
  CategoryModel,
  ItemModel,
  JournalModel,
  operationId,
  category,
  convertedItems,
  failure,
  logger,
}) {
  let rollbackError = null;
  try {
    for (const { item, convertedFields } of convertedItems.slice().reverse()) {
      const rollbackFilter = {
        _id: item._id,
        categoryId: item.categoryId,
      };
      assignConvertedFieldsToFilter(rollbackFilter, convertedFields);
      const rollbackResult = await ItemModel.updateOne(
        rollbackFilter,
        buildRestoreUpdate(item, Object.keys(convertedFields)),
        { runValidators: true },
      );
      if (matchedCount(rollbackResult) !== 1) {
        throw new Error(`Inventory record ${item._id} changed before rollback.`);
      }
    }
    const unlockResult = await CategoryModel.updateOne(
      { _id: category._id, 'unitConversionLock.operationId': operationId },
      { $unset: { unitConversionLock: 1 } },
      { runValidators: true, timestamps: false },
    );
    if (matchedCount(unlockResult) !== 1) throw new Error('The category conversion lock could not be released.');
  } catch (error) {
    rollbackError = error;
  }

  if (rollbackError) {
    try {
      await updateJournal(JournalModel, operationId, {
        status: 'rollback-failed',
        failure: `${failure?.message || failure}; rollback: ${rollbackError.message}`.slice(0, 1000),
      });
    } catch (_journalError) {
      // The primary error log below remains the operational recovery signal.
    }
    await logConversionFailure(
      logger,
      'error',
      'Emergency stock unit conversion rollback failed',
      {
        operationId,
        categoryId: String(category._id),
        error: failure?.message,
        rollbackError: rollbackError.message,
      },
    );
    return false;
  }

  try {
    await updateJournal(JournalModel, operationId, {
      status: 'rolled-back',
      rolledBackAt: new Date(),
      failure: String(failure?.message || failure).slice(0, 1000),
    });
  } catch (journalError) {
    await logConversionFailure(
      logger,
      'error',
      'Emergency stock unit conversion rolled back but its journal could not be finalized',
      { operationId, categoryId: String(category._id), error: journalError.message },
    );
  }
  await logConversionFailure(
    logger,
    'warning',
    'Emergency stock unit conversion failed and was rolled back',
    { operationId, categoryId: String(category._id), error: failure?.message },
  );
  return true;
}

async function convertWithGuardedRollback({
  CategoryModel,
  ItemModel,
  JournalModel,
  categoryId,
  newUnit,
  expectedCurrentUnit,
  customFactor,
  logger,
}) {
  if (!JournalModel || typeof JournalModel.create !== 'function' || typeof JournalModel.updateOne !== 'function') {
    const error = requestError('Unit conversion is unavailable because this standalone database has no rollback journal.', 503);
    throw error;
  }
  const plan = await loadConversionPlan({
    CategoryModel,
    ItemModel,
    categoryId,
    newUnit,
    expectedCurrentUnit,
    customFactor,
  });
  const operationId = randomUUID();
  const startedAt = new Date();
  await JournalModel.create({
    operationId,
    categoryId: String(plan.category._id || categoryId),
    status: 'prepared',
    fromUnit: plan.conversion.fromUnit,
    toUnit: plan.conversion.toUnit,
    factor: plan.conversion.factor,
    automatic: plan.conversion.automatic,
    categorySnapshot: plan.category,
    itemSnapshots: plan.items,
  });
  const lockFilter = {
    _id: plan.category._id,
    unit: plan.category.unit,
    unitConversionLock: { $exists: false },
  };
  if (plan.category.updatedAt) lockFilter.updatedAt = plan.category.updatedAt;
  const lockResult = await CategoryModel.updateOne(lockFilter, {
    $set: {
      unitConversionLock: {
        operationId,
        fromUnit: plan.conversion.fromUnit,
        toUnit: plan.conversion.toUnit,
        startedAt,
      },
    },
  }, { runValidators: true, timestamps: false });
  if (matchedCount(lockResult) !== 1) {
    await updateJournal(JournalModel, operationId, {
      status: 'lock-conflict',
      failure: 'The category changed or another conversion acquired the lock.',
    });
    throw requestError('The category changed or another unit conversion is in progress. Reload and try again.', 409);
  }

  let committed = false;
  const convertedItems = [];
  try {
    await updateJournal(JournalModel, operationId, { status: 'applying' });
    await applyGuardedItemConversions(ItemModel, plan.items, plan.conversion, convertedItems);
    await verifyInventorySetUnchanged(ItemModel, plan.category._id || categoryId, plan.items);
    const categoryFilter = {
      _id: plan.category._id,
      unit: plan.category.unit,
      'unitConversionLock.operationId': operationId,
    };
    if (plan.category.updatedAt) categoryFilter.updatedAt = plan.category.updatedAt;
    const categoryUpdate = await CategoryModel.updateOne(categoryFilter, {
      $set: plan.categoryFields,
      $unset: { unitConversionLock: 1 },
    }, { runValidators: true });
    if (matchedCount(categoryUpdate) !== 1) {
      throw requestError('The category changed during conversion. No conversion was retained.', 409);
    }
    committed = true;
    try {
      await updateJournal(JournalModel, operationId, {
        status: 'completed',
        completedAt: new Date(),
      });
    } catch (journalError) {
      await logConversionFailure(
        logger,
        'warning',
        'Emergency stock unit conversion completed but its journal could not be finalized',
        { operationId, categoryId: String(plan.category._id), error: journalError.message },
      );
    }
    return {
      categoryId: String(plan.category._id || categoryId),
      convertedItems: plan.items.length,
      mode: 'guarded-rollback',
      operationId,
      ...plan.conversion,
    };
  } catch (error) {
    if (!committed) {
      const rolledBack = await rollbackGuardedConversion({
        CategoryModel,
        ItemModel,
        JournalModel,
        operationId,
        category: plan.category,
        convertedItems,
        failure: error,
        logger,
      });
      if (!rolledBack) {
        const rollbackFailure = new Error('Unit conversion failed and automatic rollback also failed. Review the conversion journal before editing this category.');
        rollbackFailure.statusCode = 500;
        rollbackFailure.cause = error;
        throw rollbackFailure;
      }
    }
    throw error;
  }
}

async function convertCategoryUnit({
  CategoryModel,
  ItemModel,
  connection,
  JournalModel,
  categoryId,
  newUnit,
  expectedCurrentUnit,
  customFactor,
  logger,
} = {}) {
  if (!CategoryModel || !ItemModel || !connection) {
    throw new TypeError('CategoryModel, ItemModel, and a database connection are required.');
  }
  if (await databaseSupportsTransactions(connection)) {
    return convertWithTransaction({
      CategoryModel,
      ItemModel,
      connection,
      categoryId,
      newUnit,
      expectedCurrentUnit,
      customFactor,
    });
  }
  return convertWithGuardedRollback({
    CategoryModel,
    ItemModel,
    JournalModel,
    categoryId,
    newUnit,
    expectedCurrentUnit,
    customFactor,
    logger,
  });
}

module.exports = {
  CATEGORY_QUANTITY_FIELDS,
  CONTRIBUTION_FIELDS,
  buildConvertedCategoryFields,
  buildConvertedItemFields,
  convertCategoryUnit,
  databaseSupportsTransactions,
  resolveUnitConversion,
  unitKey,
};
