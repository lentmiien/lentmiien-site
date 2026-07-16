const mockRouter = {
  all: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));

jest.mock('express-rate-limit', () => jest.fn(() => jest.fn()));

jest.mock('multer', () => Object.assign(
  jest.fn(() => ({ single: jest.fn() })),
  { memoryStorage: jest.fn(() => ({})) },
));

jest.mock('../../controllers/apicontroller', () => ({}));
jest.mock('../../controllers/apiRecordController', () => ({}));
jest.mock('../../controllers/audioWorkflowController', () => ({}));
jest.mock('../../controllers/tapoController', () => ({}));
jest.mock('../../controllers/amiamiItemsApiController', () => ({
  fetchItems: jest.fn(),
}));

const rateLimit = require('express-rate-limit');

describe('AmiAmi items API route', () => {
  test('registers the read-only endpoint with a 50 request per minute limit', () => {
    const amiamiItemsApiController = require('../../controllers/amiamiItemsApiController');
    const router = require('../../routes/api');

    expect(router).toBe(mockRouter);
    expect(rateLimit).toHaveBeenCalledWith({
      windowMs: 60 * 1000,
      limit: 50,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: 'Too many AmiAmi item requests. A maximum of 50 requests per minute is allowed.',
      },
    });

    const limiter = rateLimit.mock.results[0].value;
    expect(mockRouter.post).toHaveBeenCalledWith(
      '/amiami-items',
      limiter,
      amiamiItemsApiController.fetchItems,
    );
  });
});
