const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGateway = {
  listInputFiles: jest.fn(),
  uploadInputFile: jest.fn(),
  openInputFile: jest.fn(),
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
});
