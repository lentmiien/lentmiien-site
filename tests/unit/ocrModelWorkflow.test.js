jest.mock('axios');
jest.mock('fs/promises', () => ({ mkdir: jest.fn(), unlink: jest.fn(), lstat: jest.fn() }));
jest.mock('sharp', () => jest.fn(() => {
  const chain = { rotate: jest.fn(), resize: jest.fn(), jpeg: jest.fn(), toFile: jest.fn().mockResolvedValue() };
  for (const key of ['rotate', 'resize', 'jpeg']) chain[key].mockReturnValue(chain);
  return chain;
}));
jest.mock('../../utils/logger', () => ({ notice: jest.fn(), warning: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
jest.mock('../../services/embeddingApiService', () => jest.fn(() => ({ embedHighQuality: jest.fn() })));
jest.mock('../../services/ocrEmbeddingService', () => ({ setOcrIdleCheck: jest.fn(), noteOcrActivity: jest.fn(), deferUntilOcrIdle: jest.fn(), buildOcrEmbeddingMetadata: jest.fn() }));
jest.mock('../../database', () => {
  const OcrJob = require('../../models/ocr_job');
  return { OcrJob, UseraccountModel: { findById: jest.fn() }, RoleModel: { findOne: jest.fn() } };
});
const axios = require('axios');
const { OcrJob, UseraccountModel, RoleModel } = require('../../database');
const controller = require('../../controllers/ocrcontroller');
const { MODEL_DEFINITIONS, DEFAULT_PROMPT } = require('../../services/ocrModelService');
const { canTestModels, visibleJobs } = require('../../utils/ocrAuthorization');
const admin = { _id: 'a'.repeat(24), name: 'tester', type_user: 'admin' };
let saved;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), sendStatus: jest.fn(), type: jest.fn().mockReturnThis(), sendFile: jest.fn() });
beforeEach(() => {
  saved = null;
  jest.spyOn(OcrJob.prototype, 'save').mockImplementation(async function () { saved = this; return this; });
  jest.spyOn(OcrJob, 'findById').mockImplementation(async () => saved);
  jest.spyOn(OcrJob, 'findOne').mockImplementation(async () => saved);
  axios.get.mockResolvedValue({ data: { models: MODEL_DEFINITIONS } });
  UseraccountModel.findById.mockResolvedValue(admin);
  RoleModel.findOne.mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());
async function run(body, data) {
  axios.post.mockResolvedValue({ data });
  const req = { body, user: admin, ocrCanTestModels: true, files: [{ buffer: Buffer.from('synthetic image'), size: 15, mimetype: 'image/png', originalname: 'test.png' }] };
  const res = response();
  await controller.enqueueJob(req, res);
  for (let i = 0; i < 20 && saved?.status !== 'completed' && saved?.status !== 'failed'; i++) await new Promise(setImmediate);
  await new Promise(setImmediate);
  return res;
}
test('unchanged submission sends legacy settings, parses coordinates, and queues embeddings', async () => {
  const res = await run({}, { text: 'Hello(10,10),(40,40)', model: 'tencent/HunyuanOCR' });
  expect(res.status).toHaveBeenCalledWith(202);
  const multipart = axios.post.mock.calls[0][1].getBuffer().toString();
  expect(multipart).toContain(DEFAULT_PROMPT);
  expect(multipart).toContain('2048');
  expect(saved.files[0].result.overlayBoxes).toHaveLength(1);
  expect(saved.files[0].embeddingStatus).toBe('pending');
  expect(saved.files[0].previewPath).toMatch(/^ocr\//);
});
test.each(['teleocr', 'lightonocr-2', 'unlimited-ocr'])('%s preserves every response field without Hunyuan parsing or embeddings', async model => {
  const payload = { text: '<script>alert(1)</script>(10,10),(40,40)', model_id: 'native/model', raw_text: '<native>', boxes: [{ points: [[1, 2]] }], stats: { empty: {}, tokens: 123 }, finish_reason: 'length' };
  await run({ model }, payload);
  const multipart = axios.post.mock.calls[0][1].getBuffer().toString();
  expect(multipart).toContain(model);
  expect(multipart).not.toContain('name="prompt"');
  expect(multipart).not.toContain('name="max_new_tokens"');
  expect(saved.files[0].result.rawResponse).toEqual(payload);
  expect(saved.toObject().files[0].result.rawResponse).toEqual(payload);
  expect(saved.files[0].result.overlayBoxes).toHaveLength(0);
  expect(saved.files[0].result.layoutText).toBe('');
  expect(saved.files[0].result.model).toBe('native/model');
  expect(saved.files[0].embeddingStatus).toBe('not_applicable');
  expect(saved.files[0].previewPath).toMatch(/^\/ocr\/jobs\/.+\/preview$/);
  const res = response();
  await controller.getJobDetails({ params: { jobId: saved.id }, user: admin, ocrCanTestModels: true }, res);
  expect(res.json.mock.calls[0][0].job.files[0].result.rawResponse).toEqual(payload);
  for (const operation of ['updateFileResult', 'embedFileHighQuality']) {
    const denied = response();
    await controller[operation]({ params: { jobId: saved.id, fileId: saved.files[0].id }, body: {}, user: admin, ocrCanTestModels: true }, denied);
    expect(denied.status).toHaveBeenCalledWith(400);
  }
});
test('queued model tests recheck revoked capability before calling gateway', async () => {
  UseraccountModel.findById.mockResolvedValue({ ...admin, type_user: 'user' });
  await run({ model: 'teleocr' }, { text: 'unused' });
  expect(axios.post).not.toHaveBeenCalled();
  expect(saved.status).toBe('failed');
});
test('rejects unsupported model before storage or gateway work', async () => {
  const res = await run({ model: 'typo' }, {});
  expect(res.status).toHaveBeenCalledWith(400);
  expect(saved).toBeNull();
  expect(axios.post).not.toHaveBeenCalled();
});
test('capability grants and owner-only visibility do not admit unrelated accounts', async () => {
  expect(await canTestModels(admin)).toBe(true);
  for (const type_user of ['family', 'user']) expect(await canTestModels({ ...admin, type_user })).toBe(false);
  expect(await canTestModels(null)).toBe(false);
  RoleModel.findOne.mockResolvedValue({ permissions: ['ocr.jobs.test_models'] });
  expect(await canTestModels({ ...admin, type_user: 'user' })).toBe(true);
  expect(visibleJobs({ user: admin, ocrCanTestModels: true }).$or).toContainEqual({ 'owner.id': admin._id });
  expect(visibleJobs({ user: admin, ocrCanTestModels: false }).$or).not.toContainEqual({ 'owner.id': admin._id });
  saved = null;
  for (const operation of ['getJobDetails', 'deleteJob', 'updateFileResult', 'embedFileHighQuality']) {
    const res = response();
    await controller[operation]({ params: { jobId: 'foreign-job', fileId: 'file' }, body: {}, user: admin, ocrCanTestModels: true }, res);
    expect(OcrJob.findOne).toHaveBeenLastCalledWith({ _id: 'foreign-job', ...visibleJobs({ user: admin, ocrCanTestModels: true }) });
    expect(res.status).toHaveBeenCalledWith(404);
  }
});
