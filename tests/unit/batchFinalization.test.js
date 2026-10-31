const mockConversations = new Map();
jest.mock('../../database', () => ({
  AIModelCards: { find: jest.fn().mockResolvedValue([]) },
  Conversation5Model: { findById: jest.fn(async id => mockConversations.get(id) || null) },
}));
jest.mock('../../models/role', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../../models/useraccount', () => ({ findById: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), warn: jest.fn(), error: jest.fn(), notice: jest.fn() }));
jest.mock('../../utils/OpenAI_API', () => ({
  downloadBatchOutput: jest.fn(), deleteBatchFile: jest.fn(), retrieveBatchStatus: jest.fn(),
  convertResponseBody: jest.fn(async body => [...body.output, { error: null }]),
}));
const api = require('../../utils/OpenAI_API');
const BatchService = require('../../services/batchService');
const logger = require('../../utils/logger');
const admin = { _id: 'a'.repeat(24), name: 'synthetic', type_user: 'admin' };

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(doc, item));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value) return (doc[key] !== undefined) === value.$exists;
      if ('$lte' in value) return doc[key] <= value.$lte;
      if ('$ne' in value) return doc[key] !== value.$ne;
    }
    return value === null ? doc[key] == null : doc[key] === value;
  });
}
function model(docs) {
  const update = (doc, values) => {
    Object.assign(doc, values.$set);
    for (const key of Object.keys(values.$unset || {})) delete doc[key];
    for (const [key, increment] of Object.entries(values.$inc || {})) doc[key] = (doc[key] || 0) + increment;
  };
  return {
    find: jest.fn(async filter => docs.filter(doc => matches(doc, filter || {})).map(doc => structuredClone(doc))),
    findOne: jest.fn(async filter => structuredClone(docs.find(doc => matches(doc, filter)) || null)),
    findOneAndUpdate: jest.fn(async (filter, values) => {
      const doc = docs.find(doc => matches(doc, filter));
      if (!doc) return null;
      update(doc, values); return structuredClone(doc);
    }),
    updateOne: jest.fn(async (filter, values) => {
      const doc = docs.find(doc => matches(doc, filter));
      if (!doc) return { matchedCount: 0 };
      update(doc, values); return { matchedCount: 1 };
    }),
    deleteOne: jest.fn(),
  };
}
function fixture(types = ['response']) {
  const request = { id: 'batch-1', status: 'completed', input_file_id: 'input', output_file_id: 'output', error_file_id: 'errors' };
  const prompts = types.map((type, i) => ({ custom_id: `prompt-${i}`, request_id: request.id, conversation_id: `conv-${i}`,
    user_id: 'synthetic', task_type: type, message_id: type === 'summary' ? null : `ph-${i}`, state: 'queued' }));
  for (const prompt of prompts) mockConversations.set(prompt.conversation_id, { _id: prompt.conversation_id,
    messages: ['source', ...(prompt.message_id ? [prompt.message_id] : [])], save: jest.fn(), category: 'test', tags: [] });
  const promptModel = model(prompts), requestModel = model([request]);
  const messages = { deleteMessages: jest.fn(async () => 1), createMessageNew: jest.fn(async () => ({ _id: 'retry-placeholder' })),
    processConvertedOutputs: jest.fn(async (_conversation, outputs, { responseId }) => outputs.map((output, i) => ({ ...output, _id: `${responseId}:${i}` }))) };
  const conversations = { updateConversationDetails: jest.fn() };
  const service = new BatchService(promptModel, requestModel, messages, conversations, { getValue: async () => null });
  api.downloadBatchOutput.mockImplementation(async id => id === 'output' ? prompts.map(prompt => success(prompt.custom_id)) : []);
  return { service, prompts, request, messages, conversations, promptModel, requestModel };
}
function success(id, output = [{ contentType: 'text', content: { text: 'Synthetic response' } }]) {
  return { custom_id: id, response: { status_code: 200, body: { status: 'completed', output } } };
}
beforeEach(() => { jest.clearAllMocks(); mockConversations.clear(); BatchService.invalidateBatchModelCache(); });

test('reconciles mixed output/error files by ID, retains failures, and counts local outcomes', async () => {
  const f = fixture(['response', 'response', 'response', 'summary', 'summary']);
  api.downloadBatchOutput.mockImplementation(async id => id === 'output' ? [success('prompt-0'),
    success('prompt-3', [{ type: 'message', content: [{ type: 'output_text', text: 'Summary' }] }]), success('prompt-4', [])]
    : [{ custom_id: 'prompt-1', error: { code: 'batch_expired', message: 'PRIVATE BODY' } }]);
  const result = await f.service.processBatchResponses();
  expect(result.outcomes).toEqual([{ requestId: 'batch-1', succeeded: 2, failed: 3 }]);
  expect(f.prompts.map(p => p.state)).toEqual(['succeeded', 'failed', 'failed', 'succeeded', 'failed']);
  expect(f.prompts[1].failure).toMatchObject({ reason: 'provider_error', providerCode: 'batch_expired' });
  expect(f.prompts[2].failure.reason).toBe('missing_response_record');
  expect(f.prompts[4].failure.reason).toBe('empty_summary');
  expect(f.conversations.updateConversationDetails).toHaveBeenCalledWith('conv-3', { summary: 'Summary' });
  expect(f.request).toMatchObject({ status: 'DONE', result_counts: { succeeded: 2, failed: 3 } });
  expect(api.deleteBatchFile.mock.calls.map(([id]) => id).sort()).toEqual(['errors', 'input', 'output']);
  expect(f.promptModel.deleteOne).not.toHaveBeenCalled();
  expect(JSON.stringify([f.prompts, logger.warning.mock.calls, logger.error.mock.calls])).not.toContain('PRIVATE BODY');
});

test('an unreadable error file defers all processing and file deletion', async () => {
  const f = fixture(); api.downloadBatchOutput.mockImplementation(async id => id === 'output' ? [success('prompt-0')] : null);
  expect((await f.service.processBatchResponses()).outcomes).toEqual([]);
  expect(f.request.status).toBe('completed'); expect(f.prompts[0].state).toBe('queued');
  expect(f.messages.processConvertedOutputs).not.toHaveBeenCalled(); expect(api.deleteBatchFile).not.toHaveBeenCalled();
});

test('error-only batches and entirely missing output both retain explicit failures', async () => {
  const f = fixture(); f.request.output_file_id = 'null';
  api.downloadBatchOutput.mockResolvedValue([{ custom_id: 'prompt-0', response: { status_code: 400, body: { error: { code: 'PRIVATE' } } } }]);
  expect((await f.service.processBatchResponses()).outcomes[0].failed).toBe(1);
  expect(f.prompts[0].failure).toMatchObject({ status: 400, providerCode: null });
});

test('a conversion containing only the empty error marker is a visible failure', async () => {
  const f = fixture();
  api.downloadBatchOutput.mockImplementation(async id => id === 'output' ? [success('prompt-0', [])] : []);
  await f.service.processBatchResponses();
  expect(f.prompts[0]).toMatchObject({ state: 'failed', failure: { reason: 'invalid_response_output' } });
  expect(f.messages.processConvertedOutputs).not.toHaveBeenCalled();
});

test('provider records cannot select another batch and duplicate IDs are failed conservatively', async () => {
  const f = fixture();
  f.prompts.push({ custom_id: 'prompt-foreign', request_id: 'other-batch', state: 'queued' });
  api.downloadBatchOutput.mockResolvedValue([success('prompt-0'), success('prompt-foreign')]);
  await f.service.processBatchResponses();
  expect(f.prompts[0].failure.reason).toBe('duplicate_response_record');
  expect(f.prompts[1].state).toBe('queued'); expect(f.messages.processConvertedOutputs).not.toHaveBeenCalled();
});

test('failure persistence must succeed before placeholder removal or batch finalization', async () => {
  const f = fixture(); api.downloadBatchOutput.mockResolvedValue([]);
  f.promptModel.updateOne.mockRejectedValueOnce(new Error('PRIVATE database detail'));
  expect((await f.service.processBatchResponses()).outcomes).toEqual([]);
  expect(f.messages.deleteMessages).not.toHaveBeenCalled(); expect(api.deleteBatchFile).not.toHaveBeenCalled();
  expect(f.request.status).toBe('completed');
});

test('concurrent and repeated completions deliver one import and one finalization outcome', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.processBatchResponses(), f.service.processBatchResponses()]);
  expect(results.flatMap(r => r.outcomes)).toHaveLength(1);
  expect(f.messages.processConvertedOutputs).toHaveBeenCalledTimes(1);
  expect(f.messages.processConvertedOutputs.mock.calls[0][2]).toEqual({ responseId: 'batch:batch-1:prompt-0' });
  expect((await f.service.processBatchResponses()).outcomes).toEqual([]);
  await f.service.checkBatchStatus(f.request.id);
  expect(api.retrieveBatchStatus).not.toHaveBeenCalled();
});

test('interrupted finalization resumes after lease expiry without redelivering persisted successes', async () => {
  const f = fixture(); f.request.processing_token = 'old'; f.request.processing_expires_at = new Date(Date.now() - 1);
  f.prompts[0].state = 'succeeded';
  expect((await f.service.processBatchResponses()).outcomes).toEqual([{ requestId: 'batch-1', succeeded: 1, failed: 0 }]);
  expect(f.messages.processConvertedOutputs).not.toHaveBeenCalled();
});

test('explicit retry retains the last failure and queues only once with a server-derived principal', async () => {
  const f = fixture(); api.downloadBatchOutput.mockResolvedValue([]); await f.service.processBatchResponses();
  const originalFailure = structuredClone(f.prompts[0].failure);
  const results = await Promise.allSettled([f.service.retryFailedPrompt('prompt-0', admin), f.service.retryFailedPrompt('prompt-0', admin)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(f.prompts[0]).toMatchObject({ state: 'queued', request_id: 'new', retry_count: 1, retry_principal_id: admin._id, failure: originalFailure });
  expect(f.messages.createMessageNew).toHaveBeenCalledTimes(1);
  expect(mockConversations.get('conv-0').messages).toEqual(['source', 'retry-placeholder']);
});

test.each(['not_failed', 'not_finalized', 'limit', 'missing_conversation'])(
  'retry rejects an ineligible record before claiming or creating a placeholder: %s', async condition => {
    const f = fixture(); api.downloadBatchOutput.mockResolvedValue([]); await f.service.processBatchResponses();
    if (condition === 'not_failed') f.prompts[0].state = 'succeeded';
    if (condition === 'not_finalized') f.request.status = 'completed';
    if (condition === 'limit') f.prompts[0].retry_count = 5;
    if (condition === 'missing_conversation') mockConversations.clear();
    await expect(f.service.retryFailedPrompt('prompt-0', admin)).rejects.toMatchObject({ status: condition === 'not_failed' ? 404 : 409 });
    expect(f.messages.createMessageNew).not.toHaveBeenCalled();
  },
);

test('summary retries preserve the failure without creating a response placeholder', async () => {
  const f = fixture(['summary']); api.downloadBatchOutput.mockResolvedValue([]); await f.service.processBatchResponses();
  await f.service.retryFailedPrompt('prompt-0', admin);
  expect(f.prompts[0]).toMatchObject({ state: 'queued', request_id: 'new', message_id: null, failure: { reason: 'missing_response_record' } });
  expect(f.messages.createMessageNew).not.toHaveBeenCalled();
});

test('failed retry preparation stays visible and cannot be automatically dispatched', async () => {
  const f = fixture(); api.downloadBatchOutput.mockResolvedValue([]); await f.service.processBatchResponses();
  f.messages.createMessageNew.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(f.service.retryFailedPrompt('prompt-0', admin)).rejects.toMatchObject({ status: 503 });
  expect(f.prompts[0]).toMatchObject({ state: 'retrying', request_id: 'batch-1' });
});

test.each([null, { ...admin, type_user: 'user' }, { ...admin, type_user: 'family' }])('retry denies a principal without management capability', async principal => {
  const f = fixture();
  await expect(f.service.retryFailedPrompt('prompt-0', principal)).rejects.toMatchObject({ status: 403 });
  expect(f.promptModel.findOne).not.toHaveBeenCalled();
});

test('revoked retry authority is checked before any provider dispatch', async () => {
  const f = fixture();
  f.prompts[0].request_id = 'new'; f.prompts[0].retry_principal_id = admin._id;
  require('../../models/useraccount').findById.mockReturnValue({ select: async () => null });
  await f.service.triggerBatchRequest();
  expect(f.prompts[0]).toMatchObject({ state: 'failed', failure: { reason: 'retry_authorization_revoked' } });
});
