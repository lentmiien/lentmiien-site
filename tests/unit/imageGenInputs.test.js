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
jest.mock('../../services/comfyGatewayService', () => jest.fn().mockImplementation(() => mockGateway));
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
        details: 'destination exists',
      });
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
});
