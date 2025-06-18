const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const reasoningModels = [
  "o3-pro-2025-06-10",
  "o3-2025-04-16",
  "o4-mini-2025-04-16",
];

const type_map = {
  message: "text",
  image_generation_call: "image",
  web_search_call: "tool",
  reasoning: "reasoning",
};

const tools_map = {
  image_generation: { type: "image_generation" },
  web_search_preview: { type: "web_search_preview" },
};

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
          const b64_img = loadImageToBase64(message.content.image);
          content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64_img}` });
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

async function saveImageFromBase64(b64_img) {
  const number = Date.now();
  const filename = `image-${number}-.png`;
  const outputfile = path.resolve(`./public/img/${filename}`);
  const data = b64_img;
  const buffer = Buffer.from(data, 'base64');
  await fs.promises.writeFile(outputfile, buffer);

  const jpg_filename = `image-${number}-.jpg`;
  const jpg_outputfile = path.resolve(`./public/img/${jpg_filename}`);
  const jpgBuffer = await sharp(buffer).jpeg({ quality: 70 }).toBuffer();
  await fs.promises.writeFile(jpg_outputfile, jpgBuffer);

  return jpg_filename;
}

async function convertOutput (d) {
  const type = type_map[d.type];
  switch (d.type) {
    case "message":
      return {
        contentType: type,
        content: {
          text: d.content[0].text,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: null,
        },
        hideFromBot: false,
      };
    case "image_generation_call":
      const image_file = await saveImageFromBase64(d.result);
      return {
        contentType: type,
        content: {
          text: null,
          image: image_file,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: d.revised_prompt,
          imageQuality: "high",
          toolOutput: null,
        },
        hideFromBot: true,
      };
    case "web_search_call":
      return {
        contentType: type,
        content: {
          text: null,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: null,
          imageQuality: null,
          toolOutput: `${d.type}: ${d.status}`,
        },
        hideFromBot: true,
      };
    case "reasoning":
      if (d.summary.length === 0) {
        return null;
      } else {
        return {
          contentType: type,
          content: {
            text: d.summary[0].text,
            image: null,
            audio: null,
            tts: null,
            transcript: null,
            revisedPrompt: null,
            imageQuality: null,
            toolOutput: null,
          },
          hideFromBot: true,
        };
      }
    default:
      console.log("Type undefined: ", d);
      return null;
  }
}

const chat = async (conversation, messages, model) => {
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
      background: true,
      // store: false,
    };
    if (conversation.metadata.outputFormat) inputParameters['text'] = {format:{type:conversation.metadata.outputFormat}};
    if (conversation.metadata.reasoning && reasoningModels.indexOf(model.api_model) >= 0) inputParameters["reasoning"] = {effort: conversation.metadata.reasoning, summary: "detailed"};
    let response = await openai.responses.create(inputParameters);
    while (response.status === "queued" || response.status === "in_progress") {
      console.log("Current status: " + response.status);
      await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds
      response = await openai.responses.retrieve(response.id);
    }
    // For debugging purposes, save a copy of response to temporary folder
    const filename = `response-${Date.now()}-.json`;
    const outputfile = path.resolve(`./tmp_data/${filename}`);
    await fs.promises.writeFile(outputfile, JSON.stringify(response, null, 2));
    // DEBUG_END
    const output = [];
    for (const d of response.output) {
      const data = await convertOutput(d);
      if (data) {
        output.push(data);
      }
    }
    return output;
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
