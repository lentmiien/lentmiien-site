const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const marked = require('marked');
const { chatGPT, embedding, OpenAIAPICallLog, GetModels, tts, ig } = require('../utils/ChatGPT');
// const utils = require('../utils/utils');

// const default_models = require("../cache/default_models.json");

// Require necessary database models
const { Chat4Model, Conversation4Model, Chat3TemplateModel } = require('../database');
const conversation4 = require('../models/conversation4');
const { log } = require('console');

exports.index = async (req, res) => {
  const templates = await Chat3TemplateModel.find();
  const conversations = await conversation4.find({ user_id: req.user.name });
  conversations.reverse();
  const categories = [];
  conversations.forEach(d => {
    if (categories.indexOf(d.category) === -1) {
      categories.push(d.category);
    }
  });
  res.render("chat4", { conversations, categories, templates });
};

exports.chat = async (req, res) => {
  const templates = await Chat3TemplateModel.find();
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
  res.render("chat4_conversation", { conversation, messages, templates });
};

exports.post = async (req, res) => {
  let images_exist = false;
  const messages = [];
  const text_messages = [];

  // Set context message
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

  // If continuation of previous chat, append old messages
  if (req.params.id != "new") {
    // Load chat conversation, req.params.id <- conversation id
    const conversation = await Conversation4Model.findById(req.params.id);
    // Load chat messages, conversation.messages <- array of chat messages ids
    const m_id = conversation.messages;
    const prev_messages = await Chat4Model.find({ _id: m_id });
    prev_messages.sort((a,b) => {
      const a_i = m_id.indexOf(a._id.toString());
      const b_i = m_id.indexOf(b._id.toString());
      if (a_i < b_i) return -1;
      if (a_i > b_i) return 1;
      return 0;
    });
    // Append
    for (let x = 0; x < prev_messages.length; x++) {
      const m = prev_messages[x];
      // Process images if any
      const content = [{ type: 'text', text: m.prompt }];
      let updated = false;
      if (m.images.length > 0) {
        for (let i = 0; i < m.images.length; i++) {
          // Check use_flag
          if (req.body[m.images[i].filename] != "0") {
            images_exist = true;
            // Load if needed
            const img_buffer = fs.readFileSync(`./public/img/${m.images[i].filename}`);
            // Convert to base 64
            const b64_img = Buffer.from(img_buffer).toString('base64');
            // Append to content array
            content.push({
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${b64_img}`,
                detail: `${req.body[m.images[i].filename] === '2' ? 'high' : 'low'}`
              }
            });
          }
          const use_flag_map = {
            "0": "do not use",
            "1": "low quality",
            "2": "high quality",
          };
          if (use_flag_map[req.body[m.images[i].filename]] != m.images[i].use_flag) {
            m.images[i].use_flag = use_flag_map[req.body[m.images[i].filename]];
            updated = true;
          }
        }
      }
      if (updated) {
        await m.save();
      }
      // User prompt
      messages.push({
        role: 'user',
        content
      });
      text_messages.push({
        role: 'user',
        content: m.prompt,
      });

      // Assistant response
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: m.response },
        ]
      });
      text_messages.push({
        role: 'assistant',
        content: m.response,
      });
    }
  }

  // Add new message
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
      images_exist = true;
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
    const response = await chatGPT(images_exist ? messages : text_messages, images_exist ? 'gpt-4-vision-preview' : 'gpt-4-turbo-preview');

    // Generate text summary
    text_messages.push({
      role: 'assistant',
      content: response.choices[0].message.content,
    });
    text_messages.push({
      role: 'user',
      content: 'Based on our discussion, please generate a concise summary that encapsulates the main facts, conclusions, and insights we derived, without the need to mention the specific dialogue exchanges. This summary should serve as an informative overlook of our conversation, providing clear insight into the topics discussed, the conclusions reached, and any significant facts or advice given. The goal is for someone to grasp the essence of our dialogue and its outcomes from this summary without needing to go through the entire conversation.',
    });
    const summary = await chatGPT(text_messages, response.usage.total_tokens < 16000 ? 'gpt-3.5-turbo' : 'gpt-4-turbo-preview');

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
    if (req.params.id === "new") {
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
    } else {
      // update existing DB entry
      const conversation = await Conversation4Model.findById(req.params.id);
      conversation.title = req.body.title;
      conversation.description = summary.choices[0].message.content;
      conversation.category = req.body.category;
      conversation.tags = tags_array;
      conversation.context_prompt = req.body.context;
      conversation.messages.push(db_entry._id.toString());
      await conversation.save();

      // Redirect to chat conversation page
      res.redirect(`/chat4/chat/${req.params.id}`);
    }
  } catch (err) {
    res.send(`<html><body><b>Error processing request</b><pre>${JSON.stringify(err, null, 2)}</pre></body></html>`);
  }
};