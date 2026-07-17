const os = require('os');
const path = require('path');
const fs = require('fs/promises');

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const Pixal3dJobService = require('../../services/pixal3dJobService');
const { DEFAULT_PIXAL3D_PARAMETERS } = require('../../utils/pixal3d');

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
    parameters: { ...DEFAULT_PIXAL3D_PARAMETERS },
  };
}

describe('Pixal3dJobService', () => {
  let publicRoot;

  beforeEach(async () => {
    publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pixal3d-job-service-'));
  });

  afterEach(async () => {
    await fs.rm(publicRoot, { recursive: true, force: true });
  });

  test('stores uploaded images under a random public filename', async () => {
    const service = new Pixal3dJobService({ JobModel: {}, gateway: {}, publicRoot });

    const stored = await service.storeInputImage(Buffer.from('image bytes'), 'jpeg');
    expect(stored.fileName).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(stored.publicUrl).toBe(`/img/${stored.fileName}`);
    expect(await fs.readFile(service.inputPath(stored.fileName), 'utf8')).toBe('image bytes');
    expect(() => service.outputPath('../model.glb')).toThrow('file name is invalid');
    expect(() => service.outputPath('..')).toThrow('file name is invalid');
  });

  test('removes a job input image and generated model', async () => {
    const service = new Pixal3dJobService({ JobModel: {}, gateway: {}, publicRoot });
    const inputFileName = `${'a'.repeat(64)}.png`;
    const outputFileName = `${'b'.repeat(64)}.glb`;
    await service.ensureStorageDirectories();
    await Promise.all([
      fs.writeFile(service.inputPath(inputFileName), 'input'),
      fs.writeFile(service.outputPath(outputFileName), 'output'),
    ]);

    const job = {
      inputImage: { fileName: inputFileName },
      outputModel: { fileName: outputFileName },
    };
    await service.removeJobFiles(job);

    await expect(fs.access(service.inputPath(inputFileName))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(service.outputPath(outputFileName))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.removeJobFiles(job)).resolves.toBeUndefined();
  });

  test('completes a queued job with output, camera, mesh, and VRAM metadata', async () => {
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
          'x-generation-seconds': '41.213',
          'x-export-seconds': '5.127',
          'x-peak-vram-mib': '19574',
          'x-actual-resolution': '1024',
          'x-camera-fov-degrees': '44.498',
          'x-worker-recycle': 'true',
          'content-type': 'model/gltf-binary',
        },
        sizeBytes: 3509256,
        version: 2,
      }),
      getLastJob: jest.fn().mockResolvedValue({
        job_id: 'gateway-1',
        status: 'complete',
        total_seconds: 55.073,
        actual_resolution: 1024,
        camera_source: 'moge-2',
        camera_fov_degrees: 44.498,
        camera_distance: 1.222224,
        source_vertices: 1746991,
        source_faces: 3577934,
        peak_allocated_mib: 6461.9,
        peak_reserved_mib: 19574,
        input_mode: 'RGB',
      }),
    };
    const service = new Pixal3dJobService({ JobModel, gateway, publicRoot });

    await service.processJob('job-1');

    expect(gateway.ensureContainerRunning).toHaveBeenCalledTimes(1);
    expect(gateway.generateToFile).toHaveBeenCalledWith(expect.objectContaining({
      inputFileName: job.inputImage.fileName,
      parameters: DEFAULT_PIXAL3D_PARAMETERS,
    }));
    const completionUpdate = JobModel.updateOne.mock.calls[0][1].$set;
    expect(completionUpdate.status).toBe('completed');
    expect(completionUpdate.gatewayJobId).toBe('gateway-1');
    expect(completionUpdate.outputModel).toMatchObject({
      fileName: expect.stringMatching(/^[a-f0-9]{64}\.glb$/),
      publicUrl: expect.stringMatching(/^\/pixal3d-models\/[a-f0-9]{64}\.glb$/),
      sizeBytes: 3509256,
      glbVersion: 2,
    });
    expect(completionUpdate.metrics).toEqual({
      generationSeconds: 41.213,
      exportSeconds: 5.127,
      totalSeconds: 55.073,
      actualResolution: 1024,
      cameraSource: 'moge-2',
      cameraFovDegrees: 44.498,
      cameraDistance: 1.222224,
      peakAllocatedMiB: 6461.9,
      peakReservedMiB: 19574,
      sourceVertices: 1746991,
      sourceFaces: 3577934,
      inputMode: 'RGB',
      workerRecycle: true,
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
    const service = new Pixal3dJobService({ JobModel, gateway, publicRoot });

    await service.processJob('job-1');

    expect(JobModel.updateOne).toHaveBeenCalledTimes(1);
    expect(JobModel.updateOne.mock.calls[0][1].$set).toMatchObject({
      status: 'failed',
      error: 'Gateway returned 409: Another operation is running',
      outputModel: null,
    });
  });
});
