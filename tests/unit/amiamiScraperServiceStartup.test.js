jest.mock('curl-cffi', () => {
  throw new Error('Global libs directory not found');
});

const {
  buildItemUrl,
  fetchItemDetail,
  normalizeDetail,
} = require('../../services/amiamiScraperService');

describe('amiamiScraperService startup isolation', () => {
  test('loads non-scraping helpers when curl-cffi cannot initialize', () => {
    expect(buildItemUrl('FIGURE-100001')).toBe(
      'https://www.amiami.com/eng/detail?gcode=FIGURE-100001',
    );
    expect(normalizeDetail({ item: { gcode: 'FIGURE-100001' } })).toEqual(
      expect.objectContaining({ gcode: 'FIGURE-100001' }),
    );
  });

  test('reports an actionable error only when scraping is attempted', async () => {
    await expect(fetchItemDetail('FIGURE-100001', {
      detailRetries: 0,
    })).rejects.toMatchObject({
      code: 'AMIAMI_SCRAPER_UNAVAILABLE',
      message: expect.stringContaining('npm rebuild curl-cffi'),
    });
  });
});
