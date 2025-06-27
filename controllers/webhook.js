const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, BatchPromptModel, BatchRequestModel } = require('../database');
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

const { OpenAI } = require('openai');
const client = new OpenAI({ webhookSecret: process.env.OPENAI_WEBHOOK_SECRET });

exports.openai = async (req, res) => {
  try {
    const event = await client.webhooks.unwrap(req.body, req.headers);

    // Send response first, then process data
    res.status(200).send();

    if (event.type === "batch.completed") {
      const response_id = event.data.id;
      // Process batch
      console.log("Batch completed:", response_id);
    }
  } catch (error) {
    // Note: The error class is on the *class*, not the instance
    if (error instanceof OpenAI.InvalidWebhookSignatureError) {
      console.error("Invalid signature", error);
      res.status(400).send("Invalid signature");
    } else {
      console.error(error);
      res.status(500).send("Server error");
    }
  }
};

