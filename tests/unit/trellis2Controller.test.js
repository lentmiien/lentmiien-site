const mockRemoveJobFiles = jest.fn();

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

jest.mock('../../models/trellis2_job', () => ({
  deleteOne: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../services/trellis2GatewayService', () => {
  class MockTrellis2GatewayService {}
  MockTrellis2GatewayService.containerIsRunning = jest.fn();
  return MockTrellis2GatewayService;
});

jest.mock('../../services/trellis2JobService', () => jest.fn().mockImplementation(() => ({
  removeJobFiles: mockRemoveJobFiles,
})));

const Trellis2Job = require('../../models/trellis2_job');
const controller = require('../../controllers/trellis2Controller');

function leanResult(value) {
  return {
    lean: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(value),
    })),
  };
}

function execResult(value) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function buildResponse() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function buildRequest() {
  return {
    params: { jobId: 'job-1' },
    user: {
      _id: { toString: () => 'owner-1' },
      name: 'Owner',
    },
  };
}

describe('TRELLIS.2 job deletion', () => {
  beforeEach(() => {
    Trellis2Job.findOne.mockReset();
    Trellis2Job.deleteOne.mockReset();
    mockRemoveJobFiles.mockReset();
  });

  test.each(['completed', 'failed'])('deletes %s jobs and files using an owner-scoped query', async (status) => {
    const job = {
      _id: 'job-1',
      status,
      inputImage: { fileName: `${'a'.repeat(64)}.png` },
      outputModel: { fileName: `${'b'.repeat(64)}.glb` },
    };
    Trellis2Job.findOne.mockReturnValue(leanResult(job));
    Trellis2Job.deleteOne.mockReturnValue(execResult({ deletedCount: 1 }));
    mockRemoveJobFiles.mockResolvedValue();
    const req = buildRequest();
    const res = buildResponse();

    await controller.deleteJob(req, res);

    expect(Trellis2Job.findOne).toHaveBeenCalledWith({
      $and: [
        { _id: 'job-1' },
        { 'owner.id': 'owner-1' },
      ],
    });
    expect(mockRemoveJobFiles).toHaveBeenCalledWith(job);
    expect(Trellis2Job.deleteOne).toHaveBeenCalledWith({
      $and: [
        { _id: 'job-1' },
        { 'owner.id': 'owner-1' },
        { status: { $in: ['completed', 'failed'] } },
      ],
    });
    expect(res.json).toHaveBeenCalledWith({ ok: true, jobId: 'job-1' });
  });

  test('does not delete a job outside the current user owner query', async () => {
    Trellis2Job.findOne.mockReturnValue(leanResult(null));
    const res = buildResponse();

    await controller.deleteJob(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Job not found or not owned by you.' });
    expect(mockRemoveJobFiles).not.toHaveBeenCalled();
    expect(Trellis2Job.deleteOne).not.toHaveBeenCalled();
  });

  test('keeps queued and processing jobs until generation finishes', async () => {
    Trellis2Job.findOne.mockReturnValue(leanResult({ _id: 'job-1', status: 'processing' }));
    const res = buildResponse();

    await controller.deleteJob(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Wait for the job to finish before deleting it.' });
    expect(mockRemoveJobFiles).not.toHaveBeenCalled();
    expect(Trellis2Job.deleteOne).not.toHaveBeenCalled();
  });
});
