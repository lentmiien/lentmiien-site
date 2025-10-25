const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { OpenAI } = require('openai');
const logger = require('./logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_PRIVATE });
const VIDEO_OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'video');

const reasoningModels = [
  "o3-pro-2025-06-10",
  "o3-2025-04-16",
  "o4-mini-2025-04-16",
  "gpt-5-2025-08-07",
  "gpt-5-mini-2025-08-07",
  "gpt-5-nano-2025-08-07",
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
      logger.notice("Type undefined: ", d);
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
    if (conversation.metadata.outputFormat) {
      inputParameters['text'] = {format:{type:conversation.metadata.outputFormat}};
      if (model.api_model.indexOf("gpt-5") === 0 && conversation.metadata.verbosity) {
        inputParameters['text']['verbosity'] = conversation.metadata.verbosity;
      }
    }
    if (conversation.metadata.reasoning && reasoningModels.indexOf(model.api_model) >= 0) inputParameters["reasoning"] = {effort: conversation.metadata.reasoning, summary: "detailed"};
    let response = await openai.responses.create(inputParameters);
    return response.id;
  } catch (error) {
    logger.error(`Error while calling ChatGPT API: ${error}`);
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
    logger.error(`Error while calling Embedding API: ${error}`);
    return null;
  }
};

const fetchCompleted = async (response_id) => {
  try {
    response = await openai.responses.retrieve(response_id);
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
    output.push({error:response.error});
    return output;
  } catch (error) {
    logger.error(`Error while fetching completed response API: ${error}`);
    return null;
  }
}

const uploadBatchFile = async (contents) => {
  try {
    const buffer = Buffer.from(contents, 'utf-8');
    const file = await openai.files.create({
      file: await OpenAI.toFile(buffer, `batch-${Date.now()}.jsonl`, {
        type: 'application/jsonl',
      }),
      purpose: 'batch',
    });
    return file;
  } catch (error) {
    logger.error('Failed to upload batch file to OpenAI', { error });
    return null;
  }
};

const startBatchJob = async ({ fileId, endpoint = '/v1/responses', completionWindow = '24h' }) => {
  try {
    const batch = await openai.batches.create({
      input_file_id: fileId,
      endpoint,
      completion_window: completionWindow,
    });
    return batch;
  } catch (error) {
    logger.error('Failed to start OpenAI batch job', { error });
    return null;
  }
};

const retrieveBatchStatus = async (batchId) => {
  try {
    return await openai.batches.retrieve(batchId);
  } catch (error) {
    logger.error('Failed to retrieve OpenAI batch status', { error, batchId });
    return null;
  }
};

const downloadBatchOutput = async (fileId) => {
  try {
    const response = await openai.files.content(fileId);
    const body = await response.text();
    return body
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    logger.error('Failed to download OpenAI batch output file', { error, fileId });
    return null;
  }
};

const deleteBatchFile = async (fileId) => {
  try {
    await openai.files.delete(fileId);
    return true;
  } catch (error) {
    logger.error('Failed to delete OpenAI batch file', { error, fileId });
    return false;
  }
};

const convertResponseBody = async (body) => {
  if (!body) return [{ error: 'Empty response body' }];

  const converted = [];

  if (Array.isArray(body.output)) {
    for (const item of body.output) {
      const data = await convertOutput(item);
      if (data) {
        converted.push(data);
      }
    }
  }

  converted.push({ error: body.error ?? null });
  return converted;
};

const generateVideo = async (prompt, model, seconds, size, inputImagePath) => {
  try {
    const payload = {
      model,
      prompt,
      seconds,
      size,
    };

    if (inputImagePath) {
      const filename = path.basename(inputImagePath) || 'reference.jpg';
      const inputReference = await OpenAI.toFile(
        fs.createReadStream(inputImagePath),
        filename,
        { type: 'image/jpeg' },
      );
      payload.input_reference = inputReference;
    }

    const video = await openai.videos.create(payload);
    logger.debug('OpenAI generate video response', {
      data: video,
      hasReference: Boolean(payload.input_reference),
    });
    return video;
  } catch (error) {
    logger.error('Failed to create Sora video via OpenAI API', { error });
    throw error;
  }
};

const waitAndFetchVideo = async (video) => {
  let progress = video.progress ?? 0;

  while (video.status === 'in_progress' || video.status === 'queued') {
    video = await openai.videos.retrieve(video.id);
    progress = video.progress ?? 0;

    // Display progress bar
    const barLength = 30;
    const filledLength = Math.floor((progress / 100) * barLength);
    // Simple ASCII progress visualization for terminal output
    const bar = '='.repeat(filledLength) + '-'.repeat(barLength - filledLength);
    const statusText = video.status === 'queued' ? 'Queued' : 'Processing';

    console.log(`${statusText}: [${bar}] ${progress.toFixed(1)}%`);

    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  if (video.status === 'failed') {
    logger.error('Video generation failed');
    return false;
  }

  return await fetchVideo(video.id);
}

const fetchVideo = async (video_id) => {
  const content = await openai.videos.downloadContent(video_id);

  const body = content.arrayBuffer();
  const buffer = Buffer.from(await body);

  const filename = `video_${Date.now()}.mp4`;

  await fs.promises.mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
  const filepath = path.join(VIDEO_OUTPUT_DIR, filename);
  await fs.promises.writeFile(filepath, buffer);

  return filename;
}

const checkVideoProgress = async (video_id) => {
  try {
    const video = await openai.videos.retrieve(video_id);
    const error = video.error ?? null;
    return {
      id: video.id,
      status: video.status,
      progress: video.progress ?? 0,
      eta: video.eta ?? null,
      output: video.output ?? null,
      error,
    };
  } catch (error) {
    logger.error('Failed to check video progress', { error });
    return null;
  }
}

module.exports = {
  chat,
  embedding,
  fetchCompleted,
  uploadBatchFile,
  startBatchJob,
  retrieveBatchStatus,
  downloadBatchOutput,
  deleteBatchFile,
  convertResponseBody,
  generateVideo,
  waitAndFetchVideo,
  fetchVideo,
  checkVideoProgress,
}
