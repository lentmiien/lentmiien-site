#!/usr/bin/env node
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const ESCategory = require('../models/es_category');
const ESItem = require('../models/es_item');
const ESProfile = require('../models/es_profile');
const { buildEmergencyStockMigrationPlan } = require('../services/emergencyStockMigrationService');
const { DEFAULT_MILESTONES } = require('../services/emergencyStockService');
const { NATIONAL_GUIDANCE_SOURCE } = require('../services/emergencyStockCategoryGuidance');

async function main() {
  const execute = process.argv.includes('--execute');
  if (!process.env.MONGOOSE_URL) {
    throw new Error('MONGOOSE_URL is required. No migration was attempted.');
  }
  await mongoose.connect(process.env.MONGOOSE_URL);
  try {
    const [categories, items, profile] = await Promise.all([
      ESCategory.find({}).lean(),
      ESItem.find({}).lean(),
      ESProfile.findOne({ key: 'household' }).lean(),
    ]);
    const plan = buildEmergencyStockMigrationPlan({ categories, items });
    const summary = {
      mode: execute ? 'execute' : 'dry-run',
      categoriesFound: categories.length,
      itemsFound: items.length,
      categoryUpdates: plan.categoryUpdates.length,
      itemUpdates: plan.itemUpdates.length,
      classifications: plan.classifications,
      profileAction: profile ? 'preserve existing profile' : 'create v2 household defaults',
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    plan.categoryUpdates.forEach(update => {
      process.stdout.write(`category: ${update.name} -> ${update.fields.managementMode || 'already classified'}; fields: ${Object.keys(update.fields).join(', ')}\n`);
    });
    plan.itemUpdates.forEach(update => {
      process.stdout.write(`item: ${update.id}; fields: ${Object.keys(update.fields).join(', ')}\n`);
    });
    if (!execute) {
      process.stdout.write('Dry run only. Re-run with --execute after reviewing the classifications.\n');
      return;
    }
    if (plan.categoryUpdates.length) {
      await ESCategory.bulkWrite(plan.categoryUpdates.map(update => ({
        updateOne: { filter: { _id: update.id }, update: { $set: update.fields } },
      })));
    }
    if (plan.itemUpdates.length) {
      await ESItem.bulkWrite(plan.itemUpdates.map(update => ({
        updateOne: { filter: { _id: update.id }, update: { $set: update.fields } },
      })));
    }
    if (!profile) {
      await ESProfile.create({
        key: 'household',
        householdSize: 3,
        officialFloorDays: 3,
        longTermTargetDays: 7,
        longTermGoalDate: new Date('2026-12-31T00:00:00.000Z'),
        milestones: DEFAULT_MILESTONES,
        recommendationReviewedAt: new Date('2026-08-22T00:00:00.000Z'),
        recommendationNextReviewAt: new Date('2028-01-01T00:00:00.000Z'),
        recommendationSource: NATIONAL_GUIDANCE_SOURCE,
        timeZone: 'Asia/Tokyo',
      });
    }
    process.stdout.write('Emergency Stock v2 migration completed without deleting records.\n');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Emergency Stock v2 migration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
