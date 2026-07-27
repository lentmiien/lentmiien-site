const mockGet = jest.fn();
const mockClose = jest.fn();
const mockCurlRequest = jest.fn(() => ({
  get: mockGet,
  close: mockClose,
}));

jest.mock('curl-cffi', () => ({
  CurlRequest: mockCurlRequest,
}));

const {
  buildItemUrl,
  fetchItemDetail,
  normalizeDetail,
} = require('../../services/amiamiScraperService');

describe('amiamiScraperService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches an item through the AmiAmi API using its normal item URL as referer', async () => {
    const apiData = {
      RSuccess: true,
      item: {
        gcode: 'FIGURE-100001',
      },
    };
    mockGet.mockResolvedValue({
      statusCode: 200,
      data: apiData,
    });

    const result = await fetchItemDetail('FIGURE-100001', {
      detailRetries: 0,
      requestTimeoutMs: 1234,
    });

    expect(buildItemUrl('FIGURE-100001')).toBe(
      'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
    );
    expect(mockCurlRequest).toHaveBeenCalledWith(
      { keepAlive: false },
      { maxSize: 1, idleTTL: 1 },
    );
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.amiami.com/api/v1.0/item',
      expect.objectContaining({
        impersonate: 'chrome136',
        params: {
          gcode: 'FIGURE-100001',
          lang: 'eng',
        },
        headers: expect.objectContaining({
          Referer: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
          'X-User-Key': 'amiami_dev',
        }),
        timeout: 1234,
        keepAlive: false,
      }),
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(result).toBe(apiData);
  });

  test('does not retry a failed detail response when retries are disabled', async () => {
    mockGet.mockResolvedValue({
      statusCode: 200,
      data: {
        RSuccess: false,
      },
    });

    await expect(fetchItemDetail('FIGURE-404', {
      detailRetries: 0,
    })).rejects.toThrow('AmiAmi item API did not return a product for FIGURE-404');

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test('normalizes the detail payload using the scraper data shape', () => {
    const normalized = normalizeDetail({
      item: {
        gcode: 'FIGURE-100001',
        gname: 'Example Figure',
        price: '12,345',
        maker_name: 'Example Maker',
        jancode: '4900000000001',
        main_image_url: '/images/example.jpg',
        preorderitem: 1,
      },
      _embedded: {
        series_titles: [{ name: 'Example Series' }],
        character_names: [{ name: 'Example Character' }],
      },
    });

    expect(normalized).toEqual(expect.objectContaining({
      gcode: 'FIGURE-100001',
      itemName: 'Example Figure',
      price: expect.objectContaining({
        currentJpy: 12345,
      }),
      brand: 'Example Maker',
      seriesTitle: 'Example Series',
      characterName: 'Example Character',
      janCode: '4900000000001',
      flags: expect.objectContaining({
        preOrder: true,
      }),
      imageLinks: ['https://img.amiami.com/images/example.jpg'],
      sourceUrl: 'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
      apiFetchedAt: expect.any(String),
    }));
  });
});
