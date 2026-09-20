const { createHash } = require('crypto');
const logger = require('../utils/logger');

const CLAIM_RENEWAL_MS = 60 * 1000;

function completionMessageId(responseId, itemKey) {
  return createHash('sha256').update(JSON.stringify(['chat5-completion', responseId, itemKey]))
    .digest('hex').slice(0, 24);
}

function pendingClaimFilter(pending) {
  return { _id: pending._id, ...(pending.processingToken ? { processingToken: pending.processingToken } : {}) };
}

function completionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertMatched(result) {
  if (result?.matchedCount === 0) {
    throw completionError('CHAT5_CLAIM_LOST', 'AI response processing ownership was lost');
  }
}

// The token fences stale workers; the heartbeat keeps a live long-running tool
// from being claimed by webhook recovery. No payloads are included in diagnostics.
function startPendingLease(model, pending) {
  let stopped = false;
  let failure = null;
  let renewal = null;
  const assertOwned = async () => {
    if (failure) throw failure;
    if (!renewal) {
      renewal = (async () => {
        const result = await model.updateOne(pendingClaimFilter(pending), {
          $set: { processingStartedAt: new Date() },
        });
        assertMatched(result);
      })().catch((error) => {
        failure = completionError('CHAT5_CLAIM_LOST', 'Unable to renew AI response processing ownership');
        logger.warning('AI response processing claim renewal failed; stopping further actions', {
          category: 'chat5_completion',
          metadata: { responseId: pending.response_id, code: error?.code || null },
        });
        throw failure;
      }).finally(() => { renewal = null; });
    }
    await renewal;
  };
  const timer = setInterval(() => {
    if (!stopped && !failure) assertOwned().catch(() => {});
  }, CLAIM_RENEWAL_MS);
  timer.unref?.();
  return {
    assertOwned,
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (renewal) await renewal.catch(() => {});
    },
  };
}

// Apply only this completion's additions/removals to the latest array. Bump the
// version so an older Mongoose save cannot silently overwrite the atomic edit.
async function updateConversationMessages(model, conversationId, {
  add = [], remove = [], requiredMessageId = null,
} = {}) {
  const additions = [...new Set(add.map(String))];
  const removals = [...new Set(remove.map(String))];
  const existing = { $ifNull: ['$messages', []] };
  return model.findOneAndUpdate({
    _id: conversationId,
    ...(requiredMessageId ? { messages: String(requiredMessageId) } : {}),
  }, [{ $set: {
    messages: { $concatArrays: [
      { $filter: { input: existing, as: 'id', cond: { $not: [{ $in: ['$$id', { $literal: removals }] }] } } },
      { $filter: { input: { $literal: additions }, as: 'id', cond: { $not: [{ $in: ['$$id', existing] }] } } },
    ] },
    __v: { $add: [{ $ifNull: ['$__v', 0] }, 1] },
    updatedAt: '$$NOW',
  } }], { new: true, updatePipeline: true });
}

module.exports = { completionMessageId, pendingClaimFilter, completionError, assertMatched,
  startPendingLease, updateConversationMessages, CLAIM_RENEWAL_MS };
