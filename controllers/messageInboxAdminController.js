const logger = require('../utils/logger');
const { MessageInboxService, DEFAULT_RETENTION_DAYS } = require('../services/messageInboxService');
const { MessageInboxEntry, MessageFilter } = require('../database');

const messageInboxService = new MessageInboxService(MessageInboxEntry, MessageFilter);
const PAGE_SIZE = 25;
const FEEDBACK_STATUSES = new Set(['success', 'error', 'info']);

function formatDateInput(date) {
  if (!date) {
    return '';
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseBooleanInput(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function buildFeedback(query) {
  const status = typeof query.status === 'string' ? query.status.toLowerCase() : null;
  const message = typeof query.message === 'string' ? query.message : null;
  if (!status || !message || !FEEDBACK_STATUSES.has(status)) {
    return null;
  }
  return { status, message };
}

function redirectWithFeedback(res, path, status, message) {
  const normalizedStatus = FEEDBACK_STATUSES.has(status) ? status : 'info';
  const encodedMessage = message ? encodeURIComponent(message) : '';
  const location = encodedMessage
    ? `${path}?status=${normalizedStatus}&message=${encodedMessage}`
    : path;
  return res.redirect(location);
}

exports.renderMessageInbox = async (req, res) => {
  try {
    const requestedPage = Number.parseInt(req.query.page, 10) || 1;
    const totalMessages = await MessageInboxEntry.countDocuments().exec();
    const totalPages = Math.max(1, Math.ceil(totalMessages / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage, 1), totalPages);

    const { messages } = await messageInboxService.listMessages({ page, pageSize: PAGE_SIZE });
    const viewModel = messages.map((message) => {
      const id = message._id ? String(message._id) : '';
      return {
        ...message,
        _id: id,
        retentionDateInput: formatDateInput(message.retentionDeadlineDate),
        formattedDate: formatDateInput(message.date),
      };
    });

    return res.render('admin_message_inbox', {
      messages: viewModel,
      page,
      totalPages,
      totalMessages,
      feedback: buildFeedback(req.query),
    });
  } catch (error) {
    logger.error('Failed to load message inbox', {
      category: 'message_inbox_admin',
      metadata: { error: error.message },
    });
    res.status(500);
    return res.render('error_page', { error: 'Unable to load message inbox.' });
  }
};

exports.updateMessage = async (req, res) => {
  const id = req.body.id;
  const retentionDateInput = req.body.retentionDeadlineDate;
  const hasEmbedding = parseBooleanInput(req.body.hasEmbedding);
  const hasHighQualityEmbedding = parseBooleanInput(req.body.hasHighQualityEmbedding);

  if (!id) {
    return redirectWithFeedback(res, '/admin/message-inbox', 'error', 'Message id is required.');
  }

  let parsedDate = null;
  if (retentionDateInput) {
    parsedDate = new Date(retentionDateInput);
    if (Number.isNaN(parsedDate.getTime())) {
      return redirectWithFeedback(res, '/admin/message-inbox', 'error', 'Invalid retention date.');
    }
  }

  try {
    await messageInboxService.updateMessageSettings(id, {
      retentionDeadlineDate: parsedDate || undefined,
      hasEmbedding,
      hasHighQualityEmbedding,
    });
    return redirectWithFeedback(res, '/admin/message-inbox', 'success', 'Message updated.');
  } catch (error) {
    logger.error('Failed to update message', {
      category: 'message_inbox_admin',
      metadata: { error: error.message, id },
    });
    return redirectWithFeedback(res, '/admin/message-inbox', 'error', 'Unable to update message.');
  }
};

exports.deleteMessage = async (req, res) => {
  const id = req.body.id;
  if (!id) {
    return redirectWithFeedback(res, '/admin/message-inbox', 'error', 'Message id is required.');
  }
  try {
    await messageInboxService.deleteMessage(id);
    return redirectWithFeedback(res, '/admin/message-inbox', 'success', 'Message deleted.');
  } catch (error) {
    logger.error('Failed to delete message', {
      category: 'message_inbox_admin',
      metadata: { error: error.message, id },
    });
    return redirectWithFeedback(res, '/admin/message-inbox', 'error', 'Unable to delete message.');
  }
};

exports.renderFilters = async (req, res) => {
  try {
    const filters = (await messageInboxService.listFilters()).map((filter) => ({
      ...filter,
      _id: filter._id ? String(filter._id) : '',
    }));
    return res.render('admin_message_filters', {
      filters,
      defaultRetentionDays: DEFAULT_RETENTION_DAYS,
      feedback: buildFeedback(req.query),
    });
  } catch (error) {
    logger.error('Failed to load message filters', {
      category: 'message_inbox_admin',
      metadata: { error: error.message },
    });
    res.status(500);
    return res.render('error_page', { error: 'Unable to load message filters.' });
  }
};

exports.saveFilter = async (req, res) => {
  const { sender, retentionDays } = req.body;
  const generateEmbedding = parseBooleanInput(req.body.generateEmbedding);
  const generateHighQualityEmbedding = parseBooleanInput(req.body.generateHighQualityEmbedding);

  try {
    await messageInboxService.upsertFilter({
      sender,
      retentionDays,
      generateEmbedding,
      generateHighQualityEmbedding,
    });
    return redirectWithFeedback(res, '/admin/message-filters', 'success', 'Filter saved.');
  } catch (error) {
    logger.error('Failed to save filter', {
      category: 'message_inbox_admin',
      metadata: { error: error.message, sender },
    });
    return redirectWithFeedback(res, '/admin/message-filters', 'error', error.message || 'Unable to save filter.');
  }
};

exports.deleteFilter = async (req, res) => {
  const { filterId } = req.body;
  if (!filterId) {
    return redirectWithFeedback(res, '/admin/message-filters', 'error', 'Filter id is required.');
  }
  try {
    await messageInboxService.deleteFilter(filterId);
    return redirectWithFeedback(res, '/admin/message-filters', 'success', 'Filter deleted.');
  } catch (error) {
    logger.error('Failed to delete filter', {
      category: 'message_inbox_admin',
      metadata: { error: error.message, filterId },
    });
    return redirectWithFeedback(res, '/admin/message-filters', 'error', 'Unable to delete filter.');
  }
};

exports.addLabelRule = async (req, res) => {
  const { filterId, label, retentionDays } = req.body;
  const generateEmbedding = parseBooleanInput(req.body.labelGenerateEmbedding);
  const generateHighQualityEmbedding = parseBooleanInput(req.body.labelGenerateHighQualityEmbedding);

  try {
    await messageInboxService.addOrUpdateLabelRule(filterId, {
      label,
      retentionDays,
      generateEmbedding,
      generateHighQualityEmbedding,
    });
    return redirectWithFeedback(res, '/admin/message-filters', 'success', 'Label rule saved.');
  } catch (error) {
    logger.error('Failed to save label rule', {
      category: 'message_inbox_admin',
      metadata: { error: error.message, filterId, label },
    });
    return redirectWithFeedback(res, '/admin/message-filters', 'error', error.message || 'Unable to save label rule.');
  }
};

exports.removeLabelRule = async (req, res) => {
  const { filterId, label } = req.body;
  try {
    await messageInboxService.removeLabelRule(filterId, label);
    return redirectWithFeedback(res, '/admin/message-filters', 'success', 'Label rule removed.');
  } catch (error) {
    logger.error('Failed to remove label rule', {
      category: 'message_inbox_admin',
      metadata: { error: error.message, filterId, label },
    });
    return redirectWithFeedback(res, '/admin/message-filters', 'error', error.message || 'Unable to remove label rule.');
  }
};
