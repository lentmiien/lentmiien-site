'use strict';

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
  const sessionQuery = typeof query.session === 'function' ? query.session(session) : query;
  return typeof sessionQuery.lean === 'function' ? sessionQuery.lean() : sessionQuery;
}

async function convertCategoryUnit({
  CategoryModel,
  ItemModel,
  connection,
  categoryId,
  newUnit,
  expectedCurrentUnit,
  customFactor,
} = {}) {
  if (!CategoryModel || !ItemModel || !connection || typeof connection.startSession !== 'function') {
    throw new TypeError('CategoryModel, ItemModel, and a transactional database connection are required.');
  }
  const session = await connection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const category = await queryWithSession(CategoryModel.findById(categoryId), session);
      if (!category) throw requestError('Category not found.', 404);
      if (expectedCurrentUnit && unitKey(category.unit) !== unitKey(expectedCurrentUnit)) {
        throw requestError('The category unit changed after this page loaded. Reload and try again.', 409);
      }
      const conversion = resolveUnitConversion(category.unit, newUnit, customFactor);
      const items = await queryWithSession(ItemModel.find({ categoryId: String(category._id || categoryId) }), session);
      const categoryUpdate = await CategoryModel.updateOne(
        { _id: category._id, unit: category.unit },
        { $set: buildConvertedCategoryFields(category, conversion) },
        { session, runValidators: true },
      );
      if (Number(categoryUpdate?.matchedCount) !== 1) {
        throw requestError('The category changed during conversion. Reload and try again.', 409);
      }
      if (items.length > 0) {
        await ItemModel.bulkWrite(items.map(item => ({
          updateOne: {
            filter: { _id: item._id },
            update: { $set: buildConvertedItemFields(item, conversion) },
          },
        })), { ordered: true, session });
      }
      result = {
        categoryId: String(category._id || categoryId),
        convertedItems: items.length,
        ...conversion,
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

module.exports = {
  CATEGORY_QUANTITY_FIELDS,
  CONTRIBUTION_FIELDS,
  buildConvertedCategoryFields,
  buildConvertedItemFields,
  convertCategoryUnit,
  resolveUnitConversion,
  unitKey,
};
