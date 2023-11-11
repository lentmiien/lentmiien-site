// Import dependencis
const fs = require("fs");
const path = require("path");
const { OpenaicalllogDBModel, OpenaimodelDBModel } = require('../database');
const { OpenAI } = require('openai');

// Set your OpenAI API key
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Open AI API models
const GetModels = async (type) => {
  if (type && type.length > 0) {
    return (await OpenaimodelDBModel.find({ model_type: type }));
  } else {
    return (await OpenaimodelDBModel.find());
  }
};

const AddModel = async (model_name, api_endpoint, input_1k_token_cost, output_1k_token_cost, model_type, max_tokens) => {
  // if api_endpoint exists, then update, otherwise add new
  const model = await OpenaimodelDBModel.find({api_endpoint});
  if (model.length >= 1) {
    // Update
    for (let i = 0; i < model.length; i++) {
      model[i].model_name = model_name;
      model[i].input_1k_token_cost = input_1k_token_cost;
      model[i].output_1k_token_cost = output_1k_token_cost;
      model[i].model_type = model_type;
      model[i].max_tokens = max_tokens;
      await model[i].save();
    }
  } else {
    // Add new
    const entry_to_save = new OpenaimodelDBModel({
      model_name,
      api_endpoint,
      input_1k_token_cost,
      output_1k_token_cost,
      model_type,
      max_tokens,
    });
  
    // Save to database
    await entry_to_save.save();
  }
};

const DeleteModel = async (id_to_delete) => {
  await OpenaimodelDBModel.deleteOne({ _id: id_to_delete });
};

// Open AI API call log middleware
const OpenAIAPICallLog = async (user_id, api_endpoint, input_token_count, output_token_count, input_text_or_embedding, output_text_or_embedding) => {
  // Get costs
  const models = await OpenaimodelDBModel.find();
  const model_lookup = {};
  models.forEach(model => {
    model_lookup[model.api_endpoint] = model;
  });

  // New entry
  const entry_to_save = new OpenaicalllogDBModel({
    timestamp: new Date(),
    user_id,
    api_endpoint,
    input_token_count,
    output_token_count,
    input_text_or_embedding,
    output_text_or_embedding,
    total_request_cost: ((model_lookup[api_endpoint].input_1k_token_cost * input_token_count) + (model_lookup[api_endpoint].output_1k_token_cost * output_token_count)) / 1000,
  });

  // Save to database
  await entry_to_save.save();
};

const OpenAIAPICallLog_ig = async (user_id, api_endpoint, size, quality, prompt, output_image) => {
  // Get costs;
  /*
  Prices
           | 1024x1024 | 1792x1024 / 1024x1792
  ---------+-----------+----------------------
  standard |     $0.04 |     $0.08
  ---------+-----------+----------------------
  hd       |     $0.08 |     $0.12
  ---------+-----------+----------------------
  */
  const costs = {
    standard: {
      "1024x1024": 0.04,
      "1024x1792": 0.08,
      "1792x1024": 0.08,
    },
    hd: {
      "1024x1024": 0.08,
      "1024x1792": 0.12,
      "1792x1024": 0.12,
    },
  };
  const cost = costs[quality][size];
  const s = size.split('x');

  // New entry
  const entry_to_save = new OpenaicalllogDBModel({
    timestamp: new Date(),
    user_id,
    api_endpoint,
    input_token_count: parseInt(s[0]),
    output_token_count: parseInt(s[1]),
    input_text_or_embedding: prompt,
    output_text_or_embedding: output_image,
    total_request_cost: cost,
  });

  // Save to database
  await entry_to_save.save();
};

const GetOpenAIAPICallHistory = async (user_id) => {
  return (await OpenaicalllogDBModel.find({ user_id }));
};

const chatGPT = async (messages, model) => {
  try {
    const response = await openai.chat.completions.create({
      messages,
      model,
    });
    return response.data;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

// text-embedding-ada-002
const embedding = async (text, model) => {
  try {
    const response = await openai.embeddings.create({
      input: text,
      model,
    });
    return response.data;
  } catch (error) {
    console.error(`Error while calling Embedding API: ${error}`);
    return null;
  }
};

const tts = async (text) => {
  const filename = `sound${Date.now()}.mp3`;
  const outputfile = path.resolve(`./public/mp3/${filename}`);
  const mp3 = await openai.audio.speech.create({
    model: "tts-1-hd",
    voice: "nova",
    input: text,
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.promises.writeFile(outputfile, buffer);
  return `/mp3/${filename}`;
};

const ig = async (prompt, quality, size) => {
  const q_val = ["standard", "hd"];
  const s_val = ["1024x1024", "1792x1024", "1024x1792"];
  if (prompt.length > 4000 || q_val.indexOf(quality) == -1 || s_val.indexOf(size) == -1) {
    return 'invalid input';
  }

  const filename = `image${Date.now()}.png`;
  const outputfile = path.resolve(`./public/img/${filename}`);
  const image = await openai.images.generate({
    model: "dall-e-3",
    prompt, // MAX 4000 character
    n: 1,
    quality, // "standard" or "hd"
    response_format: "b64_json",
    size, // "1024x1024" or "1792x1024" or "1024x1792"
  });
  const data = image.data[0].b64_json.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(data, 'base64');
  await fs.promises.writeFile(outputfile, buffer);
  await OpenAIAPICallLog_ig("Lennart", "dall-e-3", size, quality, image.data[0].revised_prompt || prompt, filename);
  return `/img/${filename}`;
};

module.exports = {
  OpenAIAPICallLog,
  chatGPT,
  embedding,
  GetModels,
  AddModel,
  DeleteModel,
  GetOpenAIAPICallHistory,
  tts,
  ig,
};
