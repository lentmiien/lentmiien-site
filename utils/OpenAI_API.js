const fs = require('fs');
const sharp = require('sharp');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const reasoningModels = [
  "o3-pro-2025-06-10",
  "o3-2025-04-16",
  "o4-mini-2025-04-16",
];

function GenerateMessagesArray_Responses(context, messages, isImageModel) {
  const messageArray = [];
  if (context.type != "none" && context.prompt && context.prompt.length > 0) {
    messageArray.push({
      role: context.type,
      content: [{ type: 'input_text', text: context.prompt }],
    });
  }

  // Messages
  let role = messages[0].user_id === "bot" ? 'assistant' : 'user';
  let content = [];
  for (const message of messages) {
    const this_role = message.user_id === "bot" ? 'assistant' : 'user';
    if (role != this_role) {
      messageArray.push({
        role,
        content,
      });
      role = this_role;
      content = [];
    }
    if (!message.hideFromBot) {
      if (message.contentType === "text") {
        content.push({ type: this_role === "user" ? 'input_text' : 'output_text', text: message.content.text });
      }
      if (message.contentType === "image") {
        if (isImageModel && this_role === "user") {
          content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${message.content.image}` });
        }
        else {
          content.push({ type: this_role === "user" ? 'input_text' : 'output_text', text: `Image prompt: ${message.content.revisedPrompt}` });
        }
      }
    }
  }
  messageArray.push({
    role,
    content,
  });

  return messageArray;
}

function loadImageToBase64(filename) {
  const img_buffer = fs.readFileSync(`./public/img/${filename}`);
  const b64_img = Buffer.from(img_buffer).toString('base64');
  return b64_img;
}

async function loadProcessNewImageToBase64(filename) {
  const file_data = fs.readFileSync(filename);
  const img_data = sharp(file_data);
  const metadata = await img_data.metadata();
  let short_side = metadata.width < metadata.height ? metadata.width : metadata.height;
  let long_side = metadata.width > metadata.height ? metadata.width : metadata.height;
  let scale = 1;
  if (short_side > 768 || long_side > 2048) {
    if (768 / short_side < scale) scale = 768 / short_side;
    if (2048 / long_side < scale) scale = 2048 / long_side;
  }
  const scale_img = img_data.resize({ width: Math.round(metadata.width * scale) });
  const img_buffer = await scale_img.jpeg().toBuffer();
  const new_filename = `UP-${Date.now()}.jpg`;
  fs.writeFileSync(`./public/img/${new_filename}`, img_buffer);
  const b64 = Buffer.from(img_buffer).toString('base64');
  return { new_filename, b64 };
}

const chat = async (conversation, messages, model, tools_map) => {
  const messageArray = GenerateMessagesArray_Responses({type: model.context_type, prompt: conversation.metadata.context_prompt}, messages, model.in_modalities.indexOf("image") >= 0);

  const tools = [];
  if (conversation.metadata.tools && conversation.metadata.tools.length > 0) {
    for (const t of conversation.metadata.tools) {
      tools.push(tools_map[t]);
    }
  }

  // Connect to API
  try {
    const inputParameters = {
      model: model.api_model,
      input: messageArray,
      tools,
      // store: false,
    };
    if (conversation.metadata.outputFormat) inputParameters['text'] = {format:{type:conversation.metadata.outputFormat}};
    if (conversation.metadata.reasoning && reasoningModels.indexOf(model.api_model) >= 0) inputParameters["reasoning"] = conversation.metadata.reasoning;
    const response = await openai.responses.create(inputParameters);
    return response;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

const embedding = async (text, model) => {
  try {
    const response = await openai.embeddings.create({
      input: text,
      model: model.api_model,
    });
    return response;
  } catch (error) {
    console.error(`Error while calling Embedding API: ${error}`);
    return null;
  }
};

module.exports = {
  chat,
  embedding,
}
