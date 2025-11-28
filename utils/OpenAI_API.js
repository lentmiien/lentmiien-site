const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { OpenAI } = require('openai');
const logger = require('./logger');
const ApiDebugLog = require('../models/api_debug_log');

const JS_FILE_NAME = 'utils/OpenAI_API.js';

const toSerializable = (payload) => {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (payload instanceof Buffer) {
    return {
      type: 'Buffer',
      encoding: 'base64',
      data: payload.toString('base64'),
    };
  }
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack,
    };
  }
  if (payload instanceof Date) {
    return payload.toISOString();
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => toSerializable(item));
  }
  if (typeof payload === 'object') {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (err) {
      if (typeof payload.toString === 'function') {
        return payload.toString();
      }
      return {
        error: 'Failed to serialize payload',
        message: err.message,
      };
    }
  }
  return payload;
};

const headersToObject = (headers) => {
  if (!headers || typeof headers.forEach !== 'function') {
    return null;
  }
  const result = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return Object.keys(result).length > 0 ? result : null;
};

const recordApiDebugLog = async ({
  requestUrl,
  requestHeaders = null,
  requestBody = null,
  responseHeaders = null,
  responseBody = null,
  functionName,
}) => {
  try {
    await ApiDebugLog.create({
      requestUrl,
      requestHeaders: toSerializable(requestHeaders),
      requestBody: toSerializable(requestBody),
      responseHeaders: toSerializable(responseHeaders),
      responseBody: toSerializable(responseBody),
      jsFileName: JS_FILE_NAME,
      functionName,
    });
  } catch (err) {
    logger.error('Failed to save API debug log entry', {
      error: err,
      requestUrl,
      functionName,
    });
  }
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_PRIVATE });
const VIDEO_OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'video');

const reasoningModels = [
  "gpt-5.1-2025-11-13",
  "gpt-5-pro-2025-10-06",
  "o3-deep-research-2025-06-26",
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

const TOOL_LABELS = {
  image_generation: 'image generation',
  web_search_preview: 'web search preview',
};

function resolveContextPrompt(conversation) {
  if (!conversation) return '';
  const metadata = conversation.metadata || {};
  const candidates = [
    metadata.contextPrompt,
    metadata.context_prompt,
    conversation.contextPrompt,
    conversation.context_prompt,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return '';
}

function formatToolList(toolLabels) {
  if (toolLabels.length === 1) return toolLabels[0];
  if (toolLabels.length === 2) return `${toolLabels[0]} and ${toolLabels[1]}`;
  const last = toolLabels[toolLabels.length - 1];
  return `${toolLabels.slice(0, -1).join(', ')}, and ${last}`;
}

function appendToolGuidance(prompt, tools = []) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return typeof prompt === 'string' ? prompt : '';
  }

  const labels = tools
    .map(tool => {
      if (typeof tool !== 'string') return '';
      return TOOL_LABELS[tool] || tool;
    })
    .map(label => label.trim())
    .filter(label => label.length > 0);

  if (labels.length === 0) {
    return typeof prompt === 'string' ? prompt : '';
  }

  const uniqueLabels = Array.from(new Set(labels));
  const joined = formatToolList(uniqueLabels);
  const hint = `You can use ${joined} if needed.`;

  const base = typeof prompt === 'string' ? prompt : '';
  const normalizedBase = base.trimEnd();
  return normalizedBase.length > 0 ? `${normalizedBase}\n\n${hint}` : hint;
}

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
      let search_details = [];
      if (d.action) {
        if (d.action.type) search_details.push(`type: ${d.action.type}`);
        if (d.action.query) search_details.push(`query: ${d.action.query}`);
      }
      if (search_details.length === 0) search_details.push(`${d.type}: ${d.status}`);
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
          toolOutput: search_details.join(', '),
        },
        hideFromBot: true,
      };
    case "reasoning":
      if (d.summary.length === 0) {
        return null;
      } else {
        let summary_texts = [];
        d.summary.forEach(d => {
          if (d.type === "summary_text") summary_texts.push(d.text);
        });
        return {
          contentType: type,
          content: {
            text: summary_texts.join('\n\n'),
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
  const resolvedContext = resolveContextPrompt(conversation);
  const promptWithTools = appendToolGuidance(resolvedContext, conversation?.metadata?.tools);
  const messageArray = GenerateMessagesArray_Responses(
    {type: model.context_type, prompt: promptWithTools},
    messages,
    model.in_modalities.indexOf("image") >= 0
  );

  const tools = [];
  if (conversation.metadata.tools && conversation.metadata.tools.length > 0) {
    for (const t of conversation.metadata.tools) {
      tools.push(tools_map[t]);
    }
  }

  const inputParameters = {
    model: model.api_model,
    input: messageArray,
    tools,
    background: true,
    // store: false,
  };
  if (conversation.metadata.outputFormat) {
    inputParameters['text'] = { format: { type: conversation.metadata.outputFormat } };
    if (model.api_model.indexOf("gpt-5") === 0 && conversation.metadata.verbosity) {
      inputParameters['text']['verbosity'] = conversation.metadata.verbosity;
    }
  }
  if (conversation.metadata.reasoning && reasoningModels.indexOf(model.api_model) >= 0) {
    inputParameters["reasoning"] = { effort: conversation.metadata.reasoning, summary: "detailed" };
  }

  const requestUrl = 'openai.responses.create';

  try {
    const response = await openai.responses.create(inputParameters);
    await recordApiDebugLog({
      requestUrl,
      requestBody: inputParameters,
      functionName: 'chat',
      responseBody: response,
    });
    return response.id;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: inputParameters,
      functionName: 'chat',
      responseBody: error,
    });
    logger.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

const embedding = async (text, model) => {
  const requestUrl = 'openai.embeddings.create';
  const requestBody = {
    input: text,
    model: model.api_model,
  };

  try {
    const response = await openai.embeddings.create(requestBody);
    await recordApiDebugLog({
      requestUrl,
      requestBody,
      functionName: 'embedding',
      responseBody: response,
    });
    return response;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody,
      functionName: 'embedding',
      responseBody: error,
    });
    logger.error(`Error while calling Embedding API: ${error}`);
    return null;
  }
};

const fetchCompleted = async (response_id) => {
  const waitSchedule = [0, 30000, 300000];
  const responses = [];
  const retrieveUrl = `openai.responses.retrieve:${response_id}`;

  try {
    for (let attempt = 0; attempt < waitSchedule.length; attempt++) {
      const waitMs = waitSchedule[attempt];
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      const response = await openai.responses.retrieve(response_id);
      await recordApiDebugLog({
        requestUrl: retrieveUrl,
        requestBody: null,
        functionName: 'fetchCompleted',
        responseBody: response,
      });
      responses.push(response);

      const output = Array.isArray(response.output) ? response.output : [];
      const stillInProgress = response.status === 'in_progress' && output.length === 0;

      if (!stillInProgress) {
        if (attempt > 0) {
          logger.notice('OpenAI response completed after retry', {
            responseId: response_id,
            attempt: attempt + 1,
            status: response.status,
            outputLength: output.length,
          });
        }

        const formattedOutput = [];
        for (const d of output) {
          const data = await convertOutput(d);
          if (data) {
            formattedOutput.push(data);
          }
        }
        formattedOutput.push({ error: response.error });
        return formattedOutput;
      }
    }

    const timestamp = Date.now();
    const tmpDataDir = path.resolve('./tmp_data');
    await fs.promises.mkdir(tmpDataDir, { recursive: true });

    const savedFiles = [];
    for (let i = 0; i < responses.length; i++) {
      const filename = `response-${response_id}-${timestamp}-attempt-${i + 1}.json`;
      const filePath = path.join(tmpDataDir, filename);
      await fs.promises.writeFile(filePath, JSON.stringify(responses[i], null, 2));
      savedFiles.push(filePath);
    }

    logger.debug('OpenAI response remained in progress after retries', {
      responseId: response_id,
      attempts: responses.length,
      statuses: responses.map((resp) => resp.status),
      outputLengths: responses.map((resp) => Array.isArray(resp.output) ? resp.output.length : null),
      savedFiles,
    });

    return null;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl: retrieveUrl,
      requestBody: null,
      functionName: 'fetchCompleted',
      responseBody: error,
    });
    logger.error(`Error while fetching completed response API: ${error}`);
    return null;
  }
};

const uploadBatchFile = async (contents) => {
  const requestUrl = 'openai.files.create';
  const fileName = `batch-${Date.now()}.jsonl`;
  const logRequestBody = {
    purpose: 'batch',
    fileName,
    contents,
  };

  try {
    const buffer = Buffer.from(contents, 'utf-8');
    const fileStream = await OpenAI.toFile(buffer, fileName, {
      type: 'application/jsonl',
    });
    const payload = {
      file: fileStream,
      purpose: 'batch',
    };
    const file = await openai.files.create(payload);
    await recordApiDebugLog({
      requestUrl,
      requestBody: logRequestBody,
      functionName: 'uploadBatchFile',
      responseBody: file,
    });
    return file;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: logRequestBody,
      functionName: 'uploadBatchFile',
      responseBody: error,
    });
    logger.error('Failed to upload batch file to OpenAI', { error });
    return null;
  }
};

const startBatchJob = async ({ fileId, endpoint = '/v1/responses', completionWindow = '24h' }) => {
  const requestUrl = 'openai.batches.create';
  const requestBody = {
    input_file_id: fileId,
    endpoint,
    completion_window: completionWindow,
  };

  try {
    const batch = await openai.batches.create(requestBody);
    await recordApiDebugLog({
      requestUrl,
      requestBody,
      functionName: 'startBatchJob',
      responseBody: batch,
    });
    return batch;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody,
      functionName: 'startBatchJob',
      responseBody: error,
    });
    logger.error('Failed to start OpenAI batch job', { error });
    return null;
  }
};

const retrieveBatchStatus = async (batchId) => {
  const requestUrl = `openai.batches.retrieve:${batchId}`;
  try {
    const status = await openai.batches.retrieve(batchId);
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'retrieveBatchStatus',
      responseBody: status,
    });
    return status;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'retrieveBatchStatus',
      responseBody: error,
    });
    logger.error('Failed to retrieve OpenAI batch status', { error, batchId });
    return null;
  }
};

const downloadBatchOutput = async (fileId) => {
  const requestUrl = `openai.files.content:${fileId}`;
  try {
    const response = await openai.files.content(fileId);
    const responseHeaders = headersToObject(response.headers);
    const body = await response.text();
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'downloadBatchOutput',
      responseHeaders,
      responseBody: body,
    });
    return body
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'downloadBatchOutput',
      responseBody: error,
    });
    logger.error('Failed to download OpenAI batch output file', { error, fileId });
    return null;
  }
};

const deleteBatchFile = async (fileId) => {
  const requestUrl = `openai.files.delete:${fileId}`;
  try {
    const response = await openai.files.delete(fileId);
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'deleteBatchFile',
      responseBody: response,
    });
    return true;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'deleteBatchFile',
      responseBody: error,
    });
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
  const requestUrl = 'openai.videos.create';
  const logRequestBody = {
    model,
    prompt,
    seconds,
    size,
    input_reference: null,
  };

  try {
    const payload = {
      model,
      prompt,
      seconds,
      size,
    };

    if (inputImagePath) {
      const filename = path.basename(inputImagePath) || 'reference.jpg';
      const fileBuffer = await fs.promises.readFile(inputImagePath);
      logRequestBody.input_reference = {
        filename,
        encoding: 'base64',
        data: fileBuffer.toString('base64'),
      };
      const inputReference = await OpenAI.toFile(
        fs.createReadStream(inputImagePath),
        filename,
        { type: 'image/jpeg' },
      );
      payload.input_reference = inputReference;
    }

    const video = await openai.videos.create(payload);
    await recordApiDebugLog({
      requestUrl,
      requestBody: logRequestBody,
      functionName: 'generateVideo',
      responseBody: video,
    });
    logger.debug('OpenAI generate video response', {
      data: video,
      hasReference: Boolean(payload.input_reference),
    });
    return video;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: logRequestBody,
      functionName: 'generateVideo',
      responseBody: error,
    });
    logger.error('Failed to create Sora video via OpenAI API', { error });
    throw error;
  }
};

const waitAndFetchVideo = async (video) => {
  let progress = video.progress ?? 0;

  while (video.status === 'in_progress' || video.status === 'queued') {
    try {
      const retrieved = await openai.videos.retrieve(video.id);
      await recordApiDebugLog({
        requestUrl: `openai.videos.retrieve:${video.id}`,
        requestBody: null,
        functionName: 'waitAndFetchVideo',
        responseBody: retrieved,
      });
      video = retrieved;
      progress = video.progress ?? 0;
    } catch (error) {
      await recordApiDebugLog({
        requestUrl: `openai.videos.retrieve:${video.id}`,
        requestBody: null,
        functionName: 'waitAndFetchVideo',
        responseBody: error,
      });
      logger.error('Failed to poll OpenAI video status', { error, videoId: video.id });
      throw error;
    }

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
};

const fetchVideo = async (video_id) => {
  const requestUrl = `openai.videos.downloadContent:${video_id}`;
  try {
    const content = await openai.videos.downloadContent(video_id);
    const responseHeaders = headersToObject(content.headers);

    const body = content.arrayBuffer();
    const buffer = Buffer.from(await body);

    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'fetchVideo',
      responseHeaders,
      responseBody: {
        videoId: video_id,
        encoding: 'base64',
        data: buffer.toString('base64'),
      },
    });

    const filename = `video_${Date.now()}.mp4`;

    await fs.promises.mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
    const filepath = path.join(VIDEO_OUTPUT_DIR, filename);
    await fs.promises.writeFile(filepath, buffer);

    return filename;
  } catch (error) {
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'fetchVideo',
      responseBody: error,
    });
    logger.error('Failed to download OpenAI video content', { error, videoId: video_id });
    throw error;
  }
};

const checkVideoProgress = async (video_id) => {
  const requestUrl = `openai.videos.retrieve:${video_id}`;
  try {
    const video = await openai.videos.retrieve(video_id);
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'checkVideoProgress',
      responseBody: video,
    });
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
    await recordApiDebugLog({
      requestUrl,
      requestBody: null,
      functionName: 'checkVideoProgress',
      responseBody: error,
    });
    logger.error('Failed to check video progress', { error });
    return null;
  }
};

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
