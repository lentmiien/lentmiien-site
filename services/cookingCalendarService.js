
const { Types, isValidObjectId } = require('mongoose');
const logger = require('../utils/logger');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_WARNING_WINDOW = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

class CookingCalendarService {
  constructor({ CookingCalendarModel, CookingCalendarV2Model, Chat4KnowledgeModel, CookbookRecipeModel = null }) {
    this.CookingCalendarModel = CookingCalendarModel;
    this.CookingCalendarV2Model = CookingCalendarV2Model;
    this.Chat4KnowledgeModel = Chat4KnowledgeModel;
    this.CookbookRecipeModel = CookbookRecipeModel;
    this.categories = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Drink', 'Side', 'Other'];
  }

  isValidDate(value) {
    return typeof value === 'string' && DATE_REGEX.test(value);
  }

  parseDate(value) {
    if (!this.isValidDate(value)) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD.');
    }
    return new Date(`${value}T00:00:00Z`);
  }

  formatDate(date) {
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  addDays(date, days) {
    const base = new Date(date);
    base.setUTCDate(base.getUTCDate() + days);
    return base;
  }

  createDateRange(start, end) {
    const startDate = this.parseDate(start);
    const endDate = this.parseDate(end);
    if (startDate > endDate) {
      throw new Error('Start date must not be after end date.');
    }
    const dates = [];
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      dates.push(this.formatDate(cursor));
      cursor = this.addDays(cursor, 1);
    }
    return dates;
  }

  getWeekdayName(dateStr) {
    const date = this.parseDate(dateStr);
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return weekdays[date.getUTCDay()];
  }

  normalizeCategory(category) {
    if (!category || typeof category !== 'string') {
      return 'Other';
    }
    const trimmed = category.trim();
    if (!trimmed) {
      return 'Other';
    }
    const match = this.categories.find(item => item.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      return match;
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  emptyUsage() {
    return {
      totalCount: 0,
      countLast90Days: 0,
      countPrev90Days: 0,
      existInLast10Days: false,
      lastCookedDate: null,
    };
  }

  mergeUsage(existingUsage, nextUsage) {
    const existing = existingUsage || this.emptyUsage();
    const payload = nextUsage || this.emptyUsage();
    return {
      totalCount: (existing.totalCount || 0) + (payload.totalCount || 0),
      countLast90Days: (existing.countLast90Days || 0) + (payload.countLast90Days || 0),
      countPrev90Days: (existing.countPrev90Days || 0) + (payload.countPrev90Days || 0),
      existInLast10Days: Boolean(existing.existInLast10Days || payload.existInLast10Days),
      lastCookedDate: existing.lastCookedDate && payload.lastCookedDate
        ? (existing.lastCookedDate > payload.lastCookedDate ? existing.lastCookedDate : payload.lastCookedDate)
        : (existing.lastCookedDate || payload.lastCookedDate || null),
    };
  }

  serializeUsage(usage) {
    if (!usage) {
      usage = this.emptyUsage();
    }
    return {
      totalCount: usage.totalCount || 0,
      countLast90Days: usage.countLast90Days || 0,
      countPrev90Days: usage.countPrev90Days || 0,
      existInLast10Days: Boolean(usage.existInLast10Days),
      lastCookedDate: usage.lastCookedDate ? this.formatDate(usage.lastCookedDate) : null,
    };
  }

  getCategories() {
    return [...this.categories];
  }

  normalizeObjectIdStrings(values, options = {}) {
    const throwOnInvalid = options.throwOnInvalid !== false;
    const errorMessage = options.errorMessage || 'Invalid recipe id.';
    const input = Array.isArray(values) ? values : [values];
    const ids = [];
    const seen = new Set();

    input.forEach((value) => {
      if (value === null || value === undefined) {
        return;
      }
      const normalized = String(value).trim();
      if (!normalized) {
        return;
      }
      if (!isValidObjectId(normalized)) {
        if (throwOnInvalid) {
          throw new Error(errorMessage);
        }
        return;
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        ids.push(normalized);
      }
    });

    return ids;
  }

  toKnowledgeRecipeRecord(knowledge) {
    const id = knowledge && knowledge._id ? knowledge._id.toString() : '';
    if (!id) return null;
    return {
      id,
      title: knowledge.title || '',
      images: Array.isArray(knowledge.images) ? knowledge.images : [],
      source: 'knowledge',
      originKnowledgeId: null,
      aliasIds: [id],
      viewPath: `/chat4/viewknowledge/${id}`,
    };
  }

  toCookbookRecipeRecord(recipe) {
    const id = recipe && recipe._id ? recipe._id.toString() : '';
    if (!id) return null;

    const originKnowledgeId = recipe.originKnowledgeId ? String(recipe.originKnowledgeId).trim() : '';
    const aliasIds = this.normalizeObjectIdStrings(
      [id, originKnowledgeId],
      { throwOnInvalid: false }
    );

    return {
      id,
      title: recipe.title || '',
      images: Array.isArray(recipe.images) ? recipe.images : [],
      source: 'cookbook',
      originKnowledgeId: originKnowledgeId || null,
      aliasIds,
      viewPath: `/cooking/cookbook/${id}`,
    };
  }

  toPublicRecipe(recipeRecord, usageMap) {
    const mergedUsage = this.buildMergedUsageForRecipe(recipeRecord, usageMap);
    return {
      id: recipeRecord.id,
      title: recipeRecord.title,
      images: recipeRecord.images,
      source: recipeRecord.source,
      originKnowledgeId: recipeRecord.originKnowledgeId,
      viewPath: recipeRecord.viewPath,
      usage: this.serializeUsage(mergedUsage),
    };
  }

  buildMergedUsageForRecipe(recipeRecord, usageMap) {
    const aliasIds = this.normalizeObjectIdStrings(recipeRecord.aliasIds || recipeRecord.id, { throwOnInvalid: false });
    return aliasIds.reduce(
      (acc, id) => this.mergeUsage(acc, usageMap.get(id)),
      this.emptyUsage()
    );
  }

  async getUnifiedRecipeLibrary() {
    const cookbookQuery = this.CookbookRecipeModel
      ? this.CookbookRecipeModel.find({})
      : null;

    const [cookbookRecipes, knowledgeRecipes] = await Promise.all([
      cookbookQuery ? cookbookQuery.lean() : [],
      this.Chat4KnowledgeModel.find({ category: 'Recipe' }).lean(),
    ]);

    const recipes = [];
    const recipeById = new Map();
    const recipeByAnyId = new Map();
    const transitionedKnowledgeIds = new Set();

    cookbookRecipes.forEach((cookbook) => {
      const record = this.toCookbookRecipeRecord(cookbook);
      if (!record) return;

      recipes.push(record);
      recipeById.set(record.id, record);
      recipeByAnyId.set(record.id, record);
      if (record.originKnowledgeId) {
        transitionedKnowledgeIds.add(record.originKnowledgeId);
        recipeByAnyId.set(record.originKnowledgeId, record);
      }
    });

    knowledgeRecipes.forEach((knowledge) => {
      const record = this.toKnowledgeRecipeRecord(knowledge);
      if (!record) return;
      if (transitionedKnowledgeIds.has(record.id)) {
        return;
      }
      recipes.push(record);
      recipeById.set(record.id, record);
      if (!recipeByAnyId.has(record.id)) {
        recipeByAnyId.set(record.id, record);
      }
    });

    recipes.sort((a, b) => {
      const titleA = String(a.title || '').toLowerCase();
      const titleB = String(b.title || '').toLowerCase();
      if (titleA < titleB) return -1;
      if (titleA > titleB) return 1;
      return 0;
    });

    return {
      recipes,
      recipeById,
      recipeByAnyId,
    };
  }

  async resolveCanonicalRecipe(recipeId) {
    if (!isValidObjectId(recipeId)) {
      return null;
    }

    if (this.CookbookRecipeModel) {
      const cookbookById = await this.CookbookRecipeModel.findOne({ _id: recipeId }).lean();
      if (cookbookById) {
        return this.toCookbookRecipeRecord(cookbookById);
      }

      const cookbookByOrigin = await this.CookbookRecipeModel
        .findOne({ originKnowledgeId: recipeId })
        .lean();
      if (cookbookByOrigin) {
        return this.toCookbookRecipeRecord(cookbookByOrigin);
      }
    }

    const knowledge = await this.Chat4KnowledgeModel
      .findOne({ _id: recipeId, category: 'Recipe' })
      .lean();
    if (!knowledge) {
      return null;
    }
    return this.toKnowledgeRecipeRecord(knowledge);
  }

  async getRecipeLibraryWithUsage() {
    const [library, usageMap] = await Promise.all([
      this.getUnifiedRecipeLibrary(),
      this.buildUsageMap(),
    ]);

    return library.recipes.map(recipe => this.toPublicRecipe(recipe, usageMap));
  }

  async buildUsageMap() {
    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const last10Start = this.addDays(todayStart, -DAYS_WARNING_WINDOW);
    const last90Start = this.addDays(todayStart, -90);
    const last180Start = this.addDays(todayStart, -180);

    const oldPipeline = [
      {
        $project: {
          date: 1,
          cookingItems: {
            $filter: {
              input: ['$dinnerToCook', '$lunchToCook', '$dessertToCook'],
              as: 'item',
              cond: {
                $and: [
                  { $ne: ['$$item', null] },
                  { $ne: ['$$item', ''] },
                ],
              },
            },
          },
        },
      },
      { $unwind: '$cookingItems' },
      {
        $addFields: {
          dateObj: {
            $dateFromString: {
              dateString: '$date',
              format: '%Y-%m-%d',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $match: { dateObj: { $ne: null } } },
      {
        $group: {
          _id: '$cookingItems',
          totalCount: { $sum: 1 },
          lastCookedDate: { $max: '$dateObj' },
          countLast90Days: {
            $sum: {
              $cond: [{ $gte: ['$dateObj', last90Start] }, 1, 0],
            },
          },
          countPrev90Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$dateObj', last180Start] },
                    { $lt: ['$dateObj', last90Start] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          existInLast10Days: {
            $max: {
              $cond: [{ $gte: ['$dateObj', last10Start] }, true, false],
            },
          },
        },
      },
    ];

    const newPipeline = [
      { $unwind: '$entries' },
      {
        $addFields: {
          dateObj: {
            $dateFromString: {
              dateString: '$date',
              format: '%Y-%m-%d',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $match: {
          dateObj: { $ne: null },
          'entries.recipeId': { $ne: null },
        },
      },
      {
        $group: {
          _id: '$entries.recipeId',
          totalCount: { $sum: 1 },
          lastCookedDate: { $max: '$dateObj' },
          countLast90Days: {
            $sum: {
              $cond: [{ $gte: ['$dateObj', last90Start] }, 1, 0],
            },
          },
          countPrev90Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$dateObj', last180Start] },
                    { $lt: ['$dateObj', last90Start] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          existInLast10Days: {
            $max: {
              $cond: [{ $gte: ['$dateObj', last10Start] }, true, false],
            },
          },
        },
      },
    ];

    const [oldUsage, newUsage] = await Promise.all([
      this.CookingCalendarModel.aggregate(oldPipeline).exec(),
      this.CookingCalendarV2Model.aggregate(newPipeline).exec(),
    ]);

    const usageMap = new Map();
    const upsert = (id, payload) => {
      if (!id) return;
      const key = id.toString();
      const existing = usageMap.get(key) || this.emptyUsage();
      usageMap.set(key, this.mergeUsage(existing, payload));
    };

    oldUsage.forEach(item => upsert(item._id, item));
    newUsage.forEach(item => upsert(item._id, item));

    return usageMap;
  }

  async getCalendarRange(startDate, endDate) {
    if (!this.isValidDate(startDate) || !this.isValidDate(endDate)) {
      throw new Error('Invalid date range. Expected YYYY-MM-DD values.');
    }

    const range = this.createDateRange(startDate, endDate);
    const [docs, library, usageMap] = await Promise.all([
      this.CookingCalendarV2Model.find({
        date: { $gte: startDate, $lte: endDate },
      }).lean(),
      this.getUnifiedRecipeLibrary(),
      this.buildUsageMap(),
    ]);

    const base = range.map(date => ({
      date,
      weekday: this.getWeekdayName(date),
      entries: [],
    }));
    const dayMap = new Map(base.map(entry => [entry.date, entry]));

    docs.forEach(doc => {
      const day = dayMap.get(doc.date);
      if (!day) {
        return;
      }
      const sortedEntries = [...(doc.entries || [])].sort((a, b) => {
        const categoryIndexA = this.categories.findIndex(item => item === a.category);
        const categoryIndexB = this.categories.findIndex(item => item === b.category);
        if (categoryIndexA !== categoryIndexB) {
          const idxA = categoryIndexA === -1 ? Number.MAX_SAFE_INTEGER : categoryIndexA;
          const idxB = categoryIndexB === -1 ? Number.MAX_SAFE_INTEGER : categoryIndexB;
          return idxA - idxB;
        }
        const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return aTime - bTime;
      });

      sortedEntries.forEach(entry => {
        const storedRecipeId = entry.recipeId ? entry.recipeId.toString() : null;
        const canonicalRecipe = storedRecipeId ? library.recipeByAnyId.get(storedRecipeId) : null;
        const usage = canonicalRecipe
          ? this.serializeUsage(this.buildMergedUsageForRecipe(canonicalRecipe, usageMap))
          : this.serializeUsage(storedRecipeId ? usageMap.get(storedRecipeId) : null);

        day.entries.push({
          entryId: entry._id.toString(),
          recipeId: storedRecipeId,
          category: entry.category,
          addedAt: entry.addedAt ? new Date(entry.addedAt).toISOString() : null,
          recipe: canonicalRecipe ? {
            id: canonicalRecipe.id,
            title: canonicalRecipe.title,
            image: Array.isArray(canonicalRecipe.images) && canonicalRecipe.images.length > 0 ? canonicalRecipe.images[0] : null,
            source: canonicalRecipe.source,
            viewPath: canonicalRecipe.viewPath,
          } : null,
          usage,
        });
      });
    });

    return {
      range: { start: startDate, end: endDate },
      categories: this.getCategories(),
      days: base,
    };
  }

  async getLastCookedDate(recipeId, beforeDate, additionalRecipeIds = []) {
    const allRecipeIds = this.normalizeObjectIdStrings(
      [recipeId, ...(Array.isArray(additionalRecipeIds) ? additionalRecipeIds : [additionalRecipeIds])],
      { throwOnInvalid: true, errorMessage: 'Invalid recipe id.' }
    );
    if (allRecipeIds.length === 0) {
      throw new Error('Invalid recipe id.');
    }

    if (beforeDate && !this.isValidDate(beforeDate)) {
      throw new Error('Invalid date format for lookup. Expected YYYY-MM-DD.');
    }

    const recipeObjectIds = allRecipeIds.map(id => new Types.ObjectId(id));
    const v2Filter = { 'entries.recipeId': { $in: recipeObjectIds } };
    if (beforeDate) {
      v2Filter.date = { $lt: beforeDate };
    }

    const [recentV2] = await this.CookingCalendarV2Model.aggregate([
      { $match: v2Filter },
      { $unwind: '$entries' },
      { $match: { 'entries.recipeId': { $in: recipeObjectIds } } },
      { $sort: { date: -1 } },
      { $limit: 1 },
      { $project: { date: 1 } },
    ]).exec();

    const v2Date = recentV2 ? recentV2.date : null;
    const v1Filter = {
      $or: [
        { lunchToCook: { $in: allRecipeIds } },
        { dinnerToCook: { $in: allRecipeIds } },
        { dessertToCook: { $in: allRecipeIds } },
      ],
    };
    if (beforeDate) {
      v1Filter.date = { $lt: beforeDate };
    }

    const recentV1 = await this.CookingCalendarModel.findOne(v1Filter).sort({ date: -1 }).lean();
    const v1Date = recentV1 ? recentV1.date : null;

    if (v2Date && v1Date) {
      return v2Date > v1Date ? v2Date : v1Date;
    }
    return v2Date || v1Date || null;
  }

  async addEntry({ date, recipeId, category, force = false }) {
    if (!this.isValidDate(date)) {
      throw new Error('Invalid date supplied. Expected YYYY-MM-DD.');
    }
    if (!isValidObjectId(recipeId)) {
      throw new Error('Invalid recipe id provided.');
    }

    const recipe = await this.resolveCanonicalRecipe(recipeId);
    if (!recipe) {
      throw new Error('Recipe not found.');
    }

    const aliasIds = recipe.aliasIds.filter(id => id !== recipe.id);
    const lastCookedBefore = await this.getLastCookedDate(recipe.id, date, aliasIds);

    if (lastCookedBefore) {
      const lastCookedDate = this.parseDate(lastCookedBefore);
      const targetDate = this.parseDate(date);
      const diffDays = Math.floor((targetDate.getTime() - lastCookedDate.getTime()) / MS_PER_DAY);
      if (diffDays >= 0 && diffDays < DAYS_WARNING_WINDOW && !force) {
        return {
          status: 'warning',
          warning: {
            lastCookedDate: lastCookedBefore,
            daysSince: diffDays,
          },
        };
      }
    }

    const entry = {
      _id: new Types.ObjectId(),
      recipeId: new Types.ObjectId(recipe.id),
      category: this.normalizeCategory(category),
      addedAt: new Date(),
    };

    const updatedDay = await this.CookingCalendarV2Model.findOneAndUpdate(
      { date },
      { $push: { entries: entry } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    if (!updatedDay) {
      logger.error('Failed to insert calendar entry', { category: 'cooking-calendar' });
      throw new Error('Unable to save calendar entry.');
    }

    return {
      status: 'created',
      entry: {
        entryId: entry._id.toString(),
        recipeId: recipe.id,
        category: entry.category,
        addedAt: entry.addedAt.toISOString(),
        recipe: {
          id: recipe.id,
          title: recipe.title,
          image: Array.isArray(recipe.images) && recipe.images.length > 0 ? recipe.images[0] : null,
          source: recipe.source,
          viewPath: recipe.viewPath,
        },
      },
    };
  }

  async removeEntry({ date, entryId }) {
    if (!this.isValidDate(date)) {
      throw new Error('Invalid date supplied. Expected YYYY-MM-DD.');
    }
    if (!isValidObjectId(entryId)) {
      throw new Error('Invalid entry id provided.');
    }

    const result = await this.CookingCalendarV2Model.findOneAndUpdate(
      { date },
      { $pull: { entries: { _id: new Types.ObjectId(entryId) } } },
      { new: true },
    ).lean();

    if (!result) {
      return { removed: false };
    }

    return {
      removed: true,
      remainingEntries: (result.entries || []).length,
    };
  }

  async getStatistics() {
    const [library, usageMap] = await Promise.all([
      this.getUnifiedRecipeLibrary(),
      this.buildUsageMap(),
    ]);

    const rows = library.recipes.map((recipe) => {
      const usage = this.serializeUsage(this.buildMergedUsageForRecipe(recipe, usageMap));
      return {
        recipeId: recipe.id,
        title: recipe.title,
        source: recipe.source,
        originKnowledgeId: recipe.originKnowledgeId,
        viewPath: recipe.viewPath,
        usage,
      };
    });

    rows.sort((a, b) => {
      if (b.usage.countLast90Days !== a.usage.countLast90Days) {
        return b.usage.countLast90Days - a.usage.countLast90Days;
      }
      if (a.title.toLowerCase() < b.title.toLowerCase()) return -1;
      if (a.title.toLowerCase() > b.title.toLowerCase()) return 1;
      return 0;
    });

    return rows;
  }
}

module.exports = CookingCalendarService;
