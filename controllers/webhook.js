const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, BatchPromptModel, BatchRequestModel, SoraVideo } = require('../database');
const logger = require('../utils/logger');
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);
const { fetchVideo, checkVideoProgress } = require('../utils/OpenAI_API');

const { OpenAI } = require('openai');
const client = new OpenAI({ webhookSecret: process.env.OPENAI_WEBHOOK_SECRET });

exports.openai = async (req, res) => {
  let event;

  try {
    event = await client.webhooks.unwrap(req.body, req.headers);
  } catch (error) {
    if (error instanceof OpenAI.InvalidWebhookSignatureError) {
      logger.error('Invalid signature', error);
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
      const response_id = event.data.id;
      await batchService.checkBatchStatus(response_id);
      await batchService.processBatchResponses();
    }

    if (event.type === 'response.completed') {
      const response_id = event.data.id;
      const result = await conversationService.processCompletedResponse(response_id);

      if (!result) {
        logger.warning('No pending conversation for completed response', { response_id });
        return;
      }

      const { conversation, messages } = result;

      if (!conversation) {
        logger.warning('Conversation missing for completed response', { response_id });
        return;
      }

      const io = req.app.get('io');

      if (!io) {
        logger.warning('Socket.IO instance not available for webhook response', { response_id });
        return;
      }

      const roomForUser = io.userRoom;
      const roomForConversation = io.conversationRoom;
      const convRoom = roomForConversation(conversation._id.toString());
      io.to(convRoom).emit('chat5-messages', { id: conversation._id.toString(), messages });
      const rooms = conversation.members.map(roomForUser);
      io.to(rooms).emit('chat5-notice', { id: conversation._id.toString(), title: conversation.title });
    }
  } catch (error) {
    logger.error('Failed to process OpenAI webhook event', { error, type: event.type });
  }
};
