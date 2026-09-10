jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('fs/promises', () => ({ mkdir: jest.fn(), writeFile: jest.fn() }));
jest.mock('../../database', () => ({ AsrJob: { create: jest.fn() } }));
jest.mock('../../services/embeddingApiService', () => jest.fn());
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
jest.mock('../../utils/logger', () => ({ notice: jest.fn(), error: jest.fn() }));

const { transcribe } = require('../../controllers/asrcontroller');
const { AsrJob } = require('../../database');
const axios = require('axios');
const logger = require('../../utils/logger');

beforeEach(() => {
  AsrJob.create.mockReset().mockResolvedValue({ _id: 'synthetic-job', status: 'failed' });
});

const request = () => ({ headers: { accept: 'application/json' }, body: {},
  file: { buffer: Buffer.from('synthetic audio'), originalname: 'fixture.wav', mimetype: 'audio/wav' } });
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

test('one transport failure produces one operational error while still saving the failed job', async () => {
  axios.post.mockRejectedValueOnce(Object.assign(new Error('synthetic transport failure'), { code: 'ECONNRESET' }));
  const res = response();
  await transcribe(request(), res);
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.error.mock.calls[0][1].category).toBe('asr_service');
  expect(AsrJob.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  expect(res.status).toHaveBeenCalledWith(502);
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('a controller persistence failure remains visible after a successful transcription', async () => {
  axios.post.mockResolvedValueOnce({ data: { text: 'synthetic transcript' }, headers: {} });
  AsrJob.create.mockRejectedValueOnce(new Error('synthetic persistence failure'));
  await transcribe(request(), response());
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.error.mock.calls[0][0]).toBe('ASR transcription failed');
  expect(logger.error.mock.calls[0][1].category).toBe('asr');
});
