const marked = require('marked');
const { chatGPT, OpenAIAPICallLog, GetModels } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { Chat3Model } = require('../database');

exports.index = async (req, res) => {
  const this_conversation_id = "id" in req.query ? parseInt(req.query.id) : -1;
  let new_conversation_id = 0;

  // Load current database
  const chat_data = await Chat3Model.find();

  // Prepare this_conversation
  const this_conversation = chat_data.filter(d => d.ConversationID === this_conversation_id);
  for (let i = 0; i < this_conversation.length; i++) {
    this_conversation[i].HTMLText = marked.parse(this_conversation[i].ContentText);
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

  res.render("chat3", {chatmode: true, this_conversation, chats, new_conversation_id, models});
};

exports.post = async (req, res) => {
  const id = parseInt(req.body.id);
  const model = req.body.api_model;

  console.log(req.body);

  // ConversationID: { type: Number, required: true },
  const ConversationID = id
  // StartMessageID: { type: String, required: true, max: 100 },
  const StartMessageID = req.body.root; // If "root", then needs to be replaced with _id of first entry in new conversation
  // PreviousMessageID: { type: String, required: true, max: 100 },
  const PreviousMessageID = req.body.head_id; // Response from OpenAI API need to use _id of user query
  // ContentText: { type: String, required: true },
  const ContentText = req.body.messages[req.body.messages.length-1].content;
  // ContentTokenCount: { type: Number, required: true },
  // --Get from OpenAI response
  // SystemPromptText: { type: String, required: true },
  const SystemPromptText = req.body.messages[0].content;
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

  // TODO: make function
  // Send to OpenAI API
  // const response = await chatGPT(messages, model)
  // When get response
  //   Save to API call log
  //   Save prompt and response messages to database
  //     (also update StartMessageID and PreviousMessageID appropriately)
  //   Generate embedding for response, and save to embedding database
  //   Return _id of response entry in database to user (user side will reload page with the id)

  res.json({status: "OK"});
};
