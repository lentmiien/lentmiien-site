const { upload_file, download_file, delete_file, start_batch, batch_status } = require('../utils/ChatGPT');
const { anthropic_batch_start, anthropic_batch_status, anthropic_batch_results } = require('../utils/anthropic');
const { AIModelCards } = require('../database');

/*
const mongoose = require('mongoose');

const BatchPrompt = new mongoose.Schema({
  title: { type: String, required: true },
  custom_id: { type: String, required: true },
  conversation_id: { type: String, required: true, max: 100 },
  request_id: { type: String, required: true, max: 100 },
  user_id: { type: String, required: true, max: 100 },
  prompt: { type: String, required: true },
  response: { type: String },
  model: {
    type: String,
    default: "gpt-4o"
  },
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
  provider: { type: String, required: true },
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

const valid_models = [];
const model_provider = {};
const redirect_models = {
  "o1": "o1-2024-12-17",
  "o1-preview": "o1-preview-2024-09-12",
  "gpt-4o": "gpt-4o-2024-11-20",
  "o1-mini": "o1-mini-2024-09-12",
  "o3-mini": "o3-mini-2025-01-31",
  "gpt-4o-mini": "gpt-4o-mini-2024-07-18",
};

async function LoadModels() {
  const batch_models = await AIModelCards.find({model_type:"chat", batch_use: true});
  for (let i = 0; i < batch_models.length; i++) {
    valid_models.push(batch_models[i].api_model);
    model_provider[batch_models[i].api_model] = batch_models[i].provider;
  }
}
LoadModels();

class BatchService {
  constructor(BatchPromptDatabase, BatchRequestDatabase, messageService, conversationService) {
    this.BatchPromptDatabase = BatchPromptDatabase;
    this.BatchRequestDatabase = BatchRequestDatabase;
    this.messageService = messageService;
    this.conversationService = conversationService;
  }

  async getAll() {
    const d = new Date(Date.now() - (1000*60*60*24*7));
    const prompts = await this.BatchPromptDatabase.find();
    const requests = (await this.BatchRequestDatabase.find({created_at: { $gt: d}})).reverse();
    return { prompts, requests };
  }

  async getPromptConversationIds() {
    const conversationIds = [];
    const prompts = await this.BatchPromptDatabase.find();
    prompts.forEach(d => {
      if (conversationIds.indexOf(d.conversation_id) === -1 && d.prompt != "@SUMMARY") {
        conversationIds.push(d.conversation_id);
      }
    });
    return conversationIds;
  }

  async addPromptToBatch(user_id, prompt, in_conversation_id, image_paths, parameters, model="gpt-4o") {
    if (valid_models.indexOf(model) === -1) model = redirect_models[model];
    if (valid_models.indexOf(model) === -1) return;

    if (prompt === "@SUMMARY") {
      // Prevent duplicate
      const results = await this.BatchPromptDatabase.find({conversation_id: in_conversation_id, request_id: "new"});
      if (results.length > 0) return;
    }

    let conversation_id = in_conversation_id;
    // Save a prompt to BatchPrompt
    // TODO If new conversation, also create an empty conversation, to get a conversation id
    if ("append_message_ids" in parameters && parameters.append_message_ids.length > 0) {
      // 0. If creating new conversation from existing messages
      conversation_id = await this.conversationService.generateConversationFromMessages(user_id, parameters.append_message_ids.split(","));
    } else if (conversation_id === "new") {
      // 1. If new conversation, create an empty new conversation
      conversation_id = await this.conversationService.createEmptyConversation(user_id);
    } else if ("start_message" in parameters || "end_message" in parameters) {
      // 2. If start/end copy id, create a copy of the conversation
      conversation_id = await this.conversationService.copyConversation(conversation_id, parameters.start_message, parameters.end_message);
    }
    // 3. Update conversation parameters
    if (prompt != "@SUMMARY") {
      await this.conversationService.updateConversation(conversation_id, parameters);
    }

    // Process input images
    const images = [];
    for (let i = 0; i < image_paths.length; i++) {
      const image_data = await this.conversationService.loadProcessNewImageToBase64(image_paths[i]);
      images.push({
        filename: image_data.new_filename,
        use_flag: 'high quality'
      });
    }

    // Save pending prompt to database
    const custom_id = `prompt-${new Date().getTime()}-${Math.random().toString(36).substring(2, 15)}`;
    const newPrompt = new this.BatchPromptDatabase({
      title: parameters.title,
      custom_id,
      conversation_id,
      request_id: "new",
      user_id,
      prompt,
      model,
      images,
    });
    await newPrompt.save();

    return conversation_id;
  }

  async triggerBatchRequest() {
    // Take all BatchPrompt entries with request_id === "new"
    // Generate batch data file
    // Upload to OpenAI's API, file id -> BatchPrompt
    // Start a batch work and save to BatchRequest, batch id -> BatchPrompt
    // Fixed to generate 1 batch request for each model being used
    try {
      const processed_ids = [];
  
      // Fetch all new prompts
      const newPrompts = await this.BatchPromptDatabase.find({ request_id: 'new' });
      if (newPrompts.length) {
        // Generate batch data
        const prompt_data = {};
        for (let c = 0; c < valid_models.length; c++) {
          prompt_data[valid_models[c]] = [];
        }
        const models = valid_models;

        for (let i = 0; i < newPrompts.length; i++) {
          const model_to_use = newPrompts[i].model ? newPrompts[i].model : 'gpt-4o-2024-11-20';
          const data_entry = {
            custom_id: newPrompts[i].custom_id,
            method: 'POST',
            url: '/v1/chat/completions',
            body: {
              model: model_to_use,
              messages: [],
            },
          };
          // Get data from conversation
          const messages =  await this.conversationService.generateMessageArrayForConversation(newPrompts[i].conversation_id, newPrompts[i].prompt === "@SUMMARY", true, model_to_use === "o1-2024-12-17" || model_to_use === "o3-mini-2025-01-31" ? "developer" : "system");
          if (messages === null) {
            // If messages is `null`, then the conversation has been deleted, so delete prompt and continue
            await this.BatchPromptDatabase.deleteOne({custom_id: newPrompts[i].custom_id});
            continue;
          }
          // Append prompt
          if (newPrompts[i].prompt === "@SUMMARY") {
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: "Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to go through the entire conversation." },
              ]
            });
          } else {
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: newPrompts[i].prompt },
              ]
            });
            // Append input images
            const index = messages.length-1;
            for (let j = 0; j < newPrompts[i].images.length; j++) {
              const b64_img = await this.conversationService.loadImageToBase64(newPrompts[i].images[j].filename);
              messages[index].content.push({
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${b64_img}`,
                }
              });
            }
          }

          data_entry.body.messages = messages;
          // Append data_entry to prompt_data
          if (model_provider[model_to_use] === "OpenAI") {
            prompt_data[model_to_use].push(JSON.stringify(data_entry));
          } else {
            // Prepare data for Anthropic
            let system = null;
            const anthropic_data = {
              custom_id: data_entry.custom_id,
              model: model_to_use,
              max_tokens: 8192,
              messages: [],
            };
            data_entry.body.messages.forEach(m => {
              if (m.role === "system") system = m.content.text;
              else anthropic_data.messages.push(m);//TODO: fix vision input format
            });
            if (system) anthropic_data.system = system;
            prompt_data[model_to_use].push(anthropic_data);
          }
          
          processed_ids.push(newPrompts[i].custom_id);
        }

        const requests = [];
        for (let i = 0; i < models.length; i++) {
          if (prompt_data[models[i]].length > 0) {
            let batch_id = "";
            if (model_provider[models[i]] === "OpenAI") {
              // Send to batch API (file + start request)
              const file_id = await upload_file(prompt_data[models[i]].join('\n'));
              
              // Save request data to request database
              const batch_details = await start_batch(file_id);
              batch_id = batch_details.id;
              const newRequest = new this.BatchRequestDatabase({
                id: batch_details.id,
                input_file_id: file_id,
                provider: model_provider[models[i]],
                status: batch_details.status,
                output_file_id: "null",
                error_file_id: "null",
                created_at: new Date(batch_details.created_at*1000),
                completed_at: new Date(batch_details.expires_at*1000),
                request_counts_total: prompt_data[models[i]].length,
                request_counts_completed: 0,
                request_counts_failed: 0,
              });
              await newRequest.save();
              requests.push(newRequest);
            } else {
              // Anthropic batch request
              // Save request data to request database
              const batch_details = await anthropic_batch_start(prompt_data[models[i]]);
              batch_id = batch_details.id;
              const newRequest = new this.BatchRequestDatabase({
                id: batch_details.id,
                input_file_id: "no_file",
                provider: model_provider[models[i]],
                status: batch_details.processing_status,
                output_file_id: "no_file",
                error_file_id: "no_file",
                created_at: new Date(batch_details.created_at),
                completed_at: new Date(batch_details.expires_at),
                request_counts_total: prompt_data[models[i]].length,
                request_counts_completed: 0,
                request_counts_failed: 0,
              });
              await newRequest.save();
              requests.push(newRequest);
            }
            
            // Update prompt entries with request id
            await this.BatchPromptDatabase.updateMany({ request_id: 'new' }, { request_id: batch_id });
          }
        }

        // Return ids and new request data
        return {ids: processed_ids, requests};
      } else {
        return {ids: [], requests: [{}]};
      }
    } catch (error) {
      console.error("Error triggering batch request:", error);
      return {ids: [], requests: [{}]};
    }
  }

  // Checking batch status
  async checkBatchStatus(batchId) {
    const batch = await this.BatchRequestDatabase.findOne({ id: batchId });

    if (batch.provider === "OpenAI") {
      const batch_current_status = await batch_status(batchId);
      
      batch.status = batch_current_status.status;
      batch.output_file_id = batch_current_status.output_file_id ? batch_current_status.output_file_id : "null";
      batch.error_file_id = batch_current_status.error_file_id ? batch_current_status.error_file_id : "null";
      batch.completed_at = new Date((batch_current_status.completed_at ? batch_current_status.completed_at : batch_current_status.expires_at)*1000);
      batch.request_counts_total = batch_current_status.request_counts.total;
      batch.request_counts_completed = batch_current_status.request_counts.completed;
      batch.request_counts_failed = batch_current_status.request_counts.failed;
      await batch.save();
    } else {
      // Anthropic batch status
      const batch_current_status = await anthropic_batch_status(batchId);
      batch.status = batch_current_status.processing_status === "ended" ? "completed" : batch_current_status.processing_status;
      batch.completed_at = new Date((batch_current_status.ended_at ? batch_current_status.ended_at : batch_current_status.expires_at));
      batch.request_counts_completed = batch_current_status.request_counts.succeeded;
      batch.request_counts_failed = batch_current_status.request_counts.errored + batch_current_status.request_counts.canceled + batch_current_status.request_counts.expired;
      await batch.save();
    }

    return {id: batchId, status: batch.status};
  }

  async processBatchResponses() {
    // Check all batch requestes for requests with status "completed"
    // Download output file
    // Append to conversation database
    // Delete processed requests from prompt database
    // Update status of request to "DONE" and delete input/output files from API
    const completed_requests = [];
    const completed_prompts = [];
    const completedRequests = await this.BatchRequestDatabase.find({ status: 'completed' });
    for (let i = 0; i < completedRequests.length; i++) {
      if (completedRequests[i].provider === "OpenAI") {
        const output_data = await download_file(completedRequests[i].output_file_id);
        for (let j = 0; j < output_data.length; j++) {
          const prompt_data = await this.BatchPromptDatabase.findOne({custom_id: output_data[j].custom_id});
          if (prompt_data) {
            if (prompt_data.prompt === "@SUMMARY") {
              // Update summary
              await this.conversationService.updateSummary(prompt_data.conversation_id, output_data[j].response.body.choices[0].message.content);
              // Delete completed prompt
              await this.BatchPromptDatabase.deleteOne({custom_id: output_data[j].custom_id});
            } else {
              // Check that conversation still exist
              if (await this.conversationService.getConversationsById(prompt_data.conversation_id)) {
                // Append to conversation
                const {category, tags} = await this.conversationService.getCategoryTagsForConversationsById(prompt_data.conversation_id);
                const msg_id = (await this.messageService.CreateCustomMessage(prompt_data.prompt, output_data[j].response.body.choices[0].message.content, prompt_data.user_id, category, prompt_data.images, tags)).db_entry._id.toString();
                await this.conversationService.appendMessageToConversation(prompt_data.conversation_id, msg_id, false);
                // Flag for generating summary
                await this.addPromptToBatch(prompt_data.user_id, "@SUMMARY", prompt_data.conversation_id, [], {title: prompt_data.title ? prompt_data.title : "(no title)"}, "gpt-4o-mini");
              }
              // Delete completed prompt
              await this.BatchPromptDatabase.deleteOne({custom_id: output_data[j].custom_id});
            }
            completed_prompts.push(output_data[j].custom_id);
          }
        }
        // Update status and delete files
        completedRequests[i].status = "DONE";
        await completedRequests[i].save();
        await delete_file(completedRequests[i].input_file_id);
        await delete_file(completedRequests[i].output_file_id);
        completed_requests.push(completedRequests[i].id);
      } else {
        // Anthropic results
        const output_data = await anthropic_batch_results(completedRequests[i].id);
        for (let j = 0; j < output_data.length; j++) {
          const prompt_data = await this.BatchPromptDatabase.findOne({custom_id: output_data[j].custom_id});
          if (prompt_data) {
            if (prompt_data.prompt === "@SUMMARY") {
              // Update summary
              await this.conversationService.updateSummary(prompt_data.conversation_id, output_data[j].content.text);
              // Delete completed prompt
              await this.BatchPromptDatabase.deleteOne({custom_id: output_data[j].custom_id});
            } else {
              // Check that conversation still exist
              if (await this.conversationService.getConversationsById(prompt_data.conversation_id)) {
                // Append to conversation
                const {category, tags} = await this.conversationService.getCategoryTagsForConversationsById(prompt_data.conversation_id);
                const msg_id = (await this.messageService.CreateCustomMessage(prompt_data.prompt, output_data[j].content.text, prompt_data.user_id, category, prompt_data.images, tags)).db_entry._id.toString();
                await this.conversationService.appendMessageToConversation(prompt_data.conversation_id, msg_id, false);
                // Flag for generating summary
                await this.addPromptToBatch(prompt_data.user_id, "@SUMMARY", prompt_data.conversation_id, [], {title: prompt_data.title ? prompt_data.title : "(no title)"}, "gpt-4o-mini");
              }
              // Delete completed prompt
              await this.BatchPromptDatabase.deleteOne({custom_id: output_data[j].custom_id});
            }
            completed_prompts.push(output_data[j].custom_id);
          }
        }
        // Update status and delete files
        completedRequests[i].status = "DONE";
        await completedRequests[i].save();
        completed_requests.push(completedRequests[i].id);
      }
    }
    return {requests: completed_requests, prompts: completed_prompts};
  }
}

module.exports = BatchService;
