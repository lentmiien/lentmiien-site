const os = require('os');
const path = require('path');
const fs = require('fs/promises');

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const Trellis2JobService = require('../../services/trellis2JobService');
const { DEFAULT_TRELLIS2_PARAMETERS } = require('../../utils/trellis2');

function queryResult(value) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function buildJob() {
  return {
    _id: 'job-1',
    inputImage: {
      fileName: 'a'.repeat(64) + '.jpg',
      mimeType: 'image/jpeg',
    },
    parameters: { ...DEFAULT_TRELLIS2_PARAMETERS },
  };
}

describe('Trellis2JobService', () => {
  let publicRoot;

  beforeEach(async () => {
    publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis2-job-service-'));
  });

  afterEach(async () => {
    await fs.rm(publicRoot, { recursive: true, force: true });
  });

  test('stores uploaded images under a random public filename', async () => {
    const service = new Trellis2JobService({
      JobModel: {},
      gateway: {},
      publicRoot,
    });

    const stored = await service.storeInputImage(Buffer.from('image bytes'), 'jpeg');
    expect(stored.fileName).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(stored.publicUrl).toBe(`/img/${stored.fileName}`);
    expect(await fs.readFile(service.inputPath(stored.fileName), 'utf8')).toBe('image bytes');
    expect(() => service.outputPath('../model.glb')).toThrow('file name is invalid');
    expect(() => service.outputPath('..')).toThrow('file name is invalid');
  });

  test('completes a queued job with output and gateway metadata', async () => {
    const job = buildJob();
    const JobModel = {
      findOneAndUpdate: jest.fn(() => queryResult(job)),
      updateOne: jest.fn(() => queryResult({ modifiedCount: 1 })),
    };
    const gateway = {
      ensureContainerRunning: jest.fn().mockResolvedValue({ running: true }),
      generateToFile: jest.fn().mockResolvedValue({
        headers: {
          'x-job-id': 'gateway-1',
          'x-generation-seconds': '10.5',
          'x-export-seconds': '2.5',
          'x-peak-vram-mib': '5000',
          'content-type': 'model/gltf-binary',
        },
        sizeBytes: 123456,
        version: 2,
      }),
      getLastJob: jest.fn().mockResolvedValue({
        job_id: 'gateway-1',
        status: 'complete',
        total_seconds: 13,
        source_vertices: 900,
        source_faces: 1800,
        input_mode: 'RGB',
      }),
    };
    const service = new Trellis2JobService({ JobModel, gateway, publicRoot });

    await service.processJob('job-1');

    expect(gateway.ensureContainerRunning).toHaveBeenCalledTimes(1);
    expect(gateway.generateToFile).toHaveBeenCalledWith(expect.objectContaining({
      inputFileName: job.inputImage.fileName,
      parameters: DEFAULT_TRELLIS2_PARAMETERS,
    }));
    const completionUpdate = JobModel.updateOne.mock.calls[0][1].$set;
    expect(completionUpdate.status).toBe('completed');
    expect(completionUpdate.gatewayJobId).toBe('gateway-1');
    expect(completionUpdate.outputModel).toMatchObject({
      fileName: expect.stringMatching(/^[a-f0-9]{64}\.glb$/),
      publicUrl: expect.stringMatching(/^\/trellis2-models\/[a-f0-9]{64}\.glb$/),
      sizeBytes: 123456,
      glbVersion: 2,
    });
    expect(completionUpdate.metrics).toEqual({
      generationSeconds: 10.5,
      exportSeconds: 2.5,
      totalSeconds: 13,
      peakVramMiB: 5000,
      sourceVertices: 900,
      sourceFaces: 1800,
      inputMode: 'RGB',
    });
  });

  test('marks a queued job failed with a bounded gateway error', async () => {
    const gatewayError = Object.assign(new Error('Request failed'), {
      response: { status: 409, data: { detail: 'Another operation is running' } },
    });
    const JobModel = {
      findOneAndUpdate: jest.fn(() => queryResult(buildJob())),
      updateOne: jest.fn(() => queryResult({ modifiedCount: 1 })),
    };
    const gateway = {
      ensureContainerRunning: jest.fn().mockResolvedValue({ running: true }),
      generateToFile: jest.fn().mockRejectedValue(gatewayError),
    };
    const service = new Trellis2JobService({ JobModel, gateway, publicRoot });

    await service.processJob('job-1');

    expect(JobModel.updateOne).toHaveBeenCalledTimes(1);
    expect(JobModel.updateOne.mock.calls[0][1].$set).toMatchObject({
      status: 'failed',
      error: 'Gateway returned 409: Another operation is running',
      outputModel: null,
    });
  });
});
