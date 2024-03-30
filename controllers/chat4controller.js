const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const marked = require('marked');
const { chatGPT, embedding, OpenAIAPICallLog, GetModels, tts, ig } = require('../utils/ChatGPT');
// const utils = require('../utils/utils');

// const default_models = require("../cache/default_models.json");

// Require necessary database models
const { Chat4Model, Conversation4Model } = require('../database');
const conversation4 = require('../models/conversation4');

exports.index = async (req, res) => {
  const conversations = await conversation4.find({ user_id: req.user.name });
  res.render("chat4", { conversations });
};

exports.chat = async (req, res) => {
  // Load chat conversation, req.params.id <- conversation id
  const conversation = await Conversation4Model.findById(req.params.id);
  // Load chat messages, conversation.messages <- array of chat messages ids
  const m_id = conversation.messages;
  const messages = await Chat4Model.find({ _id: m_id });
  messages.sort((a,b) => {
    const a_i = m_id.indexOf(a._id.toString());
    const b_i = m_id.indexOf(b._id.toString());
    if (a_i > b_i) return -1;
    if (a_i < b_i) return 1;
    return 0;
  });
  for (let i = 0; i < messages.length; i++) {
    messages[i].prompt_html = marked.parse(messages[i].prompt);
    messages[i].response_html = marked.parse(messages[i].response);
  }
/* Page design

Image upload    | Context button
Prompt textares | Template button
                | Send buttons (send, generate img, generate mp3 -> if a previous message has been selected, then for send: copy conversation and append new message to end, for generate add generated content to selected message, if no message selection then for send: append new message to end of current conversation, for generate add generated content to last message)
----------------------------------
<<   chat history, new at top   >>  (if a message has images, show a 3 option toggle 'high quality' (don't show if image fit 512px x 512px), 'low quality', 'do not use')

example
[select radio                   ]
[small images with select toggle]
[user message                   ]
[-------------------------------]
[response message               ]
[-------------------------------]
[audio player if sound available]

*/
  res.render("chat4_conversation", { conversation, messages });
};

exports.post = async (req, res) => {
  if (req.params.id != "new") {
    console.log(req.body);
    return res.redirect(`/chat4/chat/${req.params.id}`);
  }
  
  const messages = [];
  const text_messages = [];
  if (req.body.context.length > 0) {
    messages.push({
      role: 'system',
      content: [
        { type: 'text', text: req.body.context }
      ]
    });
    text_messages.push({
      role: 'system',
      content: req.body.context,
    });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: req.body.prompt }
    ]
  });
  text_messages.push({
    role: 'user',
    content: req.body.prompt,
  });
  try {
    const images = [];
    const img_elements = [];
    for (let i = 0; i < req.files.length; i++) {
      // Get file from upload form
      const file_data = fs.readFileSync(req.files[i].destination + req.files[i].filename);
      // Load in 'sharp'
      const img_data = await sharp(file_data);
      const metadata = await img_data.metadata();
      let short_side = metadata.width < metadata.height ? metadata.width : metadata.height;
      let long_side = metadata.width > metadata.height ? metadata.width : metadata.height;
      let scale = 1;
      if (short_side > 768 || long_side > 2048) {
        if (768 / short_side < scale) scale = 768 / short_side;
        if (2048 / long_side < scale) scale = 2048 / long_side;
      }
      // Resize to max 2048x768 or 768x2048, but keep aspect ratio
      const scale_img = await img_data.resize({ width: Math.round(metadata.width * scale) });
      // Change format to JPG
      const img_buffer = await scale_img.jpeg().toBuffer();
      // Generate a unique file name
      const filename = `UP-${Date.now()}.jpg`;
      // Save file to folder "../public/img"
      fs.writeFileSync(`./public/img/${filename}`, img_buffer);
      const b64_img = Buffer.from(img_buffer).toString('base64');
      
      images.push({
        filename,
        use_flag: 'high quality'
      });
      img_elements.push(`<img src="data:image/jpeg;base64,${b64_img}" />`);
      messages[messages.length - 1].content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${b64_img}`,
        }
      });
    }
    // Send to OpenAI API
    const response = await chatGPT(messages, 'gpt-4-vision-preview');

    // Generate text summary
    text_messages.push({
      role: 'assistant',
      content: response.choices[0].message.content,
    });
    text_messages.push({
      role: 'user',
      content: 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to go through the entire conversation.',
    });
    const summary = await chatGPT(text_messages, 'gpt-3.5-turbo');

    // Save to database, then redirect to page showing the conversation
    const tags_array = req.body.tags.split(', ').join(',').split(' ').join('_').split(',');
    const chat_message_entry = {
      user_id: req.user.name,
      category: req.body.category,
      tags: tags_array,
      prompt: req.body.prompt,
      response: response.choices[0].message.content,
      images,
      sound: '',
    };
    const db_entry = await new Chat4Model(chat_message_entry).save();
    const conversation_entry = {
      user_id: req.user.name,
      title: req.body.title,
      description: summary.choices[0].message.content,
      category: req.body.category,
      tags: tags_array,
      context_prompt: req.body.context,
      messages: [ db_entry._id.toString() ],
    };
    const conv_entry = await new Conversation4Model(conversation_entry).save();

    // Redirect to chat conversation page
    res.redirect(`/chat4/chat/${conv_entry._id.toString()}`);
  } catch {
    res.send(`<html><body><b>Error processing request</b></body></html>`);
  }
};