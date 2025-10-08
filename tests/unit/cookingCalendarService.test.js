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

    Chat4KnowledgeModel = {
      find: jest.fn(),
      findOne: jest.fn()
    };

    service = new CookingCalendarService({ CookingCalendarModel, CookingCalendarV2Model, Chat4KnowledgeModel });
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

  test('getRecipeLibraryWithUsage merges recipe info with usage map', async () => {
    const recipeDocs = [
      { _id: { toString: () => 'id1' }, title: 'Apple Pie', images: ['img1'] },
      { _id: { toString: () => 'id2' }, title: 'Bread', images: null }
    ];
    Chat4KnowledgeModel.find.mockReturnValue(createLeanChain(recipeDocs));
    const usageMap = new Map([
      ['id1', { totalCount: 2, lastCookedDate: new Date('2024-03-01T00:00:00Z') }]
    ]);
    const usageSpy = jest.spyOn(service, 'buildUsageMap').mockResolvedValue(usageMap);

    const result = await service.getRecipeLibraryWithUsage();

    expect(Chat4KnowledgeModel.find).toHaveBeenCalledWith({ category: 'Recipe' });
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: 'id1',
        title: 'Apple Pie',
        images: ['img1'],
        usage: {
          totalCount: 2,
          countLast90Days: 0,
          countPrev90Days: 0,
          existInLast10Days: false,
          lastCookedDate: '2024-03-01'
        }
      },
      {
        id: 'id2',
        title: 'Bread',
        images: [],
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
      recipe: { id: recipeId.toString(), title: 'Soup', image: 'img' },
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
    Chat4KnowledgeModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'id1', title: 'Dish', images: [] })
    });
    jest.spyOn(service, 'getLastCookedDate').mockResolvedValue('2024-05-05');

    const result = await service.addEntry({
      date: '2024-05-08',
      recipeId: new Types.ObjectId().toString(),
      category: 'Lunch'
    });

    expect(result.status).toBe('warning');
    expect(result.warning).toEqual({
      lastCookedDate: '2024-05-05',
      daysSince: 3
    });
  });

  test('addEntry creates entry when forced or no recent cooking', async () => {
    const recipeId = new Types.ObjectId().toString();
    Chat4KnowledgeModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: { toString: () => recipeId },
        title: 'Dish',
        images: ['img']
      })
    });
    jest.spyOn(service, 'getLastCookedDate').mockResolvedValue(null);

    const leanResult = { entries: [] };
    CookingCalendarV2Model.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(leanResult)
    });

    const result = await service.addEntry({
      date: '2024-05-20',
      recipeId,
      category: 'dinner',
      force: true
    });

    expect(result.status).toBe('created');
    expect(result.entry.recipeId).toBe(recipeId);
    expect(result.entry.category).toBe('Dinner');
    expect(result.entry.recipe).toEqual({
      id: recipeId,
      title: 'Dish',
      image: 'img'
    });
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
});
