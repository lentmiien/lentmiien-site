const fsp = require('fs/promises');
const mockQueue = { enqueueGoodImage: jest.fn() };
const mockGateway = { submitPrompt: jest.fn() };
const mockGoodImage = { create: jest.fn() };
jest.mock('../../database', () => ({
  GoodImage: mockGoodImage,
  Prompt: { findOneAndUpdate: jest.fn(() => ({ lean: async () => null })) },
}));
jest.mock('../../services/embeddingQueueService', () => mockQueue);
jest.mock('../../services/comfyGatewayService', () => jest.fn(() => mockGateway));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const logger = require('../../utils/logger');
const controller = require('../../controllers/image_gen.controller');

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(fsp, 'access').mockResolvedValue();
  jest.spyOn(fsp, 'mkdir').mockResolvedValue();
  jest.spyOn(fsp, 'copyFile').mockResolvedValue();
  mockGoodImage.create.mockImplementation(async fields => ({ _id: '507f191e810c19729de860ea', ...fields }));
  mockQueue.enqueueGoodImage.mockResolvedValue(2);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

async function saveRatedImage(rating, prompt = 'Synthetic prompt') {
  const jobId = `test-${rating}-${Date.now()}-${Math.random()}`;
  mockGateway.submitPrompt.mockResolvedValue({ prompt_id: jobId, status: 'completed', outputs: [{ filename: 'synthetic.png' }] });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await controller.generate({ body: { prompt: { 1: { class_type: 'SaveImage' } }, prompt_text: prompt } }, res);
  await controller.rateJob({ body: { job_id: jobId, rating } }, res);
  return res.json.mock.calls.at(-1)[0];
}

test.each([['good', 'disabled'], ['great', 'pending']])('saving a %s image persists pending intent before enqueue', async (rating, hqStatus) => {
  const result = await saveRatedImage(rating);
  expect(result).toMatchObject({ ok: true, warnings: [], saved: [{ embedding_status: 'pending', high_quality_embedding_status: hqStatus, high_quality_embedding: false }] });
  expect(mockGoodImage.create).toHaveBeenCalledWith(expect.objectContaining({ embedding_queue_version: 1, embedding_status: 'pending' }));
  expect(mockGoodImage.create.mock.invocationCallOrder[0]).toBeLessThan(mockQueue.enqueueGoodImage.mock.invocationCallOrder[0]);
  expect(fsp.copyFile).toHaveBeenCalledTimes(1);
});

test('enqueue failure preserves the saved image and pending states for reconciliation', async () => {
  mockQueue.enqueueGoodImage.mockRejectedValueOnce(new Error('PRIVATE-PROVIDER-DETAILS'));
  const result = await saveRatedImage('great');
  expect(result.saved).toHaveLength(1);
  expect(result.saved[0]).toMatchObject({ embedding_status: 'pending', high_quality_embedding_status: 'pending' });
  expect(result.warnings).toEqual(['Image saved; embedding queue creation will be retried.']);
  expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('reconciliation will retry'), expect.any(Object));
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('PRIVATE');
  expect(fsp.copyFile).toHaveBeenCalledTimes(1);
});

test('missing prompt is saved with separate failed outcomes and never queued', async () => {
  const result = await saveRatedImage('great', '');
  expect(result.saved[0]).toMatchObject({ embedding_status: 'failed', high_quality_embedding_status: 'failed' });
  expect(mockQueue.enqueueGoodImage).not.toHaveBeenCalled();
});
