const fs = require('fs');
const path = require('path');
const marked = require('marked');
const { chatGPT, embedding, OpenAIAPICallLog, GetModels, tts, ig } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { Chat3Model, Chat3TemplateModel, Chat3KnowledgeTModel, Chat3KnowledgeModel, FileMetaModel } = require('../database');

exports.index = async (req, res) => {
  let this_conversation_id = "id" in req.query ? parseInt(req.query.id) : -1;
  let new_conversation_id = 0;

  // Load current database
  const chat_data = await Chat3Model.find();
  const chat_templates = await Chat3TemplateModel.find();

  // if chat parameter in query, update this_conversation_id to match id for chat message
  if ("chat" in req.query) {
    chat_data.forEach(d => {
      if (d._id.toString() === req.query.chat) {
        this_conversation_id = d.ConversationID;
      }
    });
  }

  // Sort temlpates
  chat_templates.sort((a,b) => {
    if (a.Type < b.Type) return -1;
    if (a.Type > b.Type) return 1;
    if (a.Category < b.Category) return -1;
    if (a.Category > b.Category) return 1;
    if (a.Title < b.Title) return -1;
    if (a.Title > b.Title) return 1;
    return 0;
  });

  // Prepare this_conversation
  const this_conversation = [];
  const tc_db_data = chat_data.filter(d => d.ConversationID === this_conversation_id);
  for (let i = 0; i < tc_db_data.length; i++) {
    this_conversation.push({
      "_id": tc_db_data[i]._id.toString(),
      "ConversationID": tc_db_data[i].ConversationID,
      "StartMessageID": tc_db_data[i].StartMessageID,
      "PreviousMessageID": tc_db_data[i].PreviousMessageID,
      "ContentText": tc_db_data[i].ContentText,
      "HTMLText": marked.parse(tc_db_data[i].ContentText),
      "ContentTokenCount": tc_db_data[i].ContentTokenCount,
      "SystemPromptText": tc_db_data[i].SystemPromptText,
      "UserOrAssistantFlag": tc_db_data[i].UserOrAssistantFlag,
      "UserID": tc_db_data[i].UserID,
      "Title": tc_db_data[i].Title,
      "Images": tc_db_data[i].Images,
      "Sounds": tc_db_data[i].Sounds,
      "Timestamp": tc_db_data[i].Timestamp,
    });
  }

  // Detect all conversations
  const chats = [];
  const unique_ids = [];
  chat_data.forEach(d => {
    const index = unique_ids.indexOf(d.ConversationID);
    if (index === -1) {
      unique_ids.push(d.ConversationID);
      chats.push({
        ConversationID: d.ConversationID,
        Title: d.Title,
        last_message: d.ContentText,
        last_timestamp: d.Timestamp,
      });
    } else {
      if (d.Timestamp > chats[index].last_timestamp) {
        chats[index].last_timestamp = d.Timestamp;
        chats[index].last_message = d.ContentText;
      }
    }

    // Set new_conversation_id
    if (new_conversation_id <= d.ConversationID) {
      new_conversation_id = d.ConversationID + 1;
    }
  })

  // Load model data
  const models = await GetModels("chat")

  res.render("chat3", {chatmode: true, this_conversation, chats, new_conversation_id, models, chat_templates});
};

exports.post = async (req, res) => {
  const id = parseInt(req.body.id);
  const model = req.body.api_model;

  const userPrompt = "savePrompt" in req.body ? req.body.savePrompt : req.body.messages[req.body.messages.length-1].content;
  const contextPrompt = "saveContext" in req.body ? req.body.saveContext : req.body.messages[0].content;

  // ConversationID: { type: Number, required: true },
  const ConversationID = id
  // StartMessageID: { type: String, required: true, max: 100 },
  const StartMessageID = req.body.root; // If "root", then needs to be replaced with _id of first entry in new conversation
  // PreviousMessageID: { type: String, required: true, max: 100 },
  const PreviousMessageID = req.body.head_id; // Response from OpenAI API need to use _id of user query
  // ContentText: { type: String, required: true },
  const ContentText = userPrompt;
  // ContentTokenCount: { type: Number, required: true },
  // --Get from OpenAI response
  // SystemPromptText: { type: String, required: true },
  const SystemPromptText = contextPrompt;
  // UserOrAssistantFlag: { type: Boolean, required: true },
  // --Set to true for input and false for API response
  // UserID: { type: String, required: true, max: 100 },
  const UserID = "Lennart";
  // Title: { type: String, required: true, max: 255 },
  const Title = req.body.title;
  // Images: { type: String, required: false, max: 255 },
  const Images = "";
  // Sounds: { type: String, required: false, max: 255 },
  const Sounds = "";
  // Timestamp: { type: Date, required: true },
  const Timestamp = new Date(); // Generate new timestamp for response after getting the response

  // Send to OpenAI API
  const response = await chatGPT(req.body.messages, model)
  // When get response
  if (response) {
    // Save to API call log
    await OpenAIAPICallLog(req.user.name, model, response.usage.prompt_tokens, response.usage.completion_tokens, "[INPUT]", "[OUTPUT]");
    // Save prompt and response messages to database
    //   (also update StartMessageID and PreviousMessageID appropriately)
    try {
      const user_entry = {
        ConversationID,
        StartMessageID,
        PreviousMessageID,
        ContentText,
        ContentTokenCount: response.usage.prompt_tokens,
        SystemPromptText,
        UserOrAssistantFlag: true,
        UserID,
        Title,
        Images,
        Sounds,
        Timestamp,
      };
      const entry1 = await new Chat3Model(user_entry).save();
      const assistant_entry = {
        ConversationID,
        StartMessageID: StartMessageID === "root" ? entry1._id.toString() : StartMessageID,
        PreviousMessageID: entry1._id.toString(),
        ContentText: response.choices[0].message.content,
        ContentTokenCount: response.usage.completion_tokens,
        SystemPromptText,
        UserOrAssistantFlag: false,
        UserID,
        Title,
        Images,
        Sounds,
        Timestamp: new Date(),
      };
      const entry2 = await new Chat3Model(assistant_entry).save();

      if (StartMessageID === "root") {
        const update1 = await Chat3Model.findByIdAndUpdate(
          entry1._id,
          { StartMessageID: entry1._id.toString() },
          { new: true });
      }

      res.json({status: "OK", msg: "Saved!"});
    } catch (err) {
      console.error("Error saving data to database (Chat3): ", err);
      res.json({status: "ERROR", msg: "Error saving data to database (Chat3)."});
    }

    // Generate embedding for response, and save to embedding database
    // Return _id of response entry in database to user (user side will reload page with the id)
  } else {
    console.log('Failed to get a response from ChatGPT.');
    res.json({status: "ERROR", msg: "Failed to get a response from ChatGPT."});
  }
};

exports.import = async (req, res) => {
  // A chat conversation on req.body, from older chat and ChatGPT archive

  // ConversationID -> Generate at beginning, next available ID
  let ConversationID = 0;
  const chat_data = await Chat3Model.find();
  chat_data.forEach(d => {
    // Set new_conversation_id
    if (ConversationID <= d.ConversationID) {
      ConversationID = d.ConversationID + 1;
    }
  });

  // StartMessageID / PreviousMessageID / Timestamp
  let StartMessageID = "root";
  let PreviousMessageID = "root";
  let Timestamp;

  // Loop through input messages and add one by one
  for (let i = 0; i < req.body.messages.length; i++) {
    Timestamp = new Date();
    const entry = {
      ConversationID,
      StartMessageID,
      PreviousMessageID,
      ContentText: req.body.messages[i].ContentText,
      ContentTokenCount: req.body.messages[i].ContentTokenCount,
      SystemPromptText: req.body.messages[i].SystemPromptText,
      UserOrAssistantFlag: req.body.messages[i].UserOrAssistantFlag,
      UserID: req.body.messages[i].UserID,
      Title: req.body.messages[i].Title,
      Images: req.body.messages[i].Images,
      Sounds: req.body.messages[i].Sounds,
      Timestamp,
    };
    const db_entry = await new Chat3Model(entry).save();
    PreviousMessageID = db_entry._id.toString();
    if (StartMessageID === "root") {
      StartMessageID = db_entry._id.toString();
      await Chat3Model.findByIdAndUpdate(
        db_entry._id,
        { StartMessageID: db_entry._id.toString() },
        { new: true });
    }
  }
  
  /*
  ConversationID -> Generate at beginning, next available ID
  StartMessageID -> Generate while adding one by one
  PreviousMessageID -> Generate while adding one by one
  ContentText -> Should be in input
  ContentTokenCount -> Should be in input
  SystemPromptText -> Should be in input
  UserOrAssistantFlag -> Should be in input
  UserID -> Should be in input
  Title -> Should be in input
  Images -> Should be in input
  Sounds -> Should be in input
  Timestamp -> Generate while adding one by one
  */

  res.redirect(`/chat3?id=${ConversationID}`);
};

/*
  FileMetaModel

  filename: { type: String, required: true, max: 100 },
  filetype: { type: String, required: true, max: 16 },
  path: { type: String, required: true },
  is_url: { type: Boolean, required: true },
  prompt: { type: String, required: true },
  created_date: { type: Date, required: true },
  other_meta_data: { type: String, required: true },
*/

// POST /chat3/img
// Required input: Chat3 entry id, prompt, quality, size
exports.generate_image = async (req, res) => {
  try {
    const _id = req.body.id;
    // Take input and generate OpenAI API request
    // Send API request and wait for response
    // Save file to folder './public/img/{filename}'
    const { filename, prompt } = await ig(req.body.prompt, req.body.quality, req.body.size);
    // Save entry in FileMetaModel database
    const entry = {
      filename: filename,
      filetype: "image",
      path: `/img/${filename}`,
      is_url: false,
      prompt: prompt,
      created_date: new Date(),
      other_meta_data: JSON.stringify({ quality: req.body.quality, size: req.body.size, source: "OpenAI: DALL·E 3" }),
    };
    await new FileMetaModel(entry).save();
    // Update Chat3 entry with file data
    await Chat3Model.findByIdAndUpdate(
      _id,
      { Images: `/img/${filename}` },
      { new: true });
    // Refresh page
    res.json({status: "OK", msg: "Saved!"});
  } catch (err) {
    console.log('Failed to generate image: ', err);
    res.json({status: "ERROR", msg: "Failed to generate image."});
  }
}

// POST /chat3/mp3
// Required input: Chat3 entry id, prompt, model, voice
exports.generate_tts = async (req, res) => {
  try {
    const _id = req.body.id;
    // Take input and generate OpenAI API request
    // Send API request and wait for response
    // Save file to folder './public/mp3/{filename}'
    const { filename, prompt } = await tts(req.body.model, req.body.prompt, req.body.voice);
    // Save entry in FileMetaModel database
    const entry = {
      filename: filename,
      filetype: "sound",
      path: `/mp3/${filename}`,
      is_url: false,
      prompt: prompt,
      created_date: new Date(),
      other_meta_data: JSON.stringify({ model: req.body.model, voice: req.body.voice, source: "OpenAI: Text-To-Speech" }),
    };
    await new FileMetaModel(entry).save();
    // Update Chat3 entry with file data
    await Chat3Model.findByIdAndUpdate(
      _id,
      { Sounds: `/mp3/${filename}` },
      { new: true });
    // Refresh page
    res.json({status: "OK", msg: "Saved!"});
  } catch (err) {
    console.log('Failed to generate sound: ', err);
    res.json({status: "ERROR", msg: "Failed to generate sound."});
  }
}

exports.manage_templates = async (req, res) => {
  const chat_templates = await Chat3TemplateModel.find();
  chat_templates.sort((a,b) => {
    if (a.Type < b.Type) return -1;
    if (a.Type > b.Type) return 1;
    if (a.Category < b.Category) return -1;
    if (a.Category > b.Category) return 1;
    if (a.Title < b.Title) return -1;
    if (a.Title > b.Title) return 1;
    return 0;
  });
  res.render("manage_templates", { chat_templates });
};

/*
  Title: { type: String, required: true, max: 100 },
  Type: { type: String, required: true, max: 100 },
  Category: { type: String, required: true, max: 100 },
  TemplateText: { type: String, required: true },
*/
exports.manage_templates_post = async (req, res) => {
  // Input body
  // title
  // type
  // category
  // text
  const entry = {
    Title: req.body.title,
    Type: req.body.type,
    Category: req.body.category,
    TemplateText: req.body.text,
  };
  await new Chat3TemplateModel(entry).save();
  res.redirect('/chat3/manage_templates');
};

exports.manage_templates_delete = async (req, res) => {
  const id_to_delete = req.body.id;
  await Chat3TemplateModel.deleteOne({_id: id_to_delete});
  res.redirect('/chat3/manage_templates');
};

// Local VectorDB
const VDB = require("../cache/chat3vdb.json");
/*
const Chat3_knowledge_t = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  version: { type: Number, required: true },
  createdDate: { type: Date, required: true },
  description: { type: String, required: true },
  dataFormat: { type: String, required: true },
});
*/
/*
const Chat3_knowledge = new mongoose.Schema({
  templateId: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 100 },
  createdDate: { type: Date, required: true },
  originId: { type: String, required: true, max: 100 },
  data: { type: String, required: true },
  category: { type: String, required: true, max: 100 },
  author: { type: String, required: true, max: 100 },
});
*/

exports.manage_knowledge = async (req, res) => {
  // To display and manage knowledge templates
  // Also to review and manage existing knowledge entries
  // Display manage_knowledge.pug

  // Load data
  const knowledge_templates = await Chat3KnowledgeTModel.find();
  const knowledges = await Chat3KnowledgeModel.find();

  // Split templates as current and backward compability
  const current_templates = [];
  const backward_templates = [];
  const unique_titles = [];
  // 1. sort with highest version at top
  knowledge_templates.sort((a,b) => b.version - a.version);
  // 2. assign to current or backward (first template with unique title goes to current, otherwise to backward)
  for (let i = 0; i < knowledge_templates.length; i++) {
    if (unique_titles.indexOf(knowledge_templates[i].title) >= 0) {
      backward_templates.push(knowledge_templates[i]);
    } else {
      unique_titles.push(knowledge_templates[i].title);
      current_templates.push(knowledge_templates[i]);
    }
  }

  // Display output
  res.render('manage_knowledge', { current_templates, backward_templates, knowledges, unique_titles });
};

/*
input#title.form-control(type="text", name="title", onchange="UpdateVersion(this)")
input#version.form-control(type="text", name="version", readonly)
textarea#description.form-control(name="description", cols="30", rows="10")
textarea#dataFormat.form-control(name="dataFormat", cols="30", rows="10", title="data_label:data_type(Number/Text):required(true/false):for_embedding(true/false)")
*/
/*
const Chat3_knowledge_t = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  version: { type: Number, required: true },
  createdDate: { type: Date, required: true },
  description: { type: String, required: true },
  dataFormat: { type: String, required: true },
});
*/
exports.manage_knowledge_add_template = async (req, res) => {
  // POST: input for saving a new knowledge template
  // Forward to manage_knowledge when done
  
  // Parse dataFormat
  let linedel = (req.body.dataFormat.indexOf('\r\n') > 0) ? '\r\n' : '\n';
  let lines = req.body.dataFormat.split(linedel);
  let json_object = [];
  lines.forEach(l => {
    const cell = l.split(":");
    json_object.push({
      data_label: cell[0],
      data_type: cell[1],
      required: cell[2] === 'true',
      for_embedding: cell[3] === 'true',
    });
  });

  // Generate and save entry
  const entry = {
    title: req.body.title,
    version: parseInt(req.body.version),
    createdDate: new Date(),
    description: req.body.description,
    dataFormat: JSON.stringify(json_object),
  };
  await new Chat3KnowledgeTModel(entry).save();

  // Redirect
  res.redirect('/chat3/manage_knowledge');
};

exports.manage_knowledge_delete_template = async (req, res) => {
  // POST: input id for knowledge template to delete
  // When done return status OK

  const id_to_delete = req.body.id;
  await Chat3KnowledgeTModel.deleteOne({_id: id_to_delete});
  res.json({status: "OK"});
};

exports.manage_knowledge_add = async (req, res) => {
  // GET: conversation id and msg_id in query, load conversation and display form for generating new knowledge entry
  // Display manage_knowledge_add.pug

  // Load data from database
  const knowledge_templates = await Chat3KnowledgeTModel.find();
  const msgs = await Chat3Model.find({ConversationID: req.query.id});

  // Only get the current templates
  const current_templates = [];
  const unique_titles = [];
  // 1. sort with highest version at top
  knowledge_templates.sort((a,b) => b.version - a.version);
  // 2. assign to current or backward (first template with unique title goes to current, otherwise to backward)
  for (let i = 0; i < knowledge_templates.length; i++) {
    if (unique_titles.indexOf(knowledge_templates[i].title) === -1) {
      unique_titles.push(knowledge_templates[i].title);
      current_templates.push(knowledge_templates[i]);
    }
  }

  // Display output
  res.render('manage_knowledge_add', {msgs, msg_id: req.query.msg_id, current_templates, unique_titles});
};

/*
const Chat3_knowledge = new mongoose.Schema({
  templateId: { type: String, required: true, max: 100 },
  title: { type: String, required: true, max: 100 },
  createdDate: { type: Date, required: true },
  originId: { type: String, required: true, max: 100 },
  data: { type: String, required: true },
  category: { type: String, required: true, max: 100 },
  author: { type: String, required: true, max: 100 },
});
*/
exports.manage_knowledge_add_post = async (req, res) => {
  // POST: Add new knowledge entry to database
  // Also add vector embedding to local file with vector embeddings, and append to "VDB"
  // Forward to manage_knowledge when done

  // Grab the template data
  const knowledge_templates = await Chat3KnowledgeTModel.find({_id: req.body.templateId});
  const data_format = JSON.parse(knowledge_templates[0].dataFormat);

  // Generate and save entry
  const entry = {
    templateId: req.body.templateId,
    title: req.body.title,
    createdDate: new Date(),
    originId: req.body.originId,
    data: "",
    category: req.body.category,
    author: "Lennart",
  };
  const entry_data = {};
  let vector_string = "";
  data_format.forEach(d => {
    const label = d.data_label;
    const value = req.body[label];
    entry_data[label] = value;

    if (d.for_embedding) {
      vector_string = (vector_string.length > 0 ? vector_string + '\r\n\r\n' + value : value);
    }
  });
  entry.data = JSON.stringify(entry_data);
  const db_entry = await new Chat3KnowledgeModel(entry).save();

  // Generate vector embedding
  const response = await embedding(vector_string, "text-embedding-ada-002");
  await OpenAIAPICallLog(req.user.name, "text-embedding-ada-002", response.usage.total_tokens, 0, vector_string, JSON.stringify(response.data[0].embedding));
  VDB.push({
    db_id: db_entry._id.toString(),
    vector: response.data[0].embedding,
  });
  // Convert the object to a JSON string
  const jsonString = JSON.stringify(VDB);
  // Construct the output path relative to this script's location
  const outputPath = path.join(__dirname, '../cache/chat3vdb.json');
  // Save the JSON string to a file
  fs.writeFile(outputPath, jsonString, (err) => {
    if (err) {
        console.error('Error writing file:', err);
    } else {
        console.log('File saved successfully!');
    }
  });

  res.redirect("/chat3/manage_knowledge");
};

exports.manage_knowledge_fetch = (req, res) => {
  // POST: input prompt, convert to vector embedding, then check locally stored vector embeddings, and return the 20 most similar texts to the user
  // Works as API endpoint and return JSON data
};

exports.browse_knowledge = async (req, res) => {
  // GET: query {id}

  // Templates
  const knowledge_templates = await Chat3KnowledgeTModel.find();
  let title = null;
  knowledge_templates.forEach(t => {
    if (t._id.toString() === req.query.id) {
      title = t.title;
    }
  });
  const ids = [];
  const templates = knowledge_templates.filter(t => t.title === title);
  templates.forEach(t => ids.push(t._id.toString()));

  // Knowledge
  const knowledges = await Chat3KnowledgeModel.find();
  const knows = knowledges.filter(k => ids.indexOf(k.templateId) >= 0);

  res.render("browse_knowledge", {ids, templates, knows})
};
