const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const mockGateway = {
  listInputFiles: jest.fn(),
  uploadInputFile: jest.fn(),
  openInputFile: jest.fn(),
  getStatus: jest.fn(),
  getSystemStats: jest.fn(),
  submitPrompt: jest.fn(),
  streamIdleTimeoutMs: 60000,
};

jest.mock('../../database', () => ({
  Prompt: {},
  BulkJob: {},
  BulkTestPrompt: {},
  GoodImage: {},
  VectorEmbedding: {},
  VectorEmbeddingHighQuality: {},
}));
jest.mock('../../services/embeddingApiService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/comfyGatewayService', () => {
  const ActualComfyGatewayService = jest.requireActual('../../services/comfyGatewayService');
  const MockComfyGatewayService = jest.fn().mockImplementation(() => mockGateway);
  MockComfyGatewayService.gatewayClientMessage = ActualComfyGatewayService.gatewayClientMessage;
  MockComfyGatewayService.gatewayHttpStatus = ActualComfyGatewayService.gatewayHttpStatus;
  MockComfyGatewayService.gatewayLogMetadata = ActualComfyGatewayService.gatewayLogMetadata;
  return MockComfyGatewayService;
});
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: () => jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../../utils/logger');
const controller = require('../../controllers/image_gen.controller');

function responseDouble() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

describe('image_gen persistent workflow inputs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('forwards browse and pagination controls to the Gateway service', async () => {
    const payload = { files: [], total: 0, page: 1, limit: 48, pages: 0 };
    mockGateway.listInputFiles.mockResolvedValue(payload);
    const req = {
      params: { bucket: 'input' },
      query: {
        subfolder: 'references/audio',
        recursive: 'true',
        page: '1',
        limit: '48',
      },
    };
    const res = responseDouble();

    await controller.listFiles(req, res);

    expect(mockGateway.listInputFiles).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('returns and logs safe diagnostics when input browsing is unavailable', async () => {
    const error = Object.assign(new Error('sentinel-sensitive-list-message'), {
      status: 503,
      comfyGateway: {
        operation: 'listInputFiles',
        endpoint: '/comfy/input/files',
        status: 503,
        requestId: 'gateway-input-list-503',
        durationMs: 20001,
        upstreamState: { status: 'restarting' },
      },
    });
    mockGateway.listInputFiles.mockRejectedValue(error);
    const res = responseDouble();

    await controller.listFiles({ params: { bucket: 'input' }, query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'failed to list ComfyUI input files',
      details: 'The ComfyUI Gateway is unavailable.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'ComfyUI input file list request failed',
      {
        category: 'comfy-gateway',
        metadata: expect.objectContaining({
          operation: 'listInputFiles',
          endpoint: '/comfy/input/files',
          phase: 'request',
          status: 503,
          requestId: 'gateway-input-list-503',
          upstreamState: { status: 'restarting' },
        }),
      }
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sentinel-sensitive-list-message');
  });

  test('uploads generic input data and removes the temporary file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-input-test-'));
    const tempPath = path.join(tempDir, 'upload.tmp');
    fs.writeFileSync(tempPath, 'audio bytes');
    const payload = {
      ok: true,
      file: { path: 'references/audio/reference.wav' },
    };
    mockGateway.uploadInputFile.mockResolvedValue(payload);
    const req = {
      file: {
        path: tempPath,
        originalname: 'reference.wav',
        mimetype: 'audio/x-wav',
      },
      body: {
        subfolder: 'references/audio',
        overwrite: 'true',
      },
    };
    const res = responseDouble();

    try {
      await controller.uploadInput(req, res);

      expect(mockGateway.uploadInputFile).toHaveBeenCalledWith({
        buffer: Buffer.from('audio bytes'),
        filename: 'reference.wav',
        contentType: 'audio/x-wav',
        subfolder: 'references/audio',
        overwrite: true,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(payload);
      expect(fs.existsSync(tempPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('preserves an upload conflict response from the Gateway', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-input-test-'));
    const tempPath = path.join(tempDir, 'upload.tmp');
    fs.writeFileSync(tempPath, 'replacement');
    mockGateway.uploadInputFile.mockRejectedValue(Object.assign(new Error('destination exists'), {
      status: 409,
    }));
    const req = {
      file: {
        path: tempPath,
        originalname: 'reference.wav',
        mimetype: 'audio/x-wav',
      },
      body: {},
    };
    const res = responseDouble();

    try {
      await controller.uploadInput(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'failed to upload ComfyUI input file',
        details: 'The ComfyUI Gateway returned HTTP 409.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'ComfyUI input upload failed',
        {
          category: 'comfy-gateway',
          metadata: expect.objectContaining({
            operation: 'uploadInputFile',
            phase: 'request',
            status: 409,
          }),
        }
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('destination exists');
      expect(fs.existsSync(tempPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns a structured terminal response for an expired Gateway job', async () => {
    mockGateway.getStatus.mockRejectedValue(Object.assign(new Error('Unknown prompt_id'), {
      status: 404,
    }));
    const req = {
      params: { id: 'expired-job' },
      query: {},
      body: {},
      headers: {},
    };
    const res = responseDouble();

    await controller.getJob(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'job expired or not found',
      details: 'Unknown prompt_id',
      code: 'JOB_NOT_FOUND',
      terminal: true,
    });
  });

  test('aborts the Gateway preview when the browser disconnects', async () => {
    const req = Object.assign(new EventEmitter(), {
      query: { path: 'references/preview.png' },
      headers: { range: 'bytes=0-99' },
      aborted: false,
    });
    const res = new PassThrough();
    res.status = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    res.on('error', () => {});
    let requestSignal = null;
    mockGateway.openInputFile.mockImplementation(async (_path, options) => {
      requestSignal = options.signal;
      return new Response(new ReadableStream({ start() {} }), {
        status: 206,
        headers: { 'content-type': 'image/png' },
      });
    });

    await controller.getInputFile(req, res);
    req.emit('aborted');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGateway.openInputFile).toHaveBeenCalledWith('references/preview.png', {
      range: 'bytes=0-99',
      signal: expect.any(AbortSignal),
    });
    expect(requestSignal.aborted).toBe(true);
    expect(requestSignal.reason).toMatchObject({
      name: 'AbortError',
      message: 'preview client disconnected',
    });
  });

  test('logs a terminated upstream preview body with safe correlation metadata', async () => {
    let bodyController;
    const upstream = new Response(new ReadableStream({
      start(controller) {
        bodyController = controller;
      },
    }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    upstream.comfyGateway = {
      operation: 'openInputFile',
      endpoint: '/comfy/input/view',
      status: 200,
      requestId: 'gateway-stream-terminated-1',
      durationMs: 12,
      upstreamState: { status: 'streaming' },
    };
    mockGateway.openInputFile.mockResolvedValue(upstream);
    const req = Object.assign(new EventEmitter(), {
      query: { path: 'references/preview.png' },
      headers: {},
      aborted: false,
    });
    const res = new PassThrough();
    res.status = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    res.headersSent = true;
    res.on('error', () => {});

    await controller.getInputFile(req, res);
    bodyController.error(new Error('sentinel-sensitive-stream-termination'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith(
      'ComfyUI input preview stream failed',
      {
        category: 'comfy-gateway',
        metadata: expect.objectContaining({
          operation: 'openInputFile',
          endpoint: '/comfy/input/view',
          phase: 'response-body',
          status: 502,
          upstreamStatus: 200,
          requestId: 'gateway-stream-terminated-1',
          durationMs: expect.any(Number),
          upstreamState: { status: 'streaming' },
        }),
      }
    );
    expect(JSON.stringify(logger.error.mock.calls))
      .not.toContain('sentinel-sensitive-stream-termination');
  });

  test('returns a safe 504 and logs structured metadata for a preview header timeout', async () => {
    const error = Object.assign(new Error('sentinel-sensitive-upstream-message'), {
      name: 'TimeoutError',
      status: 504,
      comfyGateway: {
        operation: 'openInputFile',
        endpoint: '/comfy/input/view',
        status: 504,
        requestId: 'gateway-preview-timeout-1',
        durationMs: 10001,
        upstreamState: { status: 'starting' },
      },
    });
    mockGateway.openInputFile.mockRejectedValue(error);
    const req = Object.assign(new EventEmitter(), {
      query: { path: 'references/preview.png' },
      headers: {},
      aborted: false,
    });
    const res = Object.assign(responseDouble(), {
      destroyed: false,
      once: jest.fn(),
      off: jest.fn(),
    });

    await controller.getInputFile(req, res);

    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith({
      error: 'failed to preview ComfyUI input file',
      details: 'The ComfyUI Gateway request timed out.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'ComfyUI input preview request failed',
      {
        category: 'comfy-gateway',
        metadata: expect.objectContaining({
          operation: 'openInputFile',
          endpoint: '/comfy/input/view',
          phase: 'response-headers',
          status: 504,
          requestId: 'gateway-preview-timeout-1',
          durationMs: expect.any(Number),
          upstreamState: { status: 'starting' },
          errorName: 'TimeoutError',
        }),
      }
    );
    expect(JSON.stringify(logger.error.mock.calls))
      .not.toContain('sentinel-sensitive-upstream-message');
  });

  test('maps an unavailable Gateway health check to a safe 503 response', async () => {
    const error = Object.assign(new Error('sentinel-sensitive-health-message'), {
      status: 503,
      comfyGateway: {
        operation: 'getSystemStats',
        endpoint: '/comfy/system_stats',
        status: 503,
        requestId: 'gateway-health-503',
        durationMs: 20001,
        upstreamState: { status: 'restarting' },
      },
    });
    mockGateway.getSystemStats.mockRejectedValue(error);
    const res = responseDouble();

    await controller.health({}, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: 'The ComfyUI Gateway is unavailable.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'ComfyUI health request failed',
      {
        category: 'comfy-gateway',
        metadata: expect.objectContaining({
          operation: 'getSystemStats',
          endpoint: '/comfy/system_stats',
          status: 503,
          requestId: 'gateway-health-503',
          upstreamState: { status: 'restarting' },
        }),
      }
    );
    expect(JSON.stringify(logger.error.mock.calls))
      .not.toContain('sentinel-sensitive-health-message');
  });
});
