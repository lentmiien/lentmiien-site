jest.mock('../../database', () => ({
  AmiAmiItem: {
    find: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

const { AmiAmiItem } = require('../../database');
const logger = require('../../utils/logger');
const controller = require('../../controllers/amiamiItemsApiController');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function mockFindResult(items) {
  const exec = jest.fn().mockResolvedValue(items);
  const lean = jest.fn(() => ({ exec }));
  AmiAmiItem.find.mockReturnValue({ lean });
  return { lean, exec };
}

describe('amiamiItemsApiController.fetchItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches a mixed list of gcodes and JAN codes in request order', async () => {
    const byGcode = {
      _id: 'item-1',
      gcode: 'FIGURE-100001',
      details: { janCode: '1111111111111' },
    };
    const byJan = {
      _id: 'item-2',
      gcode: 'GOODS-200002',
      details: { janCode: '2222222222222' },
    };
    const byNumericJan = {
      _id: 'item-3',
      gcode: 'GOODS-300003',
      details: { janCode: '3333333333333' },
    };
    const query = mockFindResult([byGcode, byNumericJan, byJan]);
    const req = {
      body: [' 2222222222222 ', 'FIGURE-100001', 3333333333333, '2222222222222'],
    };
    const res = createResponse();

    await controller.fetchItems(req, res);

    expect(AmiAmiItem.find).toHaveBeenCalledWith({
      $or: [
        {
          gcode: {
            $in: ['2222222222222', 'FIGURE-100001', '3333333333333'],
          },
        },
        {
          'details.janCode': {
            $in: ['2222222222222', 'FIGURE-100001', '3333333333333'],
          },
        },
      ],
    });
    expect(query.lean).toHaveBeenCalledTimes(1);
    expect(query.exec).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith([byJan, byGcode, byNumericJan]);
  });

  test('returns an empty array without querying for an empty request', async () => {
    const req = { body: [] };
    const res = createResponse();

    await controller.fetchItems(req, res);

    expect(AmiAmiItem.find).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('rejects payloads that are not arrays', async () => {
    const req = { body: { codes: ['FIGURE-100001'] } };
    const res = createResponse();

    await controller.fetchItems(req, res);

    expect(AmiAmiItem.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Expected the request body to be an array of gcode or JAN codes.',
    });
  });

  test('rejects requests with more than 100 codes', async () => {
    const req = { body: Array.from({ length: 101 }, (_, index) => `FIGURE-${index}`) };
    const res = createResponse();

    await controller.fetchItems(req, res);

    expect(AmiAmiItem.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'A maximum of 100 codes is allowed per request.',
    });
  });

  test('rejects empty or unsupported code values', async () => {
    const req = { body: ['FIGURE-100001', '   ', null] };
    const res = createResponse();

    await controller.fetchItems(req, res);

    expect(AmiAmiItem.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Code at index 1 must be a non-empty string or a non-negative integer.',
    });
  });

  test('returns a JSON error when the database query fails', async () => {
    const error = new Error('database unavailable');
    const exec = jest.fn().mockRejectedValue(error);
    AmiAmiItem.find.mockReturnValue({
      lean: jest.fn(() => ({ exec })),
    });
    const req = { body: ['FIGURE-100001'] };
    const res = createResponse();

    await controller.fetchItems(req, res);

    expect(logger.error).toHaveBeenCalledWith(
      'Unable to fetch AmiAmi items through the API',
      {
        category: 'amiami-items-api',
        metadata: { error },
      },
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unable to fetch AmiAmi items.',
    });
  });
});

