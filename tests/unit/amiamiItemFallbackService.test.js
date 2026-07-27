jest.mock('../../database', () => ({
  AmiAmiItem: {},
}));

jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
}));

jest.mock('../../services/amiamiScraperService', () => ({
  buildItemUrl: jest.fn(
    (gcode) => `https://www.amiami.com/eng/detail?gcode=${encodeURIComponent(gcode)}`,
  ),
  fetchItemDetail: jest.fn(),
  normalizeDetail: jest.fn(),
}));

const {
  createAmiAmiItemFallbackService,
} = require('../../services/amiamiItemFallbackService');

function createQuery(operation) {
  const query = {
    exec: jest.fn(operation),
  };
  query.lean = jest.fn(() => query);
  return query;
}

function createItemModel(initialItems = []) {
  const items = new Map(initialItems.map((item) => [item.gcode, item]));
  const itemModel = {
    findOne: jest.fn(({ gcode }) => createQuery(
      async () => items.get(gcode) || null,
    )),
    findOneAndUpdate: jest.fn((filter, update) => createQuery(async () => {
      if (!items.has(filter.gcode)) {
        items.set(filter.gcode, update.$setOnInsert);
      }
      return items.get(filter.gcode);
    })),
  };
  return { itemModel, items };
}

function createService({
  initialItems,
  fetchDetail = jest.fn(),
  normalize = jest.fn(),
  serviceLogger = { warning: jest.fn() },
  now = () => 1000,
  maxScrapesPerWindow,
  scrapeWindowMs,
} = {}) {
  const { itemModel, items } = createItemModel(initialItems);
  const service = createAmiAmiItemFallbackService({
    itemModel,
    fetchDetail,
    normalize,
    serviceLogger,
    now,
    maxScrapesPerWindow,
    scrapeWindowMs,
  });
  return {
    service,
    itemModel,
    items,
    fetchDetail,
    normalize,
    serviceLogger,
  };
}

describe('amiamiItemFallbackService', () => {
  test('scrapes once without retries and saves a fetched AmiAmi item', async () => {
    const apiData = {
      RSuccess: true,
      item: { gcode: 'FIGURE-100001' },
    };
    const details = {
      gcode: 'FIGURE-100001',
      itemName: 'Example Figure',
      brand: 'Example Maker',
      imageLinks: ['https://img.amiami.com/example.jpg'],
      janCode: '4900000000001',
    };
    const fetchDetail = jest.fn().mockResolvedValue(apiData);
    const normalize = jest.fn().mockReturnValue(details);
    const {
      service,
      itemModel,
      items,
    } = createService({ fetchDetail, normalize });

    const result = await service.attemptMissingItemScrape('FIGURE-100001');

    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(fetchDetail).toHaveBeenCalledWith('FIGURE-100001', {
      detailRetries: 0,
      retryDelayMs: 0,
    });
    expect(normalize).toHaveBeenCalledWith(apiData, { includeRaw: false });
    expect(itemModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(items.get('FIGURE-100001')).toEqual(expect.objectContaining({
      gcode: 'FIGURE-100001',
      url: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
      source: 'amiami-api-lookup',
      sourceUrl: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
      detailStatus: 'fetched',
      detailFetchedAt: new Date(1000),
      details,
      listing: {
        gcode: 'FIGURE-100001',
        url: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
        itemName: 'Example Figure',
        brand: 'Example Maker',
        priceText: null,
        imageUrl: 'https://img.amiami.com/example.jpg',
        tags: [],
      },
    }));
    expect(result).toEqual({
      status: 'fetched',
      item: items.get('FIGURE-100001'),
    });
  });

  test('saves a failed entry and never scrapes that gcode again', async () => {
    const scrapeError = new Error('item not found');
    const fetchDetail = jest.fn().mockRejectedValue(scrapeError);
    const serviceLogger = { warning: jest.fn() };
    const {
      service,
      items,
    } = createService({ fetchDetail, serviceLogger });

    const firstResult = await service.attemptMissingItemScrape('FIGURE-404');
    const secondResult = await service.attemptMissingItemScrape('FIGURE-404');

    const savedItem = items.get('FIGURE-404');
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(savedItem).toEqual(expect.objectContaining({
      gcode: 'FIGURE-404',
      detailStatus: 'error',
      detailFetchedAt: null,
      detailError: {
        message: 'item not found',
        at: new Date(1000),
      },
      details: null,
    }));
    expect(firstResult).toEqual({
      status: 'failed',
      item: savedItem,
    });
    expect(secondResult).toEqual({
      status: 'existing',
      item: savedItem,
    });
    expect(serviceLogger.warning).toHaveBeenCalledWith(
      'AmiAmi API fallback scrape failed',
      {
        category: 'amiami-items-api',
        metadata: {
          gcode: 'FIGURE-404',
          error: scrapeError,
        },
      },
    );
  });

  test('allows at most 20 scrape attempts in a rolling minute', async () => {
    let nowMs = 10000;
    const fetchDetail = jest.fn().mockImplementation(async (gcode) => ({
      RSuccess: true,
      item: { gcode },
    }));
    const normalize = jest.fn().mockImplementation((apiData) => ({
      gcode: apiData.item.gcode,
      itemName: apiData.item.gcode,
      brand: null,
      imageLinks: [],
    }));
    const {
      service,
    } = createService({
      fetchDetail,
      normalize,
      now: () => nowMs,
    });

    const results = [];
    for (let index = 1; index <= 21; index += 1) {
      results.push(await service.attemptMissingItemScrape(`FIGURE-${index}`));
    }

    expect(fetchDetail).toHaveBeenCalledTimes(20);
    expect(results.slice(0, 20).every((result) => result.status === 'fetched')).toBe(true);
    expect(results[20]).toEqual({
      status: 'rate-limited',
      item: null,
    });

    nowMs += 60 * 1000;
    const afterWindow = await service.attemptMissingItemScrape('FIGURE-21');

    expect(fetchDetail).toHaveBeenCalledTimes(21);
    expect(afterWindow.status).toBe('fetched');
  });

  test('shares an in-flight scrape for concurrent requests for the same gcode', async () => {
    let resolveFetch;
    const fetchDetail = jest.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const normalize = jest.fn().mockReturnValue({
      gcode: 'FIGURE-100001',
      itemName: 'Example Figure',
      brand: null,
      imageLinks: [],
    });
    const {
      service,
      itemModel,
    } = createService({ fetchDetail, normalize });

    const firstRequest = service.attemptMissingItemScrape('FIGURE-100001');
    const secondRequest = service.attemptMissingItemScrape('FIGURE-100001');

    expect(firstRequest).toBe(secondRequest);
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchDetail).toHaveBeenCalledTimes(1);

    resolveFetch({
      RSuccess: true,
      item: { gcode: 'FIGURE-100001' },
    });
    const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);

    expect(firstResult).toBe(secondResult);
    expect(itemModel.findOne).toHaveBeenCalledTimes(1);
    expect(itemModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
