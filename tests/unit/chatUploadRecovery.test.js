jest.mock('../../models/chat5', () => ({ updateOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../models/conversation5', () => ({ updateOne: jest.fn() }));
const Message = require('../../models/chat5');
const Conversation = require('../../models/conversation5');
const storage = require('../../services/localAi/inputStorage');
const { upload } = require('../../services/localAi/chatUpload');
const { errorDiagnostic } = require('../../services/localAi/diagnostics');
const { problem } = require('../../services/localAi/policy');
afterEach(() => jest.restoreAllMocks());
function fixture() {
  let record = null;
  const messages = new Map(), links = new Set(), published = new Map();
  const bytes = Buffer.from('original'), normalized = Buffer.from('normalized');
  jest.spyOn(storage, 'validateRaster').mockResolvedValue({});
  jest.spyOn(storage, 'read').mockResolvedValue(normalized);
  const service = {
    sourceAccess: jest.fn(async () => ({ user: { name: 'fixture' } })),
    db: { Input: { findOne: jest.fn(() => ({ lean: async () => record })) } },
    inputs: { capture: jest.fn(async (actor, key, content, source) => {
      if (!record) record = { _id: 'in_fixture', state: 'ready', source, descriptor: { bytes: content.length, sha256: storage.hash(content) } };
      return record;
    }) },
  };
  Message.updateOne.mockImplementation(async ({ _id }, update) => { if (!messages.has(_id)) messages.set(_id, { _id, ...update.$setOnInsert }); });
  Message.findById.mockImplementation(id => ({ lean: async () => messages.get(id) }));
  Conversation.updateOne.mockImplementation(async (_filter, update) => { links.add(update.$addToSet.messages); return { matchedCount: 1 }; });
  const input = { service, actor: { ownerId: 'owner' }, key: 'upload-key', conversationId: 'conversation', bytes,
    normalize: async options => {
      const content = options.frozenBytes || normalized;
      await options.beforePublish(content);
      published.set(options.filename, content);
    } };
  return { input, service, messages, links, published };
}
test('replaying a key after an uncertain database link retains one message, one file name and one membership', async () => {
  const f = fixture();
  Conversation.updateOne.mockImplementationOnce(async (_filter, update) => {
    f.links.add(update.$addToSet.messages);
    throw Object.assign(new Error('private connection detail'), { name: 'MongoNetworkError' });
  });
  const error = await upload(f.input).catch(value => value);
  expect(errorDiagnostic(error, 'chat5.upload')).toEqual({ operation: 'chat5.upload.link', reasonClass: 'mongo_network_error' });
  const recovered = await upload(f.input);
  const replay = await upload(f.input);
  expect(replay.userMessage._id).toBe(recovered.userMessage._id);
  expect(f.messages.size).toBe(1); expect(f.links.size).toBe(1); expect(f.published.size).toBe(1);
  expect(storage.read).toHaveBeenCalled();
  expect(storage.validateRaster).toHaveBeenCalledTimes(1);
  await expect(upload({ ...f.input, bytes: Buffer.from('different') })).rejects.toMatchObject({ code: 'idempotency_conflict' });
});
test.each(['invalid_image', 'unsupported_image', 'image_dimensions', 'input_decoder_busy'])('upload validation classifies %s without payloads', async code => {
  const f = fixture();
  storage.validateRaster.mockRejectedValue(problem(code, 413));
  const error = await upload(f.input).catch(value => value);
  expect(errorDiagnostic(error, 'chat5.upload')).toEqual({
    operation: 'chat5.upload.validate', reasonClass: 'application_error', reasonCode: code, applicationStatus: 413,
  });
  expect(f.messages.size).toBe(0); expect(f.published.size).toBe(0);
});
