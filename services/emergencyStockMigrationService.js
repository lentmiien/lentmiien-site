'use strict';

const { buildMigrationFields, inferManagementMode } = require('./emergencyStockCategoryGuidance');

function asPlain(value) {
  return value && typeof value.toObject === 'function' ? value.toObject() : (value || {});
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildCategoryMigration(categoryInput) {
  const category = asPlain(categoryInput);
  return {
    id: String(category._id || category.id || ''),
    name: category.name,
    fields: buildMigrationFields(category),
  };
}

function buildItemMigration(itemInput, categoryInput, now = new Date()) {
  const item = asPlain(itemInput);
  const category = asPlain(categoryInput);
  const mode = inferManagementMode(category);
  const legacyDate = validDate(item.rotateDate);
  const fields = {};

  if (!item.status) fields.status = 'active';
  if (!item.quantityUpdatedAt) fields.quantityUpdatedAt = validDate(item.updatedAt) || now;

  if (mode === 'durable' && !item.inspectionDueAt) {
    // Implausibly distant v1 dates (such as the known year-3035 work-glove
    // record) are retained in rotateDate for audit history, but the equipment
    // is made due for a real inspection now.
    const latestCredibleInspection = new Date(now.getTime());
    latestCredibleInspection.setUTCFullYear(latestCredibleInspection.getUTCFullYear() + 2);
    fields.inspectionDueAt = legacyDate && legacyDate <= latestCredibleInspection ? legacyDate : now;
  }
  if (mode !== 'durable' && legacyDate && !item.expiresAt) {
    fields.expiresAt = legacyDate;
  }

  return {
    id: String(item._id || item.id || ''),
    categoryId: String(item.categoryId || ''),
    fields,
  };
}

function buildEmergencyStockMigrationPlan({ categories = [], items = [], now = new Date() } = {}) {
  const categoryById = new Map(categories.map(category => [String(category._id || category.id || ''), category]));
  const categoryUpdates = categories.map(buildCategoryMigration)
    .filter(update => Object.keys(update.fields).length > 0);
  const itemUpdates = items
    .map(item => buildItemMigration(item, categoryById.get(String(item.categoryId || '')), now))
    .filter(update => Object.keys(update.fields).length > 0);
  const classifications = categories.reduce((counts, category) => {
    const mode = inferManagementMode(category);
    counts[mode] = (counts[mode] || 0) + 1;
    return counts;
  }, {});
  return { categoryUpdates, itemUpdates, classifications };
}

module.exports = {
  buildCategoryMigration,
  buildEmergencyStockMigrationPlan,
  buildItemMigration,
};
