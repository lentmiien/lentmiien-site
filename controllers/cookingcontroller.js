
const { CookingCalendarModel, CookingCalendarV2Model, Chat4KnowledgeModel } = require('../database');
const CookingCalendarService = require('../services/cookingCalendarService');
const logger = require('../utils/logger');

const cookingCalendarService = new CookingCalendarService({
  CookingCalendarModel,
  CookingCalendarV2Model,
  Chat4KnowledgeModel,
});

// ----- Legacy v1 routes -----
exports.index = async (req, res) => {
  try {
    const datesArray = createDatesArray();
    const datesOnly = datesArray.map(d => d.date);
    const [calendarDocs, knowledge] = await Promise.all([
      CookingCalendarModel.find({ date: datesOnly }),
      Chat4KnowledgeModel.find({ category: 'Recipe' }),
    ]);

    knowledge.sort(compareByTitle);
    const knowledgeLookup = knowledge.map(k => k._id.toString());

    const cookingCalendar = buildLegacyCalendar(datesArray, calendarDocs, knowledge, knowledgeLookup);
    res.render('cooking_index_v1', { cookingCalendar, knowledge });
  } catch (error) {
    logger.error('Failed to load cooking calendar (v1)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).send('Unable to load cooking calendar.');
  }
};

exports.edit_date = async (req, res) => {
  try {
    const requestedDate = req.query.date;
    let baseDate = requestedDate ? new Date(requestedDate) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      baseDate = new Date();
    }

    const datesArray = [{ date: formatDate(baseDate), day: baseDate.getDay() }];
    const dateKeys = datesArray.map(d => d.date);
    const [calendarDocs, knowledge] = await Promise.all([
      CookingCalendarModel.find({ date: dateKeys }),
      Chat4KnowledgeModel.find({ category: 'Recipe' }),
    ]);

    knowledge.sort(compareByTitle);
    const knowledgeLookup = knowledge.map(k => k._id.toString());
    const cookingCalendar = buildLegacyCalendar(datesArray, calendarDocs, knowledge, knowledgeLookup);

    res.render('cooking_index_v1', { cookingCalendar, knowledge });
  } catch (error) {
    logger.error('Failed to load cooking calendar edit (v1)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).send('Unable to load requested date.');
  }
};

exports.update_cooking_calendar = async (req, res) => {
  try {
    const entryToUpdate = await CookingCalendarModel.find({ date: req.body.date });
    if (entryToUpdate.length === 0) {
      const data = {
        date: req.body.date,
        lunchToCook: req.body.lunch ? req.body.lunch : '',
        dinnerToCook: req.body.dinner ? req.body.dinner : '',
        dessertToCook: req.body.dessert ? req.body.dessert : '',
      };
      const entry = await new CookingCalendarModel(data).save();
      return res.json({ status: 'OK', msg: `${entry._id.toString()} (${req.body.date}): entry saved!` });
    }

    if (req.body.lunch !== undefined) {
      entryToUpdate[0].lunchToCook = req.body.lunch;
    }
    if (req.body.dinner !== undefined) {
      entryToUpdate[0].dinnerToCook = req.body.dinner;
    }
    if (req.body.dessert !== undefined) {
      entryToUpdate[0].dessertToCook = req.body.dessert;
    }
    await entryToUpdate[0].save();
    return res.json({ status: 'OK', msg: `${entryToUpdate[0]._id.toString()} (${req.body.date}): entry updated!` });
  } catch (error) {
    logger.error('Failed to update cooking calendar (v1)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).json({ status: 'ERROR', msg: 'Unable to update entry.' });
  }
};

exports.cooking_statistics = async (req, res) => {
  try {
    const stats = await getCookingStatisticsLegacy();
    const knowledge = await Chat4KnowledgeModel.find({ category: 'Recipe' });
    const knowledge_lookup = {};
    const knowledge_lookup_used = {};
    knowledge.forEach(k => {
      knowledge_lookup[k._id.toString()] = k.title;
      knowledge_lookup_used[k._id.toString()] = false;
    });

    res.render('cooking_statistics_v1', { stats, knowledge_lookup, knowledge_lookup_used });
  } catch (error) {
    logger.error('Failed to load cooking statistics (v1)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).send('Unable to load cooking statistics.');
  }
};

// ----- Version 2 routes -----
exports.indexV2 = (req, res) => {
  const today = cookingCalendarService.formatDate(new Date());
  res.render('cooking_index', {
    initialDate: today,
    categories: cookingCalendarService.getCategories(),
  });
};

exports.calendarV2 = async (req, res) => {
  try {
    const start = req.query.start || cookingCalendarService.formatDate(new Date());
    let end = req.query.end;
    if (!end) {
      const days = Number.parseInt(req.query.days, 10);
      const daysToShow = Number.isFinite(days) && days >= 0 ? days : 6;
      const startDate = cookingCalendarService.parseDate(start);
      end = cookingCalendarService.formatDate(cookingCalendarService.addDays(startDate, daysToShow));
    }

    const data = await cookingCalendarService.getCalendarRange(start, end);
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch cooking calendar (v2)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(400).json({ error: error.message });
  }
};

exports.recipesV2 = async (req, res) => {
  try {
    const recipes = await cookingCalendarService.getRecipeLibraryWithUsage();
    res.json({
      categories: cookingCalendarService.getCategories(),
      recipes,
    });
  } catch (error) {
    logger.error('Failed to fetch recipes (v2)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).json({ error: 'Unable to load recipes.' });
  }
};

exports.createEntryV2 = async (req, res) => {
  try {
    const { date, recipeId, category, force } = req.body || {};
    const result = await cookingCalendarService.addEntry({ date, recipeId, category, force });
    const statusCode = result.status === 'created' ? 201 : 200;
    res.status(statusCode).json(result);
  } catch (error) {
    logger.error('Failed to create calendar entry (v2)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(400).json({ error: error.message });
  }
};

exports.deleteEntryV2 = async (req, res) => {
  try {
    const { date, entryId } = req.params;
    const result = await cookingCalendarService.removeEntry({ date, entryId });
    if (!result.removed) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    return res.json(result);
  } catch (error) {
    logger.error('Failed to delete calendar entry (v2)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(400).json({ error: error.message });
  }
};

exports.statisticsDataV2 = async (req, res) => {
  try {
    const stats = await cookingCalendarService.getStatistics();
    res.json({ stats });
  } catch (error) {
    logger.error('Failed to fetch cooking statistics data (v2)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).json({ error: 'Unable to load cooking statistics.' });
  }
};

exports.cooking_statistics_v2 = async (req, res) => {
  try {
    const stats = await cookingCalendarService.getStatistics();
    res.render('cooking_statistics', { stats });
  } catch (error) {
    logger.error('Failed to load cooking statistics (v2)', { category: 'cooking-calendar', metadata: { error: error.message } });
    res.status(500).send('Unable to load cooking statistics.');
  }
};

// ----- Helper functions -----
function compareByTitle(a, b) {
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  return 0;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDatesArray() {
  const datesArray = [];
  const today = new Date();

  for (let i = 0; i < 7; i += 1) {
    const currentDate = new Date(today);
    currentDate.setDate(today.getDate() + i);
    datesArray.push({ date: formatDate(currentDate), day: currentDate.getDay() });
  }

  return datesArray;
}

function buildLegacyCalendar(datesArray, calendarDocs, knowledge, knowledgeLookup) {
  const cookingCalendar = datesArray.map(date => ({
    date: date.date,
    day: date.day,
    lunch: {
      name: 'not set',
      is_url: false,
      knowledge_id: '',
      image: '',
    },
    dinner: {
      name: 'not set',
      is_url: false,
      knowledge_id: '',
      image: '',
    },
    dessert: {
      name: 'not set',
      is_url: false,
      knowledge_id: '',
      image: '',
    },
  }));

  const datesOnly = datesArray.map(d => d.date);

  calendarDocs.forEach(doc => {
    const index = datesOnly.indexOf(doc.date);
    if (index === -1) {
      return;
    }

    const lunchIndex = knowledgeLookup.indexOf(doc.lunchToCook);
    if (lunchIndex >= 0) {
      cookingCalendar[index].lunch.name = knowledge[lunchIndex].title;
      cookingCalendar[index].lunch.knowledge_id = doc.lunchToCook;
      cookingCalendar[index].lunch.image = knowledge[lunchIndex].images.length > 0 ? knowledge[lunchIndex].images[0] : null;
    } else if (doc.lunchToCook && doc.lunchToCook.length > 0) {
      cookingCalendar[index].lunch.name = doc.lunchToCook;
      cookingCalendar[index].lunch.is_url = true;
    }

    const dinnerIndex = knowledgeLookup.indexOf(doc.dinnerToCook);
    if (dinnerIndex >= 0) {
      cookingCalendar[index].dinner.name = knowledge[dinnerIndex].title;
      cookingCalendar[index].dinner.knowledge_id = doc.dinnerToCook;
      cookingCalendar[index].dinner.image = knowledge[dinnerIndex].images.length > 0 ? knowledge[dinnerIndex].images[0] : null;
    } else if (doc.dinnerToCook && doc.dinnerToCook.length > 0) {
      cookingCalendar[index].dinner.name = doc.dinnerToCook;
      cookingCalendar[index].dinner.is_url = true;
    }

    const dessertIndex = knowledgeLookup.indexOf(doc.dessertToCook);
    if (dessertIndex >= 0) {
      cookingCalendar[index].dessert.name = knowledge[dessertIndex].title;
      cookingCalendar[index].dessert.knowledge_id = doc.dessertToCook;
      cookingCalendar[index].dessert.image = knowledge[dessertIndex].images.length > 0 ? knowledge[dessertIndex].images[0] : null;
    } else if (doc.dessertToCook && doc.dessertToCook.length > 0) {
      cookingCalendar[index].dessert.name = doc.dessertToCook;
      cookingCalendar[index].dessert.is_url = true;
    }
  });

  return cookingCalendar;
}

async function getCookingStatisticsLegacy() {
  try {
    const today = new Date();

    const subtractDays = (date, days) => {
      const result = new Date(date);
      result.setDate(result.getDate() - days);
      return result;
    };

    const last10Start = subtractDays(today, 10);
    const last90Start = subtractDays(today, 90);
    const last180Start = subtractDays(today, 180);

    const pipeline = [
      {
        $project: {
          date: 1,
          cookingItems: {
            $filter: {
              input: ['$dinnerToCook', '$lunchToCook', '$dessertToCook'],
              as: 'item',
              cond: { $ne: ['$$item', null] },
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
            },
          },
        },
      },
      {
        $group: {
          _id: '$cookingItems',
          totalCount: { $sum: 1 },
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
      {
        $project: {
          uniqueString: '$_id',
          _id: 0,
          existInLast10Days: 1,
          countLast90Days: 1,
          countPrev90Days: 1,
          totalCount: 1,
        },
      },
      { $sort: { countLast90Days: -1 } },
    ];

    const results = await CookingCalendarModel.aggregate(pipeline).exec();
    return results;
  } catch (error) {
    logger.error('Error fetching cooking statistics (v1)', { category: 'cooking-calendar', metadata: { error } });
    throw error;
  }
}
