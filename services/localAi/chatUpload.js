const Message = require('../../models/chat5');
const Conversation = require('../../models/conversation5');
const { digest, ID, problem } = require('./policy');
const storage = require('./inputStorage');
const { descriptor } = require('./inputs');
// Called only by the authenticated Socket.IO upload event after shared CSRF.
// IDs and source association are server-derived; mutable message fields are not
// provenance. Publication is repairable via the same key after either DB reply.
async function upload({ service, actor, key, conversationId, bytes, normalize }) {
  if (!ID.test(key || '') || conversationId === 'NEW') throw problem('save_conversation_before_media_upload', 409);
  const { user } = await service.sourceAccess({ ...actor, source: { conversationId } });
  const originalSha256 = storage.hash(bytes);
  let record = await service.db.Input.findOne({ ownerId: actor.ownerId, key }).lean();
  if (record && (record.source?.kind !== 'chat5-upload' || record.source.conversationId !== conversationId
    || record.source.originalSha256 !== originalSha256)) throw problem('idempotency_conflict', 409);
  if (record?.state !== 'ready') await storage.validateRaster(bytes);
  const messageId = digest(['chat5-upload', actor.ownerId, key]).slice(0, 24);
  const filename = `UP-${digest(['chat5-upload', actor.ownerId, key])}.jpg`;
  // Normalize through the existing trusted JPEG path, with exactly those same
  // bytes sent to the private store. No hidden format/quality transformation.
  const frozenBytes = record?.state === 'ready' ? await storage.read(record._id, record.descriptor) : null;
  await normalize({ filename, frozenBytes, beforePublish: async normalized => {
    record = await service.inputs.capture(actor, key, normalized, { kind: 'chat5-upload', conversationId,
      messageId, author: user.name, filename, originalSha256 });
  } });
  await service.sourceAccess({ ...actor, source: { conversationId } });
  await Message.updateOne({ _id: messageId }, { $setOnInsert: {
    user_id: user.name, category: 'upload', tags: [], contentType: 'image', embeddingRequested: false,
    content: { image: filename, revisedPrompt: 'Upload image', imageQuality: 'high' },
  } }, { upsert: true, writeConcern: { w: 'majority', j: true } });
  const linked = await Conversation.updateOne({ _id: conversationId, members: user.name }, { $addToSet: { messages: messageId } }, { writeConcern: { w: 'majority', j: true } });
  if (!linked.matchedCount) throw problem('source_access_revoked', 403);
  return { userMessage: await Message.findById(messageId).lean(), artifact: descriptor(record) };
}
async function startConversation({ service, actor, key }) {
  if (typeof key !== 'string' || !ID.test(key)) throw problem('idempotency_key_required', 400);
  const user = await service.principal(actor.ownerId, actor.tokenId);
  const { hasCapabilities } = require('../../utils/authorization');
  const { CHAT_BUNDLES } = require('./service');
  if (!await hasCapabilities(user, ['chat.conversation.read', 'chat.conversation.write'], {
    roleModel: require('../../models/role'), roleCapabilityBundles: CHAT_BUNDLES,
  })) throw problem('forbidden', 403);
  const id = digest(['chat5-upload-conversation', actor.ownerId, key]).slice(0, 24);
  await Conversation.updateOne({ _id: id, members: user.name }, { $setOnInsert: {
    title: 'NEW', category: 'Chat5', tags: ['chat5'], members: [user.name], messages: [],
    metadata: { model: 'gpt-5.6-luna' },
  } }, { upsert: true, writeConcern: { w: 'majority', j: true } });
  return id;
}
module.exports = { upload, startConversation };
