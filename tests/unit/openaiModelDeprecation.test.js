jest.mock('../../models/ai_model_card', () => ({ find: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));

let cards;
let logger;
let assertActive;
let assertBatchActive;
let query;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 3, 12));
  cards = require('../../models/ai_model_card');
  logger = require('../../utils/logger');
  query = { maxTimeMS: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) };
  cards.find.mockReturnValue(query);
  const guard = require('../../utils/openaiModelDeprecation');
  assertActive = guard.assertOpenAIModelActive;
  assertBatchActive = guard.assertOpenAIBatchModelsActive;
});

afterEach(() => jest.useRealTimers());

test.each([null, '2027-02-04'])('allows cards without imminent deprecation (%s)', async (date) => {
  query.lean.mockResolvedValue([{ deprecation_date: date }]);
  await expect(assertActive('test-model', 'responses.create')).resolves.toBeUndefined();
  expect(cards.find).toHaveBeenCalledWith({ provider: 'OpenAI', api_model: 'test-model' }, { deprecation_date: 1 });
  expect(query.maxTimeMS).toHaveBeenCalledWith(5000);
  expect(logger.warning).not.toHaveBeenCalled();
  expect(logger.error).not.toHaveBeenCalled();
});

test.each(['2026-11-04', '2027-01-01', '2027-02-03'])('warns for %s within three calendar months', async (date) => {
  query.lean.mockResolvedValue([{ deprecation_date: new Date(date) }]);
  await assertActive('test-model', 'responses.create');
  expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('within three months'), {
    category: 'openai_model_deprecation',
    metadata: { model: 'test-model', operation: 'responses.create', deprecationDate: date },
  });
});

test.each(['2026-11-02', '2026-11-03'])('blocks on or after the deprecation date (%s)', async (date) => {
  query.lean.mockResolvedValue([{ deprecation_date: date }]);
  await expect(assertActive('test-model', 'responses.create')).rejects.toMatchObject({ code: 'OPENAI_MODEL_DEPRECATED' });
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('model is deprecated'), {
    category: 'openai_model_deprecation', metadata: expect.objectContaining({ model: 'test-model', deprecationDate: date }),
  });
});

test('clamps the warning horizon at the end of the month', async () => {
  jest.setSystemTime(new Date(2026, 10, 30, 12));
  query.lean.mockResolvedValueOnce([{ deprecation_date: '2027-02-28' }])
    .mockResolvedValueOnce([{ deprecation_date: '2027-03-01' }]);
  await assertActive('last-day', 'responses.create');
  await assertActive('outside-window', 'responses.create');
  expect(logger.warning).toHaveBeenCalledTimes(1);
});

test('deduplicates warnings but rechecks edited dates and date rollover', async () => {
  query.lean.mockResolvedValue([{ deprecation_date: '2027-01-01' }]);
  await assertActive('test-model', 'responses.create');
  await assertActive('test-model', 'chat.completions.create');
  expect(logger.warning).toHaveBeenCalledTimes(1);
  jest.setSystemTime(new Date(2026, 10, 4, 12));
  await assertActive('test-model', 'responses.create');
  expect(logger.warning).toHaveBeenCalledTimes(2);
  query.lean.mockResolvedValue([{ deprecation_date: '2026-11-04' }]);
  await expect(assertActive('test-model', 'responses.create')).rejects.toMatchObject({ code: 'OPENAI_MODEL_DEPRECATED' });
  expect(cards.find).toHaveBeenCalledTimes(4);
});

test('uses the earliest date when duplicate cards exist', async () => {
  query.lean.mockResolvedValue([{ deprecation_date: null }, { deprecation_date: '2027-05-01' }, { deprecation_date: '2026-11-01' }]);
  await expect(assertActive('test-model', 'responses.create')).rejects.toMatchObject({ code: 'OPENAI_MODEL_DEPRECATED' });
});

test('allows an unregistered model with an actionable warning', async () => {
  await assertActive('test-model', 'responses.create');
  await assertActive('test-model', 'responses.create');
  expect(logger.warning).toHaveBeenCalledTimes(1);
  expect(logger.warning.mock.calls[0][0]).toContain('model card missing');
});

test.each(['invalid-date', new Date(NaN)])('blocks invalid model-card dates', async (date) => {
  query.lean.mockResolvedValue([{ deprecation_date: date }]);
  await expect(assertActive('test-model', 'responses.create')).rejects.toMatchObject({ code: 'OPENAI_MODEL_CHECK_FAILED' });
});

test('blocks lookup failures without logging database details', async () => {
  query.lean.mockRejectedValue(new Error('sensitive database connection string'));
  await expect(assertActive('test-model', 'responses.create')).rejects.toMatchObject({ code: 'OPENAI_MODEL_CHECK_FAILED' });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sensitive database');
});

test.each([null, { $ne: '' }, '', 'model\nsecret'])('rejects invalid identifiers before querying cards (%p)', async model => {
  await expect(assertActive(model, 'responses.create')).rejects.toMatchObject({ code: 'OPENAI_MODEL_INVALID' });
  expect(cards.find).not.toHaveBeenCalled();
});

test('checks every distinct batch model and rejects a mixed batch with a deprecated model', async () => {
  query.lean.mockResolvedValueOnce([{ deprecation_date: null }])
    .mockResolvedValueOnce([{ deprecation_date: '2026-01-01' }]);
  const lines = ['active', 'active', 'retired'].map(model => JSON.stringify({ body: { model, input: 'private prompt' } }));
  await expect(assertBatchActive(lines.join('\n'), 'files.create.batch')).rejects.toMatchObject({ code: 'OPENAI_MODEL_DEPRECATED' });
  expect(cards.find).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private prompt');
});

test('rejects unreadable batch input without logging its contents', async () => {
  await expect(assertBatchActive('private invalid json', 'files.create.batch')).rejects.toMatchObject({ code: 'OPENAI_MODEL_CHECK_FAILED' });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private invalid json');
});
