
const { Types, isValidObjectId } = require('mongoose');
const logger = require('../utils/logger');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_WARNING_WINDOW = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

class CookingCalendarService {
  constructor({ CookingCalendarModel, CookingCalendarV2Model, Chat4KnowledgeModel }) {
    this.CookingCalendarModel = CookingCalendarModel;
    this.CookingCalendarV2Model = CookingCalendarV2Model;
    this.Chat4KnowledgeModel = Chat4KnowledgeModel;
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

  async getRecipeLibraryWithUsage() {
    const [recipes, usageMap] = await Promise.all([
      this.Chat4KnowledgeModel.find({ category: 'Recipe' }).sort({ title: 1 }).lean(),
      this.buildUsageMap(),
    ]);

    return recipes.map(recipe => {
      const key = recipe._id.toString();
      return {
        id: key,
        title: recipe.title,
        images: Array.isArray(recipe.images) ? recipe.images : [],
        usage: this.serializeUsage(usageMap.get(key)),
      };
    });
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
      const key = id.toString();
      const existing = usageMap.get(key) || this.emptyUsage();
      const next = {
        totalCount: (existing.totalCount || 0) + (payload.totalCount || 0),
        countLast90Days: (existing.countLast90Days || 0) + (payload.countLast90Days || 0),
        countPrev90Days: (existing.countPrev90Days || 0) + (payload.countPrev90Days || 0),
        existInLast10Days: Boolean(existing.existInLast10Days || payload.existInLast10Days),
        lastCookedDate: existing.lastCookedDate && payload.lastCookedDate
          ? (existing.lastCookedDate > payload.lastCookedDate ? existing.lastCookedDate : payload.lastCookedDate)
          : (existing.lastCookedDate || payload.lastCookedDate || null),
      };
      usageMap.set(key, next);
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
    const docs = await this.CookingCalendarV2Model.find({
      date: { $gte: startDate, $lte: endDate },
    }).lean();

    const recipeIds = new Set();
    docs.forEach(doc => {
      (doc.entries || []).forEach(entry => {
        if (entry.recipeId) {
          recipeIds.add(entry.recipeId.toString());
        }
      });
    });

    const [knowledge, usageMap] = await Promise.all([
      recipeIds.size > 0
        ? this.Chat4KnowledgeModel.find({ _id: { $in: Array.from(recipeIds, id => new Types.ObjectId(id)) } }).lean()
        : [],
      this.buildUsageMap(),
    ]);

    const knowledgeMap = new Map(knowledge.map(k => [k._id.toString(), k]));

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
        const key = entry.recipeId ? entry.recipeId.toString() : null;
        const knowledgeEntry = key ? knowledgeMap.get(key) : null;
        const usage = key ? this.serializeUsage(usageMap.get(key)) : this.serializeUsage();
        day.entries.push({
          entryId: entry._id.toString(),
          recipeId: key,
          category: entry.category,
          addedAt: entry.addedAt ? new Date(entry.addedAt).toISOString() : null,
          recipe: knowledgeEntry ? {
            id: key,
            title: knowledgeEntry.title,
            image: Array.isArray(knowledgeEntry.images) && knowledgeEntry.images.length > 0 ? knowledgeEntry.images[0] : null,
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

  async getLastCookedDate(recipeId, beforeDate) {
    if (!isValidObjectId(recipeId)) {
      throw new Error('Invalid recipe id.');
    }
    const recipeObjectId = new Types.ObjectId(recipeId);

    if (beforeDate && !this.isValidDate(beforeDate)) {
      throw new Error('Invalid date format for lookup. Expected YYYY-MM-DD.');
    }

    const v2Filter = { 'entries.recipeId': recipeObjectId };
    if (beforeDate) {
      v2Filter.date = { $lt: beforeDate };
    }

    const [recentV2] = await this.CookingCalendarV2Model.aggregate([
      { $match: v2Filter },
      { $unwind: '$entries' },
      { $match: { 'entries.recipeId': recipeObjectId } },
      { $sort: { date: -1 } },
      { $limit: 1 },
      { $project: { date: 1 } },
    ]).exec();

    const v2Date = recentV2 ? recentV2.date : null;

    const v1Filter = {
      $or: [
        { lunchToCook: recipeId },
        { dinnerToCook: recipeId },
        { dessertToCook: recipeId },
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

    const [recipe, lastCookedBefore] = await Promise.all([
      this.Chat4KnowledgeModel.findOne({ _id: recipeId }).lean(),
      this.getLastCookedDate(recipeId, date),
    ]);

    if (!recipe) {
      throw new Error('Recipe not found.');
    }

    let warning = null;
    if (lastCookedBefore) {
      const lastCookedDate = this.parseDate(lastCookedBefore);
      const targetDate = this.parseDate(date);
      const diffDays = Math.floor((targetDate.getTime() - lastCookedDate.getTime()) / MS_PER_DAY);
      if (diffDays >= 0 && diffDays < DAYS_WARNING_WINDOW && !force) {
        warning = {
          lastCookedDate: lastCookedBefore,
          daysSince: diffDays,
        };
        return { status: 'warning', warning };
      }
    }

    const entry = {
      _id: new Types.ObjectId(),
      recipeId: new Types.ObjectId(recipeId),
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
        recipeId: recipeId.toString(),
        category: entry.category,
        addedAt: entry.addedAt.toISOString(),
        recipe: {
          id: recipe._id.toString(),
          title: recipe.title,
          image: Array.isArray(recipe.images) && recipe.images.length > 0 ? recipe.images[0] : null,
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
    const [recipes, usageMap] = await Promise.all([
      this.Chat4KnowledgeModel.find({ category: 'Recipe' }).lean(),
      this.buildUsageMap(),
    ]);

    const rows = recipes.map(recipe => {
      const key = recipe._id.toString();
      const usage = this.serializeUsage(usageMap.get(key));
      return {
        recipeId: key,
        title: recipe.title,
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
