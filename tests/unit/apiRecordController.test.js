jest.mock('../../database', () => ({
  ApiRecordModel: {},
}));

jest.mock('../../services/apiRecordService', () => {
  const MockService = jest.fn().mockImplementation(() => ({
    upsertBatch: jest.fn(),
    fetchEntries: jest.fn(),
    fetchOrderReferencesByTitle: jest.fn(),
    fetchEntryById: jest.fn(),
    deleteEntry: jest.fn(),
  }));
  MockService.ApiRecordError = class ApiRecordError extends Error {
    constructor(message, status = 400, code = 'bad_request', details = null) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  };
  return MockService;
});

const ApiRecordService = require('../../services/apiRecordService');
const controller = require('../../controllers/apiRecordController');
const apiRecordService = ApiRecordService.mock.results[0].value;

describe('apiRecordController.requireApiRecordUser', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.API_TIER1_USER_ID = 'tier-1-user';
    process.env.API_TIER2_USER_ID = 'tier-2-user';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  test('accepts tier1 user id from header and sets access context', () => {
    const req = {
      get: jest.fn((name) => (name === 'x-user-id' ? 'tier-1-user' : undefined)),
      query: {},
      body: {},
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    controller.requireApiRecordUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.apiRecordAccess).toEqual({ userId: 'tier-1-user', tier: 'tier1' });
  });

  test('accepts tier2 user id from body when header is absent', () => {
    const req = {
      get: jest.fn(),
      query: {},
      body: { userId: 'tier-2-user' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    controller.requireApiRecordUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.apiRecordAccess).toEqual({ userId: 'tier-2-user', tier: 'tier2' });
  });

  test('rejects unknown user ids', () => {
    const req = {
      get: jest.fn((name) => (name === 'x-user-id' ? 'wrong-user' : undefined)),
      query: {},
      body: {},
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    controller.requireApiRecordUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'invalid_user_id',
    }));
  });
});

describe('apiRecordController record fetch helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRecordService.fetchOrderReferencesByTitle.mockReset();
    apiRecordService.fetchEntryById.mockReset();
  });

  test('fetchRecordOrdersByTitle returns order references for a title', async () => {
    apiRecordService.fetchOrderReferencesByTitle.mockResolvedValue({
      count: 2,
      data: [
        { id: 'rec-1', order: 5 },
        { id: 'rec-2', order: 8 },
      ],
    });

    const req = {
      query: { title: 'Alpha' },
      apiRecordAccess: { userId: 'tier-1-user', tier: 'tier1' },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await controller.fetchRecordOrdersByTitle(req, res);

    expect(apiRecordService.fetchOrderReferencesByTitle).toHaveBeenCalledWith('Alpha', req.apiRecordAccess);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      count: 2,
      data: [
        { id: 'rec-1', order: 5 },
        { id: 'rec-2', order: 8 },
      ],
    });
  });

  test('fetchRecordById returns a single record', async () => {
    apiRecordService.fetchEntryById.mockResolvedValue({
      id: 'rec-1',
      title: 'Alpha',
      order: 5,
      rev: 2,
    });

    const req = {
      params: { id: 'rec-1' },
      apiRecordAccess: { userId: 'tier-2-user', tier: 'tier2' },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await controller.fetchRecordById(req, res);

    expect(apiRecordService.fetchEntryById).toHaveBeenCalledWith('rec-1', req.apiRecordAccess);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        id: 'rec-1',
        title: 'Alpha',
        order: 5,
        rev: 2,
      },
    });
  });
});
