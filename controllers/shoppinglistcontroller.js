const {
  Task,
  ESCategory,
  ESItem,
  ESProfile,
  ESShoppingRequirement,
  CookingCalendarV2Model,
  Chat4KnowledgeModel,
  CookbookRecipeModel,
} = require('../database');
const logger = require('../utils/logger');
const { buildShoppingRequirements } = require('../services/emergencyStockService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COOKING_RANGE_DAYS = 6;

function formatDateLocal(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDateRange(startDate, days) {
  const dates = [];
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(startDate.getTime() + i * MS_PER_DAY);
    dates.push(formatDateLocal(d));
  }
  return dates;
}

exports.shopping_list = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + MS_PER_DAY - 1);
    const todayLabel = formatDateLocal(todayStart);

    const userId = req.user.name;

    const [toBuyTasks, categories, items, profile, stockRequirements, calendarDocs] = await Promise.all([
      Task.find({
        userId,
        type: 'tobuy',
        done: false,
        $or: [{ start: null }, { start: { $lte: todayEnd } }],
      }).sort({ start: 1, createdAt: 1 }).lean(),
      ESCategory.find({}).lean(),
      ESItem.find({}).lean(),
      ESProfile.findOne({ key: 'household' }).lean(),
      ESShoppingRequirement.find({ status: { $in: ['needed', 'planned', 'purchased'] } }).lean(),
      CookingCalendarV2Model.find({ date: { $in: buildDateRange(todayStart, COOKING_RANGE_DAYS) } }).lean(),
    ]);

    const toBuyData = (toBuyTasks || []).map(task => ({
      id: task._id.toString(),
      title: task.title,
      description: task.description || '',
      start: task.start ? task.start.toISOString() : null,
    }));

    const emergencyStock = buildShoppingRequirements({
      categories: categories || [],
      items: items || [],
      profile: profile || {},
      existingRequirements: stockRequirements || [],
      now,
    })
      .filter(requirement => ['needed', 'planned'].includes(requirement.status))
      .map(requirement => ({
        id: requirement.fingerprint,
        requirementId: stockRequirements.find(saved => saved.fingerprint === requirement.fingerprint)?._id?.toString() || null,
        name: requirement.label,
        unit: requirement.unit,
        recommendedStock: requirement.targetAmount,
        currentStock: requirement.currentAmount,
        remaining: requirement.requiredAmount,
        reason: requirement.reason,
        status: requirement.status,
        dueDate: requirement.dueDate ? requirement.dueDate.toISOString() : null,
      }));

    const calendarEntries = [];
    const recipeIds = new Set();
    (calendarDocs || []).forEach(doc => {
      (doc.entries || []).forEach(entry => {
        const recipeId = entry.recipeId ? entry.recipeId.toString() : null;
        if (recipeId) {
          recipeIds.add(recipeId);
        }
        calendarEntries.push({
          id: entry._id ? entry._id.toString() : `${doc.date}-${recipeId || entry.category}`,
          date: doc.date,
          category: entry.category || 'Other',
          recipeId,
        });
      });
    });

    let knowledgeLookup = {};
    let cookbookLookup = {};
    if (recipeIds.size > 0) {
      const [knowledge, cookbook] = await Promise.all([
        Chat4KnowledgeModel.find({
          _id: { $in: Array.from(recipeIds) },
        }).lean(),
        CookbookRecipeModel.find({
          _id: { $in: Array.from(recipeIds) },
        }).lean(),
      ]);

      knowledgeLookup = knowledge.reduce((acc, item) => {
        acc[item._id.toString()] = item;
        return acc;
      }, {});

      cookbookLookup = cookbook.reduce((acc, item) => {
        acc[item._id.toString()] = item;
        return acc;
      }, {});
    }

    const cookingEntries = calendarEntries.map(entry => {
      const cookbook = entry.recipeId ? cookbookLookup[entry.recipeId] : null;
      if (cookbook) {
        return {
          id: entry.id,
          date: entry.date,
          category: entry.category,
          recipeId: entry.recipeId,
          source: 'cookbook',
          title: cookbook.title || 'Unknown recipe',
          contentMarkdown: '',
          portions: Number.isFinite(cookbook.portions) ? cookbook.portions : null,
          ingredients: Array.isArray(cookbook.ingredients)
            ? cookbook.ingredients.map((ingredient, index) => ({
              id: `${entry.id}-ingredient-${index}`,
              label: ingredient.ingredient_label || `Ingredient ${index + 1}`,
              amount: Number.isFinite(ingredient.amount) ? ingredient.amount : null,
              unit: ingredient.amount_unit || '',
              amountInGram: Number.isFinite(ingredient.amount_in_gram) ? ingredient.amount_in_gram : null,
            }))
            : [],
          optionalVariants: Array.isArray(cookbook.suggestions)
            ? cookbook.suggestions
              .map((variant, index) => ({
                id: `${entry.id}-variant-${index}`,
                label: variant && variant.label ? String(variant.label).trim() : '',
                details: variant && variant.details ? String(variant.details).trim() : '',
              }))
              .filter((variant) => variant.label || variant.details)
            : [],
        };
      }

      const knowledge = entry.recipeId ? knowledgeLookup[entry.recipeId] : null;
      return {
        id: entry.id,
        date: entry.date,
        category: entry.category,
        recipeId: entry.recipeId,
        source: 'knowledge',
        title: knowledge ? knowledge.title : 'Unknown recipe',
        contentMarkdown: knowledge ? knowledge.contentMarkdown : '',
      };
    }).sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.title.localeCompare(b.title);
    });

    res.render('shopping_list', {
      shoppingData: {
        meta: {
          today: todayLabel,
          generatedAt: now.toISOString(),
          rangeDays: COOKING_RANGE_DAYS + 1,
        },
        toBuyTasks: toBuyData,
        emergencyStock,
        cookingEntries,
      },
    });
  } catch (error) {
    logger.error('Failed to load unified shopping list', {
      category: 'shopping-list',
      metadata: { error: error.message },
    });
    res.status(500).send('Unable to load the shopping list.');
  }
};
