jest.mock('../../services/dummyApiLogService', () => ({
  recordDummyApiRequest: jest.fn().mockResolvedValue({ logged: true }),
}));

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));

const { recordDummyApiRequest } = require('../../services/dummyApiLogService');
const controller = require('../../controllers/dummyDebugApiController');

function createResponse() {
  return {
    json: jest.fn(),
    send: jest.fn(),
    set: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
  };
}

function createRequest(path = '/ok') {
  return {
    method: 'POST',
    originalUrl: path,
    url: path,
    path,
  };
}

describe('dummyDebugApiController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordDummyApiRequest.mockResolvedValue({ logged: true });
  });

  test('ok logs and returns the simple OK response', async () => {
    const req = createRequest('/ok');
    const res = createResponse();

    await controller.ok(req, res);

    expect(recordDummyApiRequest).toHaveBeenCalledWith(req, { settings: undefined });
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  test('clarisSession returns the Claris login sample response and token header', async () => {
    const req = createRequest('/fmi/data/vLatest/databases/DatabaseName/sessions');
    const res = createResponse();

    await controller.clarisSession(req, res);

    expect(recordDummyApiRequest).toHaveBeenCalledWith(req, { settings: undefined });
    expect(res.set).toHaveBeenCalledWith(
      'X-FM-Data-Access-Token',
      'c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110'
    );
    expect(res.json).toHaveBeenCalledWith({
      response: {
        token: 'c4d2e429122e9cdeda19bb23c55cd2a8f282c3cc50c60943a110',
      },
      messages: [
        {
          message: 'OK',
          code: '0',
        },
      ],
    });
  });

  test('clarisCreateRecord returns the Claris create-record sample response', async () => {
    const req = createRequest('/fmi/data/vLatest/databases/DatabaseName/layouts/LayoutName/records');
    const res = createResponse();

    await controller.clarisCreateRecord(req, res);

    expect(res.json).toHaveBeenCalledWith({
      response: {
        recordId: '324',
        modId: '0',
      },
      messages: [
        {
          code: '0',
          message: 'OK',
        },
      ],
    });
  });

  test('clarisUploadContainer returns the Claris upload-container sample response', async () => {
    const req = createRequest('/fmi/data/vLatest/databases/DatabaseName/layouts/LayoutName/records/324/containers/Container/1');
    const res = createResponse();

    await controller.clarisUploadContainer(req, res);

    expect(res.json).toHaveBeenCalledWith({
      response: {},
      messages: [
        {
          code: '0',
          message: 'OK',
        },
      ],
    });
  });

  test('clarisValidateSession returns the Claris validate-session sample response', async () => {
    const req = createRequest('/fmi/data/vLatest/validateSession');
    const res = createResponse();

    await controller.clarisValidateSession(req, res);

    expect(recordDummyApiRequest).toHaveBeenCalledWith(req, { settings: undefined });
    expect(res.json).toHaveBeenCalledWith({
      response: {
        isSessionInUse: true,
      },
      messages: [
        {
          message: 'OK',
          code: '0',
        },
      ],
    });
  });
});
