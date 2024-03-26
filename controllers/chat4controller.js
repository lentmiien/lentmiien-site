const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// const marked = require('marked');
const { chatGPT, embedding, OpenAIAPICallLog, GetModels, tts, ig } = require('../utils/ChatGPT');
// const utils = require('../utils/utils');

// const default_models = require("../cache/default_models.json");

// Require necessary database models
// const { Chat3Model, Chat3TemplateModel, Chat3KnowledgeTModel, Chat3KnowledgeModel, FileMetaModel } = require('../database');

exports.index = async (req, res) => {
  res.render("chat4");
};

/*
messages: [
  {
    role: "user",
    content: [
      { type: "text", text: "What’s in this image?" },
      {
        type: "image_url",
        image_url: {
          "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg",
        },
      },
    ],
  },
],
*/
exports.post = async (req, res) => {
  const messages = [];
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: req.body.prompt }
    ]
  });
  try {
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
      
      img_elements.push(`<img src="data:image/jpeg;base64,${b64_img}" />`);
      messages[0].content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${b64_img}`,
        }
      });
    }
    // Send to OpenAI API
    const response = await chatGPT(messages, 'gpt-4-vision-preview');
    // Transform image to base 64 format
    res.send(`<html><body>${img_elements.join("")}<br><b>${req.body.prompt}</b><hr><b>Answer:</b><p>${response.choices[0].message.content}</p></body></html>`);
  } catch {
    res.send(`<html><body><b>Error processing request</b></body></html>`);
  }
};