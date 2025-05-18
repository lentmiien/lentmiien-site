const fs = require('fs');
const sharp = require('sharp');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const responsesModels = ["o1-pro-2025-03-19", "codex-mini-latest", "o4-mini"];
const reasoningModels = [
  "o1-2024-12-17",
  "o3-mini-2025-01-31",
  "o1-pro-2025-03-19",
  "o4-mini",
];

function GenerateMessagesArray_Chat(context, messages, prompt, isImageModel) {
  const messageArray = [];
  const promptImages = [];
  if (context.type != "none" && context.prompt && context.prompt.length > 0) {
    messageArray.push({
      role: context.type,
      content: [{ type: 'text', text: context.prompt }],
    });
  }

  // Messages
  for (const message of messages) {
    const content = [];
    content.push({ type: 'text', text: message.prompt });
    if (isImageModel) {
      for (const image of message.images) {
        if (image.use_flag != "do not use") {
          const b64 = loadImageToBase64(image.filename);
          content.push({
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${b64}`,
              detail: image.use_flag === 'high quality' ? 'high' : 'low',
            }
          });
        }
      }
    }
    messageArray.push({
      role: 'user',
      content,
    });
    messageArray.push({
      role: 'assistant',
      content: [{ type: 'text', text: message.response }],
    });
  }
  // Append prompt
  const content = [];
  content.push({ type: 'text', text: prompt.prompt });
  if (isImageModel) {
    for (const image of prompt.images) {
      const { new_filename, b64 } = loadProcessNewImageToBase64(image.filename);
      promptImages.push(new_filename);
      content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${b64}`,
          detail: 'high',
        }
      });
    }
  }
  messageArray.push({
    role: 'user',
    content,
  });

  return { messageArray, promptImages };
}

function GenerateMessagesArray_Responses(context, messages, prompt, isImageModel) {
  const messageArray = [];
  const promptImages = [];
  if (context.type != "none" && context.prompt && context.prompt.length > 0) {
    messageArray.push({
      role: context.type,
      content: [{ type: 'input_text', text: context.prompt }],
    });
  }

  // Messages
  for (const message of messages) {
    const content = [];
    content.push({ type: 'input_text', text: message.prompt });
    if (isImageModel) {
      for (const image of message.images) {
        if (image.use_flag != "do not use") {
          const b64 = loadImageToBase64(image.filename);
          content.push({
            type: "input_image",
            image_url: {
              url: `data:image/jpeg;base64,${b64}`,
              detail: image.use_flag === 'high quality' ? 'high' : 'low',
            }
          });
        }
      }
    }
    messageArray.push({
      role: 'user',
      content,
    });
    messageArray.push({
      role: 'assistant',
      content: [{ type: 'output_text', text: message.response }],
    });
  }
  // Append prompt
  const content = [];
  for (const m of prompt.chat_array) {
    content.push({ type: 'input_text', text: `${m.name}: ${m.text}` });
  }
  content.push({ type: 'input_text', text: prompt.prompt });
  if (isImageModel) {
    for (const image of prompt.images) {
      const { new_filename, b64 } = loadProcessNewImageToBase64(image.filename);
      promptImages.push(new_filename);
      content.push({
        type: "input_image",
        image_url: {
          url: `data:image/jpeg;base64,${b64}`,
          detail: 'high',
        }
      });
    }
  }
  messageArray.push({
    type: 'message',
    role: 'user',
    content,
  });

  return { messageArray, promptImages };
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

const chat = async (conversation, messages, prompt, model, beta = null) => {
  const isChatAPI = responsesModels.indexOf(model.api_model) === -1;
  const { messageArray, promptImages } = isChatAPI ? 
    GenerateMessagesArray_Chat({type: model.context_type, prompt: conversation.context_prompt}, messages, prompt, model.in_modalities.indexOf("image") >= 0) : 
    GenerateMessagesArray_Responses({type: model.context_type, prompt: conversation.context_prompt}, messages, prompt, model.in_modalities.indexOf("image") >= 0);

  // Connect to API
  try {
    let response;
    if (isChatAPI) {
      const inputParameters = {
        model: model.api_model,
        messages: messageArray,
        store: false,
      };
      if (prompt.effort && reasoningModels.indexOf(model.api_model) >= 0) inputParameters["reasoning_effort"] = prompt.effort;
      if (beta) {
        inputParameters["response_format"] = zodResponseFormat(beta.zod.object, beta.zod.title);
        response = await openai.beta.chat.completions.parse(inputParameters);
      } else {
        response = await openai.chat.completions.create(inputParameters);
      }
    } else {
      const inputParameters = {
        model: model.api_model,
        input: messageArray,
        tools: prompt.tools ? prompt.tools : [],
        // store: false,
      };
      if (prompt.text) inputParameters['text'] = prompt.text;
      if (prompt.reasoning && reasoningModels.indexOf(model.api_model) >= 0) inputParameters["reasoning"] = prompt.reasoning;
      response = await openai.responses.create(inputParameters);
    }
    return {
      output: response,
      promptImages
    };
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
