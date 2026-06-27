const TrainingDataService = require('../services/trainingDataService');

const trainingDataService = new TrainingDataService();

function redirectToConversation(conversationId, params = {}) {
  const id = conversationId || 'NEW';
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return `/chat5/chat/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}#pills-training`;
}

exports.createEntry = async (req, res) => {
  const conversationId = req.body?.conversation_id || req.body?.conversationId || 'NEW';
  try {
    await trainingDataService.createEntry({
      groupId: req.body?.group_id,
      conversationId,
      promptMessageIds: req.body?.prompt_message_ids,
      outputMessageId: req.body?.output_message_id,
      notes: req.body?.notes,
      createdBy: req.user?.name || '',
    });
    return res.redirect(redirectToConversation(conversationId, {
      training_success: 'Training entry added.',
    }));
  } catch (error) {
    return res.redirect(redirectToConversation(conversationId, {
      training_error: error?.message || 'Unable to add training entry.',
    }));
  }
};

exports.deleteEntry = async (req, res) => {
  const fallbackConversationId = req.body?.conversation_id || req.body?.conversationId || 'NEW';
  try {
    const result = await trainingDataService.deleteEntry(req.params.id);
    return res.redirect(redirectToConversation(result.conversationId || fallbackConversationId, {
      training_success: 'Training entry deleted.',
    }));
  } catch (error) {
    return res.redirect(redirectToConversation(fallbackConversationId, {
      training_error: error?.message || 'Unable to delete training entry.',
    }));
  }
};
