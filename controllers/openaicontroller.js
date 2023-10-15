const fs = require('fs');
const marked = require('marked');

// Import dependencis
const { OpenaichatModel } = require('../database');
const { GetModels, AddModel, DeleteModel, GetOpenAIAPICallHistory } = require('../utils/ChatGPT');

exports.index = async (req, res) => {
  // Show JSON upload form (file exported from OpenAI)
  // View content from `OpenaichatModel`, with keyword filtering through JS
  // Each entry should have a link to open the chat in `/chat2` to continue on the chat
  //   (won't modify the OpenAI database, but create a copy in `/chat2` that is modified)

  const data = await OpenaichatModel.find();

  // preprocess data, to group chats from same conversation
  // and sort on created/updated dates
  const pdata = [];
  const id_lookup = [];

  data.forEach(d => {
    const index = id_lookup.indexOf(d.thread_id);
    if (index >= 0) {
      pdata[index].messages.push({
        role: d.role,
        model: d.model,
        content: marked.parse(d.content),
        created: d.created,
      });
      if (d.created > pdata[index].last_updated) {
        pdata[index].last_updated = d.created;
      }
    } else {
      id_lookup.push(d.thread_id);
      pdata.push({
        title: d.title,
        messages: [
          {
            role: d.role,
            model: d.model,
            content: marked.parse(d.content),
            created: d.created,
          }
        ],
        id: d.thread_id,
        last_updated: d.created,
      });
    }
  });

  // Sort messages in each conversation
  for (let i = 0; i < pdata.length; i++) {
    pdata[i].messages.sort((a,b) => {
      if (a.created < b.created) return -1;
      if (a.created > b.created) return 1;
      return 0;
    });
  }

  // Sort conversations
  pdata.sort((a,b) => {
    if (a.last_updated > b.last_updated) return -1;
    if (a.last_updated < b.last_updated) return 1;
    return 0;
  });

  res.render('openai_index', { pdata });
};

exports.upload_json = (req, res) => {
  // Upload a JSON file with conversations from OpenAI
  // Add to `OpenaichatModel` database

  const file_data = fs.readFileSync(req.file.destination + req.file.filename, { encoding: 'utf8', flag: 'r' });
  const json_data = JSON.parse(file_data);
  const messages_to_save = [];

  json_data.forEach(conversation => {
    const title = conversation.title;
    const thread_id = conversation.id;
    const msg_keys = Object.keys(conversation.mapping);
    let start_index = -1;
    for (let i = 0; i < msg_keys.length && start_index == -1; i++) {
      if (conversation.mapping[msg_keys[i]].parent == null) {
        start_index = i;
      }
    }
    if (start_index >= 0 && conversation.mapping[msg_keys[start_index]].children.length > 0) {
      let id = msg_keys[start_index];
      while (conversation.mapping[id].children.length > 0) {
        id = conversation.mapping[id].children[0];
        // System message
        if (
          conversation.mapping[id].message &&
          conversation.mapping[id].message.author.role == "system" &&
          conversation.mapping[id].message.content.content_type == "text" &&
          conversation.mapping[id].message.content.parts[0].length > 0
        ) {
          messages_to_save.push({
            title,
            role: "system",
            model: "model_slug" in conversation.mapping[id].message.metadata ? conversation.mapping[id].message.metadata.model_slug : "---",
            content: conversation.mapping[id].message.content.parts[0],
            created: new Date(conversation.mapping[id].message.create_time * 1000),
            thread_id,
          });
        }
        // User message
        if (
          conversation.mapping[id].message &&
          conversation.mapping[id].message.author.role == "user" &&
          conversation.mapping[id].message.content.content_type == "text" &&
          conversation.mapping[id].message.content.parts[0].length > 0
        ) {
          messages_to_save.push({
            title,
            role: "user",
            model: "model_slug" in conversation.mapping[id].message.metadata ? conversation.mapping[id].message.metadata.model_slug : "---",
            content: conversation.mapping[id].message.content.parts[0],
            created: new Date(conversation.mapping[id].message.create_time * 1000),
            thread_id,
          });
        }
        // Assistant message
        if (
          conversation.mapping[id].message &&
          conversation.mapping[id].message.author.role == "assistant" &&
          conversation.mapping[id].message.content.content_type == "text" &&
          conversation.mapping[id].message.content.parts[0].length > 0
        ) {
          messages_to_save.push({
            title,
            role: "assistant",
            model: "model_slug" in conversation.mapping[id].message.metadata ? conversation.mapping[id].message.metadata.model_slug : "---",
            content: conversation.mapping[id].message.content.parts[0],
            created: new Date(conversation.mapping[id].message.create_time * 1000),
            thread_id,
          });
        }
        // Assistant code
        if (
          conversation.mapping[id].message &&
          conversation.mapping[id].message.author.role == "assistant" &&
          conversation.mapping[id].message.content.content_type == "code" &&
          conversation.mapping[id].message.content.text.length > 0
        ) {
          messages_to_save.push({
            title,
            role: "assistant",
            model: "model_slug" in conversation.mapping[id].message.metadata ? conversation.mapping[id].message.metadata.model_slug : "---",
            content: '```python\n' + conversation.mapping[id].message.content.text + '\n```',
            created: new Date(conversation.mapping[id].message.create_time * 1000),
            thread_id,
          });
        }
        // Tool output
        if (
          conversation.mapping[id].message &&
          conversation.mapping[id].message.author.role == "tool" &&
          conversation.mapping[id].message.content.content_type == "execution_output" &&
          conversation.mapping[id].message.content.text.length > 0
        ) {
          messages_to_save.push({
            title,
            role: "assistant",
            model: "model_slug" in conversation.mapping[id].message.metadata ? conversation.mapping[id].message.metadata.model_slug : "---",
            content: '```python\n' + conversation.mapping[id].message.content.text + '\n```',
            created: new Date(conversation.mapping[id].message.create_time * 1000),
            thread_id,
          });
        }
      }
    }
  });

  /*
  title: { type: String },
  role: { type: String },
  model: { type: String },
  content: { type: String },
  created: { type: Date },
  thread_id: { type: String },
  */
  OpenaichatModel.collection.insertMany(messages_to_save);

  setTimeout(() => res.redirect('/openai'), 250);
};

exports.manage_methods = async (req, res) => {
  const models = await GetModels();
  res.render('openaimodels', { models });
}

exports.manage_methods_add = async (req, res) => {
  await AddModel(req.body.model_name, req.body.api_endpoint, parseFloat(req.body.input_1k_token_cost), parseFloat(req.body.output_1k_token_cost), req.body.model_type, parseInt(req.body.max_tokens));
  setTimeout(() => res.redirect('/openai/manage'), 150);
}

exports.manage_methods_delete = async (req, res) => {
  await DeleteModel(req.body.id_to_delete);
  setTimeout(() => res.redirect('/openai/manage'), 150);
}

exports.get_call_history = async (req, res) => {
  const myHistory = GetOpenAIAPICallHistory(req.user.name);
  res.render('api_call_history', { myHistory });
};
