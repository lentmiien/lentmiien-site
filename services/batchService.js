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

  async quePrompt() {
    // Save a prompt to BatchPrompt
    // If new conversation, also create an empty conversation, to get a conversation id
  }

  async startBatch() {
    // Take all BatchPrompt entries with request_id === "new"
    // Generate batch data file
    // Upload to OpenAI's API, file id -> BatchPrompt
    // Start a batch work and save to BatchRequest, batch id -> BatchPrompt
  }

  async CheckBatch() {
    // Inquiry OpenAI's API for batch status, status -> BatchRequest
    // If done, also download and process data, response -> BatchPrompt, generate chat messages and append to conversations
  }
}

module.exports = BatchService;
