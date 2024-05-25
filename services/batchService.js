const { upload_file, download_file, delete_file, start_batch, batch_status } = require('../utils/ChatGPT');

/*
const mongoose = require('mongoose');

const BatchPrompt = new mongoose.Schema({
  custom_id: { type: String, required: true },
  conversation_id: { type: String, required: true, max: 100 },
  request_id: { type: String, required: true, max: 100 },
  user_id: { type: String, required: true, max: 100 },
  prompt: { type: String, required: true },
  response: { type: String },
  images: [
    {
      filename: { type: String, required: true },
      use_flag: { type: String, required: true, enum: ['high quality', 'low quality', 'do not use'] },
    }
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('batchprompt', BatchPrompt);
*/
/*
const mongoose = require('mongoose');

const BatchRequest = new mongoose.Schema({
  id: { type: String, required: true },
  input_file_id: { type: String, required: true },
  status: { type: String, required: true },
  output_file_id: { type: String, required: true },
  error_file_id: { type: String, required: true },
  created_at: { type: Date, required: true },
  completed_at: { type: Date, required: true },
  request_counts_total: { type: Number, required: true },
  request_counts_completed: { type: Number, required: true },
  request_counts_failed: { type: Number, required: true },
});

module.exports = mongoose.model('batchrequest', BatchRequest);
*/

class BatchService {
  constructor(BatchPromptDatabase, BatchRequestDatabase, messageService, conversationService) {
    this.BatchPromptDatabase = BatchPromptDatabase;
    this.BatchRequestDatabase = BatchRequestDatabase;
    this.messageService = messageService;
    this.conversationService = conversationService;
  }

  async getAll() {
    const prompts = await this.BatchPromptDatabase.find();
    const requests = await this.BatchRequestDatabase.find();
    return { prompts, requests };
  }

  async addPromptToBatch(user_id, prompt, conversation_id) {
    // Save a prompt to BatchPrompt
    // If new conversation, also create an empty conversation, to get a conversation id
    const custom_id = `prompt-${new Date().getTime()}-${Math.random().toString(36).substring(2, 15)}`;
    const newPrompt = new this.BatchPromptDatabase({
      custom_id,
      conversation_id,
      request_id: "new",
      user_id,
      prompt,
      images: [],
    });
    await newPrompt.save();
  }

  async triggerBatchRequest() {
    // Take all BatchPrompt entries with request_id === "new"
    // Generate batch data file
    // Upload to OpenAI's API, file id -> BatchPrompt
    // Start a batch work and save to BatchRequest, batch id -> BatchPrompt
    try {
      const processed_ids = [];
  
      // Fetch all new prompts
      const newPrompts = await this.BatchPromptDatabase.find({ request_id: 'new' });
      if (newPrompts.length) {
        // Generate batch data
        const prompt_data = [];
        for (let i = 0; i < newPrompts.length; i++) {
          const data_entry = {
            custom_id: newPrompts[i].custom_id,
            method: 'POST',
            url: '/v1/chat/completions',
            body: {
              model: 'gpt-4o',
              messages: [],
            },
          };
          // Get data from conversation
          const messages =  await this.conversationService.generateMessageArrayForConversation(newPrompts[i].conversation_id);
          // Append prompt
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: newPrompts[i].prompt },
            ]
          });
          data_entry.body.messages = messages;
          // Append data_entry to prompt_data
          prompt_data.push(JSON.stringify(data_entry));
          
          processed_ids.push(newPrompts[i].custom_id);
        }

        // Send to batch API (file + start request)
        const file_id = await upload_file(prompt_data.join('\n'));
        
        // Save request data to request database
        const batch_details = await start_batch(file_id);
        const newRequest = new this.BatchRequestDatabase({
          id: batch_details.id,
          input_file_id: file_id,
          status: batch_details.status,
          output_file_id: "null",
          error_file_id: "null",
          created_at: new Date(batch_details.created_at*1000),
          completed_at: new Date(batch_details.expires_at*1000),
          request_counts_total: batch_details.request_counts.total,
          request_counts_completed: batch_details.request_counts.completed,
          request_counts_failed: batch_details.request_counts.failed,
        });
        await newRequest.save();
        
        // Update prompt entries with request id
        await this.BatchPromptDatabase.updateMany({ request_id: 'new' }, { request_id: batch_details.id });
      }
  
      // Return array id ids that were included in the request
      return processed_ids;
    } catch (error) {
      console.error("Error triggering batch request:", error);
      return [];
    }
  }

  // Checking batch status
  async checkBatchStatus(batchId) {
    const batch = await this.BatchRequestDatabase.findOne({ id: batchId });
    const batch_current_status = await batch_status(batchId);

    batch.status = batch_current_status.status;
    batch.output_file_id = batch_current_status.output_file_id ? batch_current_status.output_file_id : "null";
    batch.error_file_id = batch_current_status.error_file_id ? batch_current_status.error_file_id : "null";
    batch.completed_at = new Date((batch_current_status.completed_at ? batch_current_status.completed_at : batch_current_status.expires_at)*1000);
    batch.request_counts_total = batch_current_status.request_counts.total;
    batch.request_counts_completed = batch_current_status.request_counts.completed;
    batch.request_counts_failed = batch_current_status.request_counts.failed;
    await batch.save();

    return {id: batchId, status: batch.status};
  }

  async processBatchResponse(batchId) {
    // Inquiry OpenAI's API for batch status, status -> BatchRequest
    // If done, also download and process data, response -> BatchPrompt, generate chat messages and append to conversations
  }
}

module.exports = BatchService;
