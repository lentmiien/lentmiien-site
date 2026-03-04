const { Types } = require('mongoose');
const CookingCalendarService = require('../../services/cookingCalendarService');

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const createLeanChain = (result) => ({
  sort: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(result)
  }),
  lean: jest.fn().mockResolvedValue(result)
});

const createAggregate = (result) => ({
  exec: jest.fn().mockResolvedValue(result)
});

describe('CookingCalendarService', () => {
  let CookingCalendarModel;
  let CookingCalendarV2Model;
  let CookbookRecipeModel;
  let Chat4KnowledgeModel;
  let service;

  beforeEach(() => {
    CookingCalendarModel = {
      aggregate: jest.fn(),
      findOne: jest.fn()
    };

    CookingCalendarV2Model = {
      aggregate: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn()
    };

    CookbookRecipeModel = {
      find: jest.fn(),
      findOne: jest.fn()
    };

    Chat4KnowledgeModel = {
      find: jest.fn(),
      findOne: jest.fn()
    };

    service = new CookingCalendarService({
      CookingCalendarModel,
      CookingCalendarV2Model,
      Chat4KnowledgeModel,
      CookbookRecipeModel
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('isValidDate validates YYYY-MM-DD format', () => {
    expect(service.isValidDate('2024-05-10')).toBe(true);
    expect(service.isValidDate('2024-5-1')).toBe(false);
    expect(service.isValidDate(123)).toBe(false);
  });

  test('parseDate returns date object and rejects invalid', () => {
    const result = service.parseDate('2024-02-20');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-02-20T00:00:00.000Z');

    expect(() => service.parseDate('invalid')).toThrow('Invalid date format');
  });

  test('createDateRange returns inclusive sequence and errors on inverted range', () => {
    expect(service.createDateRange('2024-01-01', '2024-01-03')).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(() => service.createDateRange('2024-01-05', '2024-01-01')).toThrow('Start date must not be after end date.');
  });

  test('normalizeCategory returns canonical value', () => {
    expect(service.normalizeCategory(' lunch ')).toBe('Lunch');
    expect(service.normalizeCategory('')).toBe('Other');
    expect(service.normalizeCategory('new category')).toBe('New category');
  });

  test('serializeUsage formats missing fields and date', () => {
    const usage = {
      totalCount: 3,
      countLast90Days: 2,
      countPrev90Days: 1,
      existInLast10Days: 0,
      lastCookedDate: new Date('2024-01-01T00:00:00Z')
    };
    expect(service.serializeUsage(usage)).toEqual({
      totalCount: 3,
      countLast90Days: 2,
      countPrev90Days: 1,
      existInLast10Days: false,
      lastCookedDate: '2024-01-01'
    });
    expect(service.serializeUsage()).toEqual({
      totalCount: 0,
      countLast90Days: 0,
      countPrev90Days: 0,
      existInLast10Days: false,
      lastCookedDate: null
    });
  });

  test('getRecipeLibraryWithUsage prefers cookbook entries and removes transitioned legacy duplicates', async () => {
    const cookbookId = new Types.ObjectId().toString();
    const transitionedKnowledgeId = new Types.ObjectId().toString();
    const fallbackKnowledgeId = new Types.ObjectId().toString();

    const cookbookDocs = [
      {
        _id: { toString: () => cookbookId },
        title: 'Apple Pie',
        images: ['img1'],
        originKnowledgeId: transitionedKnowledgeId
      }
    ];
    const recipeDocs = [
      { _id: { toString: () => transitionedKnowledgeId }, title: 'Apple Pie (legacy)', images: ['old'] },
      { _id: { toString: () => fallbackKnowledgeId }, title: 'Bread', images: null }
    ];

    CookbookRecipeModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue(cookbookDocs)
    });
    Chat4KnowledgeModel.find.mockReturnValue(createLeanChain(recipeDocs));

    const usageMap = new Map([
      [cookbookId, { totalCount: 2, countLast90Days: 1, lastCookedDate: new Date('2024-03-01T00:00:00Z') }],
      [transitionedKnowledgeId, { totalCount: 1, countLast90Days: 1, lastCookedDate: new Date('2024-03-03T00:00:00Z') }]
    ]);
    const usageSpy = jest.spyOn(service, 'buildUsageMap').mockResolvedValue(usageMap);

    const result = await service.getRecipeLibraryWithUsage();

    expect(CookbookRecipeModel.find).toHaveBeenCalledWith({});
    expect(Chat4KnowledgeModel.find).toHaveBeenCalledWith({ category: 'Recipe' });
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: cookbookId,
        title: 'Apple Pie',
        images: ['img1'],
        source: 'cookbook',
        originKnowledgeId: transitionedKnowledgeId,
        viewPath: `/cooking/cookbook/${cookbookId}`,
        usage: {
          totalCount: 3,
          countLast90Days: 2,
          countPrev90Days: 0,
          existInLast10Days: false,
          lastCookedDate: '2024-03-03'
        }
      },
      {
        id: fallbackKnowledgeId,
        title: 'Bread',
        images: [],
        source: 'knowledge',
        originKnowledgeId: null,
        viewPath: `/chat4/viewknowledge/${fallbackKnowledgeId}`,
        usage: {
          totalCount: 0,
          countLast90Days: 0,
          countPrev90Days: 0,
          existInLast10Days: false,
          lastCookedDate: null
        }
      }
    ]);
  });

  test('buildUsageMap combines legacy and v2 aggregates', async () => {
    const oldUsage = [
      {
        _id: { toString: () => 'id1' },
        totalCount: 1,
        countLast90Days: 1,
        countPrev90Days: 0,
        existInLast10Days: false,
        lastCookedDate: new Date('2024-01-01T00:00:00Z')
      }
    ];
    const newUsage = [
      {
        _id: { toString: () => 'id1' },
        totalCount: 2,
        countLast90Days: 0,
        countPrev90Days: 1,
        existInLast10Days: true,
        lastCookedDate: new Date('2024-04-01T00:00:00Z')
      },
      {
        _id: { toString: () => 'id2' },
        totalCount: 4,
        countLast90Days: 3,
        countPrev90Days: 0,
        existInLast10Days: false,
        lastCookedDate: new Date('2024-02-01T00:00:00Z')
      }
    ];
    CookingCalendarModel.aggregate.mockReturnValue(createAggregate(oldUsage));
    CookingCalendarV2Model.aggregate.mockReturnValue(createAggregate(newUsage));

    const map = await service.buildUsageMap();

    expect(map.get('id1')).toEqual({
      totalCount: 3,
      countLast90Days: 1,
      countPrev90Days: 1,
      existInLast10Days: true,
      lastCookedDate: new Date('2024-04-01T00:00:00Z')
    });
    expect(map.get('id2')).toEqual({
      totalCount: 4,
      countLast90Days: 3,
      countPrev90Days: 0,
      existInLast10Days: false,
      lastCookedDate: new Date('2024-02-01T00:00:00Z')
    });
  });

  test('getCalendarRange returns normalized day data', async () => {
    const recipeId = new Types.ObjectId();
    CookbookRecipeModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([])
    });
    CookingCalendarV2Model.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          date: '2024-05-01',
          entries: [
            {
              _id: new Types.ObjectId(),
              recipeId,
              category: 'Lunch',
              addedAt: new Date('2024-05-01T12:00:00Z')
            }
          ]
        }
      ])
    });

    const knowledgeDoc = { _id: recipeId, title: 'Soup', images: ['img'] };
    Chat4KnowledgeModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([knowledgeDoc])
    });

    const usageMap = new Map([[recipeId.toString(), { totalCount: 1 }]]);
    jest.spyOn(service, 'buildUsageMap').mockResolvedValue(usageMap);

    const result = await service.getCalendarRange('2024-05-01', '2024-05-02');

    expect(result.range).toEqual({ start: '2024-05-01', end: '2024-05-02' });
    expect(result.categories).toEqual(service.getCategories());
    const day = result.days.find((d) => d.date === '2024-05-01');
    expect(day.weekday).toBe('Wednesday');
    expect(day.entries[0]).toEqual({
      entryId: day.entries[0].entryId,
      recipeId: recipeId.toString(),
      category: 'Lunch',
      addedAt: '2024-05-01T12:00:00.000Z',
      recipe: {
        id: recipeId.toString(),
        title: 'Soup',
        image: 'img',
        source: 'knowledge',
        viewPath: `/chat4/viewknowledge/${recipeId.toString()}`
      },
      usage: {
        totalCount: 1,
        countLast90Days: 0,
        countPrev90Days: 0,
        existInLast10Days: false,
        lastCookedDate: null
      }
    });
  });

  test('addEntry returns warning when recently cooked and not forced', async () => {
    const recipeId = new Types.ObjectId().toString();
    CookbookRecipeModel.findOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });
    Chat4KnowledgeModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: recipeId, title: 'Dish', images: [] })
    });
    jest.spyOn(service, 'getLastCookedDate').mockResolvedValue('2024-05-05');

    const result = await service.addEntry({
      date: '2024-05-08',
      recipeId,
      category: 'Lunch'
    });

    expect(result.status).toBe('warning');
    expect(result.warning).toEqual({
      lastCookedDate: '2024-05-05',
      daysSince: 3
    });
  });

  test('addEntry stores cookbook id when selected legacy knowledge has a transitioned cookbook recipe', async () => {
    const cookbookId = new Types.ObjectId().toString();
    const legacyKnowledgeId = new Types.ObjectId().toString();
    CookbookRecipeModel.findOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: { toString: () => cookbookId },
          title: 'Dish',
          images: ['img'],
          originKnowledgeId: legacyKnowledgeId
        })
      });

    jest.spyOn(service, 'getLastCookedDate').mockResolvedValue(null);

    const leanResult = { entries: [] };
    CookingCalendarV2Model.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(leanResult)
    });

    const result = await service.addEntry({
      date: '2024-05-20',
      recipeId: legacyKnowledgeId,
      category: 'dinner',
      force: true
    });

    expect(result.status).toBe('created');
    expect(result.entry.recipeId).toBe(cookbookId);
    expect(result.entry.category).toBe('Dinner');
    expect(result.entry.recipe).toEqual({
      id: cookbookId,
      title: 'Dish',
      image: 'img',
      source: 'cookbook',
      viewPath: `/cooking/cookbook/${cookbookId}`
    });
    expect(CookingCalendarV2Model.findOneAndUpdate).toHaveBeenCalled();
  });

  test('removeEntry validates inputs and returns removal stats', async () => {
    const entryId = new Types.ObjectId().toString();
    const leanResult = { entries: [{}, {}] };
    CookingCalendarV2Model.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(leanResult)
    });

    const result = await service.removeEntry({ date: '2024-05-01', entryId });

    expect(result).toEqual({ removed: true, remainingEntries: 2 });
    await expect(service.removeEntry({ date: 'invalid', entryId })).rejects.toThrow('Invalid date supplied');
  });

  test('getLastCookedDate compares legacy and new data', async () => {
    const recipeId = new Types.ObjectId().toString();
    CookingCalendarV2Model.aggregate.mockReturnValue(createAggregate([{ date: '2024-03-01' }]));
    CookingCalendarModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ date: '2024-04-01' })
      })
    });

    const result = await service.getLastCookedDate(recipeId);

    expect(result).toBe('2024-04-01');
    await expect(service.getLastCookedDate('not-an-id')).rejects.toThrow('Invalid recipe id.');
  });

  test('getStatistics joins cookbook and legacy usage for transitioned recipes', async () => {
    const cookbookId = new Types.ObjectId().toString();
    const legacyKnowledgeId = new Types.ObjectId().toString();
    const standaloneKnowledgeId = new Types.ObjectId().toString();

    CookbookRecipeModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: { toString: () => cookbookId },
          title: 'Curry',
          images: [],
          originKnowledgeId: legacyKnowledgeId
        }
      ])
    });
    Chat4KnowledgeModel.find.mockReturnValue(createLeanChain([
      { _id: { toString: () => legacyKnowledgeId }, title: 'Curry (legacy)', images: [] },
      { _id: { toString: () => standaloneKnowledgeId }, title: 'Toast', images: [] }
    ]));
    jest.spyOn(service, 'buildUsageMap').mockResolvedValue(new Map([
      [cookbookId, { totalCount: 1, countLast90Days: 1 }],
      [legacyKnowledgeId, { totalCount: 2, countLast90Days: 2 }],
      [standaloneKnowledgeId, { totalCount: 1, countLast90Days: 1 }]
    ]));

    const stats = await service.getStatistics();
    const curry = stats.find((item) => item.recipeId === cookbookId);
    const toast = stats.find((item) => item.recipeId === standaloneKnowledgeId);

    expect(stats).toHaveLength(2);
    expect(curry).toEqual({
      recipeId: cookbookId,
      title: 'Curry',
      source: 'cookbook',
      originKnowledgeId: legacyKnowledgeId,
      viewPath: `/cooking/cookbook/${cookbookId}`,
      usage: {
        totalCount: 3,
        countLast90Days: 3,
        countPrev90Days: 0,
        existInLast10Days: false,
        lastCookedDate: null
      }
    });
    expect(toast).toEqual({
      recipeId: standaloneKnowledgeId,
      title: 'Toast',
      source: 'knowledge',
      originKnowledgeId: null,
      viewPath: `/chat4/viewknowledge/${standaloneKnowledgeId}`,
      usage: {
        totalCount: 1,
        countLast90Days: 1,
        countPrev90Days: 0,
        existInLast10Days: false,
        lastCookedDate: null
      }
    });
  });
});
