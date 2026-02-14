const { Task, ESCategory, ESItem, CookingCalendarV2Model, Chat4KnowledgeModel } = require('../database');
const logger = require('../utils/logger');

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

    const [toBuyTasks, categories, items, calendarDocs] = await Promise.all([
      Task.find({
        userId,
        type: 'tobuy',
        done: false,
        $or: [{ start: null }, { start: { $lte: todayEnd } }],
      }).sort({ start: 1, createdAt: 1 }).lean(),
      ESCategory.find({}).lean(),
      ESItem.find({}).lean(),
      CookingCalendarV2Model.find({ date: { $in: buildDateRange(todayStart, COOKING_RANGE_DAYS) } }).lean(),
    ]);

    const toBuyData = (toBuyTasks || []).map(task => ({
      id: task._id.toString(),
      title: task.title,
      description: task.description || '',
      start: task.start ? task.start.toISOString() : null,
    }));

    const stockByCategory = {};
    (items || []).forEach(item => {
      if (!item.rotateDate || item.rotateDate < now) {
        return;
      }
      const key = String(item.categoryId);
      const amount = Number(item.amount) || 0;
      stockByCategory[key] = (stockByCategory[key] || 0) + amount;
    });

    const emergencyStock = (categories || []).reduce((acc, category) => {
      const key = category._id.toString();
      const currentStock = stockByCategory[key] || 0;
      const recommended = Number(category.recommendedStock) || 0;
      const remaining = recommended - currentStock;
      if (remaining > 0) {
        acc.push({
          id: key,
          name: category.name,
          unit: category.unit,
          recommendedStock: recommended,
          currentStock,
          remaining,
        });
      }
      return acc;
    }, []);

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
    if (recipeIds.size > 0) {
      const knowledge = await Chat4KnowledgeModel.find({
        _id: { $in: Array.from(recipeIds) },
      }).lean();
      knowledgeLookup = knowledge.reduce((acc, item) => {
        acc[item._id.toString()] = item;
        return acc;
      }, {});
    }

    const cookingEntries = calendarEntries.map(entry => {
      const knowledge = entry.recipeId ? knowledgeLookup[entry.recipeId] : null;
      return {
        id: entry.id,
        date: entry.date,
        category: entry.category,
        recipeId: entry.recipeId,
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
