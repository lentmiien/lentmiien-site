const {
  TrainingGroupModel,
  TrainingEntryModel,
  Conversation5Model,
  Chat5Model,
} = require('../database');
const {
  normalizeGroupId,
  normalizeId,
  normalizeIdArray,
  buildTrainingSelectionKey,
  getMessageText,
  joinPromptTexts,
  buildTrainingCsv,
} = require('../utils/trainingDataExport');

function buildHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sortIdsByConversationOrder(ids, conversationMessageIds) {
  const order = new Map(conversationMessageIds.map((id, index) => [id, index]));
  return [...ids].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
}

class TrainingDataService {
  async createGroup({ groupId, description = '', createdBy = '' }) {
    const normalizedGroupId = normalizeGroupId(groupId);
    if (!normalizedGroupId) {
      throw buildHttpError('Training group id is required.');
    }

    return TrainingGroupModel.create({
      groupId: normalizedGroupId,
      description: typeof description === 'string' ? description.trim() : '',
      createdBy,
      updatedBy: createdBy,
    });
  }

  async updateGroup({ id, description = '', isActive = true, updatedBy = '' }) {
    const group = await TrainingGroupModel.findById(id);
    if (!group) {
      throw buildHttpError('Training group not found.', 404);
    }
    group.description = typeof description === 'string' ? description.trim() : '';
    group.isActive = isActive === true;
    group.updatedBy = updatedBy;
    return group.save();
  }

  async deleteGroup(id) {
    const group = await TrainingGroupModel.findById(id);
    if (!group) {
      throw buildHttpError('Training group not found.', 404);
    }
    const entryCount = await TrainingEntryModel.countDocuments({ groupId: group.groupId });
    if (entryCount > 0) {
      throw buildHttpError('Delete the training entries before deleting this group.');
    }
    await group.deleteOne();
    return { ok: true };
  }

  async listGroupsWithStats({ includeInactive = false } = {}) {
    const query = includeInactive ? {} : { isActive: true };
    const [groups, entryStats] = await Promise.all([
      TrainingGroupModel.find(query).sort({ groupId: 1 }).lean(),
      TrainingEntryModel.aggregate([
        {
          $group: {
            _id: '$groupId',
            entryCount: { $sum: 1 },
            conversationIds: { $addToSet: '$conversationId' },
            latestEntryAt: { $max: '$createdAt' },
          },
        },
      ]),
    ]);

    const statsByGroup = new Map(entryStats.map((stat) => [stat._id, stat]));
    return groups.map((group) => {
      const stat = statsByGroup.get(group.groupId) || {};
      return {
        ...group,
        stats: {
          entryCount: stat.entryCount || 0,
          conversationCount: Array.isArray(stat.conversationIds) ? stat.conversationIds.length : 0,
          latestEntryAt: stat.latestEntryAt || null,
        },
      };
    });
  }

  async listEntriesForConversation(conversationId) {
    const normalizedConversationId = normalizeId(conversationId);
    if (!normalizedConversationId || normalizedConversationId === 'NEW') return [];

    const [entries, groups] = await Promise.all([
      TrainingEntryModel.find({ conversationId: normalizedConversationId }).sort({ createdAt: -1 }).lean(),
      TrainingGroupModel.find().lean(),
    ]);
    const groupsById = new Map(groups.map((group) => [group.groupId, group]));
    return entries.map((entry) => ({
      ...entry,
      group: groupsById.get(entry.groupId) || null,
    }));
  }

  async createEntry({ groupId, conversationId, promptMessageIds, outputMessageId, notes = '', createdBy = '' }) {
    const normalizedGroupId = normalizeGroupId(groupId);
    const normalizedConversationId = normalizeId(conversationId);
    const normalizedOutputMessageId = normalizeId(outputMessageId);
    const normalizedPromptMessageIds = normalizeIdArray(promptMessageIds);

    if (!normalizedGroupId) {
      throw buildHttpError('Choose a training group.');
    }
    if (!normalizedConversationId || normalizedConversationId === 'NEW') {
      throw buildHttpError('Open a saved chat5 conversation first.');
    }
    if (!normalizedPromptMessageIds.length) {
      throw buildHttpError('Choose at least one prompt message.');
    }
    if (!normalizedOutputMessageId) {
      throw buildHttpError('Choose an output message.');
    }
    if (normalizedPromptMessageIds.includes(normalizedOutputMessageId)) {
      throw buildHttpError('The output message must be separate from the prompt messages.');
    }

    const [group, conversation] = await Promise.all([
      TrainingGroupModel.findOne({ groupId: normalizedGroupId }),
      Conversation5Model.findById(normalizedConversationId),
    ]);
    if (!group) {
      throw buildHttpError('Training group not found.', 404);
    }
    if (!group.isActive) {
      throw buildHttpError('This training group is inactive.');
    }
    if (!conversation) {
      throw buildHttpError('Conversation not found in chat5.', 404);
    }

    const conversationMessageIds = normalizeIdArray(conversation.messages);
    const messageSet = new Set(conversationMessageIds);
    const selectedIds = [...normalizedPromptMessageIds, normalizedOutputMessageId];
    const missingIds = selectedIds.filter((id) => !messageSet.has(id));
    if (missingIds.length) {
      throw buildHttpError('Selected messages must belong to the conversation.');
    }

    const outputIndex = conversationMessageIds.indexOf(normalizedOutputMessageId);
    const sortedPromptMessageIds = sortIdsByConversationOrder(normalizedPromptMessageIds, conversationMessageIds);
    const promptIndexes = sortedPromptMessageIds.map((id) => conversationMessageIds.indexOf(id));
    if (promptIndexes.some((index) => index < 0 || index >= outputIndex)) {
      throw buildHttpError('Prompt messages must appear before the output message.');
    }

    const messages = await Chat5Model.find({ _id: selectedIds });
    const messagesById = new Map(messages.map((message) => [message._id.toString(), message]));
    const promptMessages = sortedPromptMessageIds.map((id) => messagesById.get(id));
    const outputMessage = messagesById.get(normalizedOutputMessageId);
    if (promptMessages.some((message) => !message) || !outputMessage) {
      throw buildHttpError('Selected message data could not be loaded.');
    }
    if (!joinPromptTexts(promptMessages)) {
      throw buildHttpError('Selected prompt messages do not contain content.text.');
    }
    if (!getMessageText(outputMessage)) {
      throw buildHttpError('Selected output message does not contain content.text.');
    }

    const messageIds = [...sortedPromptMessageIds, normalizedOutputMessageId];
    const selectionKey = buildTrainingSelectionKey({
      conversationId: normalizedConversationId,
      promptMessageIds: sortedPromptMessageIds,
      outputMessageId: normalizedOutputMessageId,
    });

    try {
      return await TrainingEntryModel.create({
        groupId: normalizedGroupId,
        conversationId: normalizedConversationId,
        messageIds,
        promptMessageIds: sortedPromptMessageIds,
        outputMessageId: normalizedOutputMessageId,
        selectionKey,
        notes: typeof notes === 'string' ? notes.trim() : '',
        createdBy,
      });
    } catch (error) {
      if (error && error.code === 11000) {
        throw buildHttpError('This training entry already exists in the selected group.', 409);
      }
      throw error;
    }
  }

  async deleteEntry(entryId) {
    const entry = await TrainingEntryModel.findById(entryId);
    if (!entry) {
      throw buildHttpError('Training entry not found.', 404);
    }
    await entry.deleteOne();
    return { ok: true, conversationId: entry.conversationId };
  }

  async buildRowsForGroup(groupId) {
    const normalizedGroupId = normalizeGroupId(groupId);
    if (!normalizedGroupId) {
      throw buildHttpError('Training group id is required.');
    }

    const group = await TrainingGroupModel.findOne({ groupId: normalizedGroupId }).lean();
    if (!group) {
      throw buildHttpError('Training group not found.', 404);
    }

    const entries = await TrainingEntryModel.find({ groupId: normalizedGroupId }).sort({ createdAt: 1 }).lean();
    if (!entries.length) {
      return { group, rows: [], skipped: [] };
    }

    const conversationIds = normalizeIdArray(entries.map((entry) => entry.conversationId));
    const allMessageIds = normalizeIdArray(entries.flatMap((entry) => entry.messageIds || []));
    const [conversations, messages] = await Promise.all([
      Conversation5Model.find({ _id: conversationIds }).lean(),
      Chat5Model.find({ _id: allMessageIds }).lean(),
    ]);

    const conversationsById = new Map(conversations.map((conversation) => [conversation._id.toString(), conversation]));
    const messagesById = new Map(messages.map((message) => [message._id.toString(), message]));
    const rows = [];
    const skipped = [];

    entries.forEach((entry) => {
      const conversation = conversationsById.get(entry.conversationId);
      const promptMessages = normalizeIdArray(entry.promptMessageIds).map((id) => messagesById.get(id));
      const outputMessage = messagesById.get(entry.outputMessageId);
      const system = typeof conversation?.metadata?.contextPrompt === 'string' ? conversation.metadata.contextPrompt : '';
      const prompt = joinPromptTexts(promptMessages);
      const response = getMessageText(outputMessage);

      if (!conversation || promptMessages.some((message) => !message) || !outputMessage || !prompt || !response) {
        skipped.push({
          entryId: entry._id.toString(),
          reason: 'Missing conversation, message, prompt text, or output text.',
        });
        return;
      }

      rows.push({
        system,
        prompt,
        response,
        entryId: entry._id.toString(),
        conversationId: entry.conversationId,
      });
    });

    return { group, rows, skipped };
  }

  async buildCsvForGroup(groupId) {
    const result = await this.buildRowsForGroup(groupId);
    return {
      ...result,
      csv: buildTrainingCsv(result.rows),
    };
  }

  async buildDatasetFileForGroup(groupId) {
    const result = await this.buildCsvForGroup(groupId);
    const name = result.group.groupId;
    return {
      ...result,
      file: {
        originalname: `${name}.csv`,
        mimetype: 'text/csv',
        buffer: Buffer.from(result.csv, 'utf8'),
      },
      datasetName: name,
    };
  }
}

module.exports = TrainingDataService;
module.exports.TrainingDataService = TrainingDataService;
