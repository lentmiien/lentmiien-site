const mockRemoveJobFiles = jest.fn();

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

jest.mock('../../models/pixal3d_job', () => ({
  countDocuments: jest.fn(),
  deleteOne: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock('../../services/pixal3dGatewayService', () => {
  class MockPixal3dGatewayService {}
  MockPixal3dGatewayService.containerIsRunning = jest.fn();
  return MockPixal3dGatewayService;
});

jest.mock('../../services/pixal3dJobService', () => jest.fn().mockImplementation(() => ({
  removeJobFiles: mockRemoveJobFiles,
})));

const Pixal3dJob = require('../../models/pixal3d_job');
const controller = require('../../controllers/pixal3dController');

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
  const res = { json: jest.fn(), render: jest.fn(), status: jest.fn() };
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

describe('Pixal3D job deletion', () => {
  beforeEach(() => {
    Pixal3dJob.findOne.mockReset();
    Pixal3dJob.deleteOne.mockReset();
    mockRemoveJobFiles.mockReset();
  });

  test.each(['completed', 'failed'])('deletes %s jobs and files using an owner-scoped query', async (status) => {
    const job = {
      _id: 'job-1',
      status,
      inputImage: { fileName: `${'a'.repeat(64)}.png` },
      outputModel: { fileName: `${'b'.repeat(64)}.glb` },
    };
    Pixal3dJob.findOne.mockReturnValue(leanResult(job));
    Pixal3dJob.deleteOne.mockReturnValue(execResult({ deletedCount: 1 }));
    mockRemoveJobFiles.mockResolvedValue();
    const req = buildRequest();
    const res = buildResponse();

    await controller.deleteJob(req, res);

    expect(Pixal3dJob.findOne).toHaveBeenCalledWith({
      $and: [
        { _id: 'job-1' },
        { 'owner.id': 'owner-1' },
      ],
    });
    expect(mockRemoveJobFiles).toHaveBeenCalledWith(job);
    expect(Pixal3dJob.deleteOne).toHaveBeenCalledWith({
      $and: [
        { _id: 'job-1' },
        { 'owner.id': 'owner-1' },
        { status: { $in: ['completed', 'failed'] } },
      ],
    });
    expect(res.json).toHaveBeenCalledWith({ ok: true, jobId: 'job-1' });
  });

  test('does not delete a job outside the current user owner query', async () => {
    Pixal3dJob.findOne.mockReturnValue(leanResult(null));
    const res = buildResponse();

    await controller.deleteJob(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Job not found or not owned by you.' });
    expect(mockRemoveJobFiles).not.toHaveBeenCalled();
    expect(Pixal3dJob.deleteOne).not.toHaveBeenCalled();
  });

  test('keeps queued and processing jobs until generation finishes', async () => {
    Pixal3dJob.findOne.mockReturnValue(leanResult({ _id: 'job-1', status: 'processing' }));
    const res = buildResponse();

    await controller.deleteJob(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Wait for the job to finish before deleting it.' });
    expect(mockRemoveJobFiles).not.toHaveBeenCalled();
    expect(Pixal3dJob.deleteOne).not.toHaveBeenCalled();
  });
});

describe('Pixal3D visibility, pagination, and sharing', () => {
  beforeEach(() => {
    Pixal3dJob.countDocuments.mockReset();
    Pixal3dJob.find.mockReset();
    Pixal3dJob.findOneAndUpdate.mockReset();
  });

  test('lists ten jobs per page using the owner-or-shared visibility query', async () => {
    Pixal3dJob.countDocuments.mockReturnValue(execResult(12));
    const exec = jest.fn().mockResolvedValue([]);
    const lean = jest.fn(() => ({ exec }));
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    const sort = jest.fn(() => ({ skip }));
    Pixal3dJob.find.mockReturnValue({ sort });
    const req = {
      query: { page: '2' },
      user: { _id: { toString: () => 'owner-1' }, name: 'Owner' },
    };
    const res = buildResponse();

    await controller.renderIndex(req, res);

    const visibleQuery = {
      $or: [{ 'owner.id': 'owner-1' }, { shared: true }],
    };
    expect(Pixal3dJob.countDocuments).toHaveBeenCalledWith(visibleQuery);
    expect(Pixal3dJob.find).toHaveBeenCalledWith(visibleQuery);
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(skip).toHaveBeenCalledWith(10);
    expect(limit).toHaveBeenCalledWith(10);
    expect(res.render).toHaveBeenCalledWith('pixal3d/index', expect.objectContaining({
      jobs: [],
      pagination: expect.objectContaining({ page: 2, totalPages: 2, totalJobs: 12 }),
    }));
  });

  test('updates sharing with an owner-scoped query', async () => {
    Pixal3dJob.findOneAndUpdate.mockReturnValue(leanResult({ _id: 'job-1', shared: true }));
    const req = { ...buildRequest(), body: { shared: true } };
    const res = buildResponse();

    await controller.toggleShare(req, res);

    expect(Pixal3dJob.findOneAndUpdate).toHaveBeenCalledWith(
      {
        $and: [
          { _id: 'job-1' },
          { 'owner.id': 'owner-1' },
        ],
      },
      { $set: { shared: true } },
      { new: true },
    );
    expect(res.json).toHaveBeenCalledWith({ ok: true, shared: true });
  });

  test('rejects a non-boolean sharing value before querying the database', async () => {
    const req = { ...buildRequest(), body: { shared: 'true' } };
    const res = buildResponse();

    await controller.toggleShare(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'shared must be true or false.' });
    expect(Pixal3dJob.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
