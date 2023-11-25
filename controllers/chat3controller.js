const marked = require('marked');
const { chatGPT, OpenAIAPICallLog, GetModels, tts, ig } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { Chat3Model, Chat3TemplateModel, FileMetaModel } = require('../database');

exports.index = async (req, res) => {
  const this_conversation_id = "id" in req.query ? parseInt(req.query.id) : -1;
  let new_conversation_id = 0;

  // Load current database
  const chat_data = await Chat3Model.find();
  const chat_templates = await Chat3TemplateModel.find();

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
    await OpenAIAPICallLog(req.user.name, model, response.usage.prompt_tokens, response.usage.completion_tokens, JSON.stringify(req.body.messages), response.choices[0].message.content);
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
