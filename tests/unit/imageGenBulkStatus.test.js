const mongoose = require('mongoose');

const mockBulkJob = {
  findById: jest.fn(),
  updateOne: jest.fn(),
  distinct: jest.fn(),
};

const mockBulkTestPrompt = {
  aggregate: jest.fn(),
  updateMany: jest.fn(),
  find: jest.fn(),
  distinct: jest.fn(),
};

jest.mock('../../database', () => ({
  Prompt: {},
  BulkJob: mockBulkJob,
  BulkTestPrompt: mockBulkTestPrompt,
  GoodImage: {},
  VectorEmbedding: {},
  VectorEmbeddingHighQuality: {},
}));

jest.mock('../../services/embeddingApiService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../services/comfyGatewayService', () => jest.fn().mockImplementation(() => ({
  getStatus: jest.fn(),
})));
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

describe('image_gen bulk status actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBulkJob.distinct.mockResolvedValue([]);
    mockBulkTestPrompt.distinct.mockResolvedValue([]);
    mockBulkJob.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  test('resets processing prompts to pending for a bulk job', async () => {
    const jobId = new mongoose.Types.ObjectId();
    const jobDoc = {
      _id: jobId,
      status: 'Completed',
      instance_id: 'gpu-a',
      prompt_templates: [],
      placeholder_values: [],
      image_inputs: [],
      counters: {},
      toObject: () => ({
        _id: jobId,
        status: 'Completed',
        instance_id: 'gpu-a',
        prompt_templates: [],
        placeholder_values: [],
        image_inputs: [],
        counters: {},
      }),
    };

    mockBulkJob.findById
      .mockResolvedValueOnce(jobDoc)
      .mockResolvedValueOnce(jobDoc);
    mockBulkTestPrompt.updateMany.mockResolvedValue({ modifiedCount: 2 });
    mockBulkTestPrompt.aggregate.mockResolvedValue([
      { _id: 'Pending', count: 2 },
      { _id: 'Completed', count: 3 },
    ]);

    const req = {
      params: { id: String(jobId) },
      body: { action: 'reset_processing_to_pending' },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await controller.updateBulkJobStatus(req, res);

    const [filter, update] = mockBulkTestPrompt.updateMany.mock.calls[0];
    expect(String(filter.job)).toBe(String(jobId));
    expect(filter.status).toBe('Processing');
    expect(update.$set).toMatchObject({
      status: 'Pending',
      comfy_error: null,
      comfy_job_id: null,
      filename: null,
      file_url: null,
      instance_id: 'gpu-a',
    });
    expect(update.$set.updated_at).toBeInstanceOf(Date);
    expect(update.$unset).toEqual({ started_at: 1, completed_at: 1 });

    const jobStatusUpdate = mockBulkJob.updateOne.mock.calls[0][1].$set;
    expect(jobStatusUpdate.status).toBe('Processing');
    expect(jobStatusUpdate.completed_at).toBeNull();
    expect(jobStatusUpdate.updated_at).toBeInstanceOf(Date);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({
        counters: expect.objectContaining({
          total: 5,
          pending: 2,
          completed: 3,
        }),
        progress: 0.6,
      }),
    }));
  });
});
