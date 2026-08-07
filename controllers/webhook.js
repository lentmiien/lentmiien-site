const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, BatchPromptModel, BatchRequestModel, SoraVideo } = require('../database');
const logger = require('../utils/logger');
const { emitConversationMessages, toClientMessage } = require('../utils/chat5Realtime');
const { unwrapOpenAIWebhook } = require('../utils/openaiWebhook');
const { PUSHOVER_PRIORITIES, sendPushoverNotification } = require('../utils/pushover');
const audioWorkflowService = require('../services/audioWorkflowInstance');
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);
const { fetchVideo, checkVideoProgress } = require('../utils/OpenAI_API');
const ollama = require('../utils/Ollama_API');

const { OpenAI } = require('openai');
const client = new OpenAI({ webhookSecret: process.env.OPENAI_WEBHOOK_SECRET });

const OLLAMA_TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function validateOllamaWebhookPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Payload must be a JSON object.' };
  }

  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
  if (!ollama.isValidChatJobId(jobId)) {
    return { error: 'Invalid or missing job_id.' };
  }

  const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
  if (!OLLAMA_TERMINAL_JOB_STATUSES.has(status)) {
    return { error: 'Invalid or nonterminal job status.' };
  }

  const expectedStatusUrl = `/llm/chat/jobs/${jobId}`;
  if (body.status_url !== undefined && body.status_url !== expectedStatusUrl) {
    return { error: 'status_url does not match job_id.' };
  }

  if (body.completed_at !== undefined && body.completed_at !== null) {
    const completedAt = Number(body.completed_at);
    if (!Number.isFinite(completedAt) || completedAt < 0) {
      return { error: 'completed_at must be a non-negative number.' };
    }
  }

  return {
    value: {
      jobId,
      status,
      statusUrl: expectedStatusUrl,
      completedAt: body.completed_at ?? null,
    },
  };
}

exports.openai = async (req, res) => {
  let event;

  try {
    event = await unwrapOpenAIWebhook({
      client,
      payload: req.body,
      headers: req.headers,
    });
  } catch (error) {
    if (error instanceof OpenAI.InvalidWebhookSignatureError) {
      logger.error('Invalid OpenAI webhook signature', error);
      return res.status(400).send('Invalid signature');
    }

    logger.error('Failed to unwrap OpenAI webhook event', error);
    return res.status(500).send('Server error');
  }

  logger.debug('OpenAI webhook event received', { type: event.type, data: event.data });

  res.status(200).send();

  try {
    if (event.type === 'video.completed') {
      const openaiId = event?.data?.id;

      if (!openaiId) {
        logger.warning('Video completed webhook missing video id', { event });
        return;
      }

      const videoDoc = await SoraVideo.findOne({ openaiId });

      if (!videoDoc) {
        logger.warning('Video completed webhook received for unknown Sora video', { openaiId });
        return;
      }

      try {
        const filename = await fetchVideo(openaiId);
        videoDoc.filename = filename;
        videoDoc.status = 'completed';
        videoDoc.progress = 100;
        videoDoc.completedAt = new Date();
        videoDoc.errorMessage = '';
        await videoDoc.save();
        logger.notice('Sora video marked completed via webhook', { openaiId, filename });
      } catch (downloadError) {
        videoDoc.status = 'failed';
        videoDoc.errorMessage = 'Download failed';
        await videoDoc.save();
        logger.error('Failed to download Sora video on completion webhook', { openaiId, downloadError });
      }
    }

    if (event.type === 'video.failed') {
      const openaiId = event?.data?.id;

      if (!openaiId) {
        logger.warning('Video failed webhook missing video id', { event });
        return;
      }

      const videoDoc = await SoraVideo.findOne({ openaiId });

      if (!videoDoc) {
        logger.warning('Video failed webhook received for unknown Sora video', { openaiId });
        return;
      }

      const status = await checkVideoProgress(openaiId);
      const progress = status && typeof status.progress === 'number'
        ? Math.max(0, Math.min(status.progress, 100))
        : videoDoc.progress;
      const rawError = status && status.error ? status.error : event?.data?.error;
      let errorMessage = '';

      if (rawError) {
        if (typeof rawError === 'string') {
          errorMessage = rawError;
        } else {
          try {
            errorMessage = JSON.stringify(rawError);
          } catch (jsonError) {
            errorMessage = String(rawError);
            logger.debug('Could not stringify video error payload', { jsonError });
          }
        }
      }

      videoDoc.status = 'failed';
      videoDoc.progress = progress;
      videoDoc.errorMessage = errorMessage || videoDoc.errorMessage || 'Video generation failed';
      await videoDoc.save();
      logger.notice('Sora video marked failed via webhook', { openaiId, progress, error: videoDoc.errorMessage });
    }

    if (event.type === 'batch.completed') {
      const batchId = event.data.id;

      try {
        await sendPushoverNotification({
          title: 'OpenAI batch completed',
          message: `Batch ${batchId} completed.`,
          priority: PUSHOVER_PRIORITIES.MEDIUM,
        });
        logger.notice('Pushover notification sent for completed batch', { batchId });
      } catch (notificationError) {
        logger.error('Failed to send Pushover notification for completed batch', {
          batchId,
          error: notificationError.message,
        });
      }

      await batchService.checkBatchStatus(batchId);
      const result = await batchService.processBatchResponses();

      const io = req.app.get('io');
      if (io && result && Array.isArray(result.conversations) && result.conversations.length > 0) {
        const roomForConversation = io.conversationRoom;
        const roomForUser = io.userRoom;

        for (const update of result.conversations) {
          const { conversationId, messages, placeholderId, members = [], title } = update;
          const convRoom = roomForConversation(conversationId);
          const clientMessages = messages.map(toClientMessage).filter(Boolean);
          io.to(convRoom).emit('chat5-messages', { id: conversationId, messages: clientMessages, placeholderId });
          io.to(convRoom).emit('chat5_6-messages', { id: conversationId, messages: clientMessages });
          if (Array.isArray(members) && members.length > 0) {
            const rooms = members.map(roomForUser);
            io.to(rooms).emit('chat5-notice', { id: conversationId, title });
          }
        }
      }
    }

    if (event.type === 'response.completed') {
      const response_id = event.data.id;
      const result = await conversationService.processCompletedResponse(response_id);

      if (!result) {
        logger.debug('No pending conversation claimed for completed response', { response_id });
        return;
      }

      const { conversation, messages, placeholder_id } = result;

      if (!conversation) {
        logger.warning('Conversation missing for completed response', { response_id });
        return;
      }

      await audioWorkflowService.handleOpenAiResponseCompleted(response_id, result);

      const io = req.app.get('io');

      if (!io) {
        logger.warning('Socket.IO instance not available for webhook response', { response_id });
        return;
      }

      emitConversationMessages(io, {
        conversation,
        messages,
        placeholderId: placeholder_id,
      });
    }

    if (event.type === 'response.cancelled' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      const response_id = event.data.id;
      const error_msg = await conversationService.processFailedResponse(response_id);
      await audioWorkflowService.handleOpenAiResponseFailed(response_id, error_msg);
      logger.debug(`Response failed [type=${event.type}]`, { error_msg });
    }
  } catch (error) {
    logger.error('Failed to process OpenAI webhook event', { error, type: event.type });
  }
};

exports.ollama = async (req, res) => {
  const token = typeof req.query?.token === 'string' ? req.query.token : '';
  if (!ollama.verifyWebhookToken(token)) {
    logger.warning('Rejected Ollama webhook with invalid authentication token', {
      category: 'ollama_webhook',
      metadata: {
        remoteAddress: req.ip || req.socket?.remoteAddress || null,
      },
    });
    return res.status(401).send('Unauthorized');
  }

  const validation = validateOllamaWebhookPayload(req.body);
  if (validation.error) {
    logger.warning('Rejected malformed Ollama webhook notification', {
      category: 'ollama_webhook',
      metadata: {
        error: validation.error,
        remoteAddress: req.ip || req.socket?.remoteAddress || null,
      },
    });
    return res.status(400).send('Invalid payload');
  }

  const notification = validation.value;
  logger.notice('Ollama webhook notification accepted', {
    category: 'ollama_webhook',
    metadata: {
      jobId: notification.jobId,
      notifiedStatus: notification.status,
      completedAt: notification.completedAt,
    },
  });

  // Acknowledge promptly so Gateway retry timing is independent of database,
  // result retrieval, tool execution, and Socket.IO delivery latency.
  res.status(200).send();

  try {
    const knownPendingJob = await conversationService.hasPendingResponse(notification.jobId, 'Ollama');
    if (!knownPendingJob) {
      logger.warning('Ignoring Ollama webhook for unknown or already-processed job', {
        category: 'ollama_webhook',
        metadata: {
          jobId: notification.jobId,
          notifiedStatus: notification.status,
        },
      });
      return;
    }

    // Never trust or follow a callback-supplied URL and never accept model
    // output in the webhook body. Fetch the canonical job endpoint instead.
    const job = await ollama.retrieveChatJob(notification.jobId);
    if (!job) {
      logger.error('Ollama webhook could not retrieve the notified job', {
        category: 'ollama_webhook',
        metadata: { jobId: notification.jobId },
      });
      return;
    }

    if (!OLLAMA_TERMINAL_JOB_STATUSES.has(job.status)) {
      logger.warning('Ollama webhook retrieval returned a nonterminal job', {
        category: 'ollama_webhook',
        metadata: {
          jobId: notification.jobId,
          notifiedStatus: notification.status,
          retrievedStatus: job.status,
        },
      });
      return;
    }

    if (job.status !== notification.status) {
      logger.warning('Ollama webhook status differed from canonical job status', {
        category: 'ollama_webhook',
        metadata: {
          jobId: notification.jobId,
          notifiedStatus: notification.status,
          retrievedStatus: job.status,
        },
      });
    }

    const io = req.app.get('io');

    if (job.status === 'completed') {
      const result = await conversationService.processCompletedResponse(notification.jobId, {
        retrievedResponse: job,
        responseProvider: 'Ollama',
      });
      if (!result) {
        logger.debug('No pending Ollama conversation claimed after job retrieval', {
          jobId: notification.jobId,
        });
        return;
      }

      const { conversation, messages, placeholder_id } = result;
      if (!conversation) {
        logger.warning('Conversation missing for completed Ollama job', {
          category: 'ollama_webhook',
          metadata: { jobId: notification.jobId },
        });
        return;
      }

      if (!io) {
        logger.warning('Socket.IO instance not available for Ollama webhook response', {
          category: 'ollama_webhook',
          metadata: { jobId: notification.jobId },
        });
        return;
      }

      emitConversationMessages(io, {
        conversation,
        messages,
        placeholderId: placeholder_id,
      });
      logger.notice('Completed Ollama job persisted and broadcast', {
        category: 'ollama_webhook',
        metadata: {
          jobId: notification.jobId,
          conversationId: conversation._id?.toString?.() || conversation.id?.toString?.() || null,
          placeholderId: placeholder_id,
          messageCount: Array.isArray(messages) ? messages.length : 0,
        },
      });
      return;
    }

    const failure = await conversationService.processFailedResponse(notification.jobId, {
      retrievedResponse: job,
      responseProvider: 'Ollama',
      returnResult: true,
    });
    if (failure && typeof failure === 'object' && failure.conversation) {
      if (io) {
        emitConversationMessages(io, {
          conversation: failure.conversation,
          messages: [],
          placeholderId: failure.placeholder_id,
        });
      }
      logger.warning('Failed Ollama job removed its pending placeholder', {
        category: 'ollama_webhook',
        metadata: {
          jobId: notification.jobId,
          status: job.status,
          conversationId: failure.conversation._id?.toString?.()
            || failure.conversation.id?.toString?.()
            || null,
          error: failure.error_msg,
        },
      });
      return;
    }

    logger.debug('No pending Ollama conversation claimed for failed job', {
      jobId: notification.jobId,
      status: job.status,
    });
  } catch (error) {
    logger.error('Failed to process Ollama webhook notification', {
      category: 'ollama_webhook',
      metadata: {
        jobId: notification.jobId,
        notifiedStatus: notification.status,
        error: error?.message || String(error),
      },
    });
  }
};
