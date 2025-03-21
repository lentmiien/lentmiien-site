// Import dependencis
const sharp = require('sharp');
const fs = require("fs");
const path = require("path");
const { OpenaicalllogDBModel, OpenaimodelDBModel } = require('../database');
const { OpenAI } = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');

// Set your OpenAI API key (I use 2 projects, so 2 API keys)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openai_private = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_PRIVATE });
const local_llm = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: 'http://localhost:1234/v1' });

const model_list = [];
async function Models() {
  const list = await openai.models.list();

  for await (const model of list) {
    model_list.push({
      model: model.id,
      created: model.created,
    })
  }

  model_list.sort((a,b) => {
    if (a.created > b.created) return -1;
    if (a.created < b.created) return 1;
    return 0;
  });
}
Models();

const GetOpenAIModels = () => {
  return model_list;
};

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
    total_request_cost: 0,
  });
  if ("api_endpoint" in model_lookup) {
    entry_to_save.total_request_cost = ((model_lookup[api_endpoint].input_1k_token_cost * input_token_count) + (model_lookup[api_endpoint].output_1k_token_cost * output_token_count)) / 1000;
  }

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

const OpenAIAPICallLog_tts = async (user_id, api_endpoint, prompt, voice, output_mp3) => {
  // Get costs;
  /*
  Prices
  TTS	    $0.015 / 1K characters
  TTS HD	$0.030 / 1K characters
  */
  const costs = {
    "tts-1": 0.015,
    "tts-1-hd": 0.03,
  };
  const cost = costs[api_endpoint] * prompt.length / 1000;

  // New entry
  const entry_to_save = new OpenaicalllogDBModel({
    timestamp: new Date(),
    user_id,
    api_endpoint,
    input_token_count: prompt.length,
    output_token_count: 0,
    input_text_or_embedding: `${voice}: ${prompt}`,
    output_text_or_embedding: output_mp3,
    total_request_cost: cost,
  });

  // Save to database
  await entry_to_save.save();
};

const GetOpenAIAPICallHistory = async (user_id) => {
  return (await OpenaicalllogDBModel.find({ user_id }));
};

const chatGPT = async (messages, model, private_msg=false) => {
  const inputParameters = {
    model,
    messages,
  };
  if (model === "gpt-4o-search-preview-2025-03-11" || model === "gpt-4o-mini-search-preview-2025-03-11") {
    inputParameters["web_search_options"] = {
      // user_location: {
      //   type: "approximate",
      //   approximate: {
      //     country: "GB",
      //     city: "London",
      //     region: "London",
      //   },
      // },
      search_context_size: "high",// high / medium / low
    };
  }
  try {
    let response;
    if (private_msg) {
      response = await openai_private.chat.completions.create(inputParameters);
    } else {
      response = await openai.chat.completions.create(inputParameters);
    }
    return response;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

const chatGPTaudio = async (messages, model, private_msg=false) => {
  try {
    let response;
    if (private_msg) {
      response = await openai_private.chat.completions.create({
        model,
        modalities: ["text", "audio"],
        audio: { voice: "sage", format: "mp3" },
        messages,
      });
    } else {
      response = await openai.chat.completions.create({
        model,
        modalities: ["text", "audio"],
        audio: { voice: "sage", format: "mp3" },
        messages,
      });
    }
    return response;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

const chatGPT_beta = async (messages, model, private_msg=false, zod) => {
  const inputParameters = {
    model: model,
    messages,
    response_format: zodResponseFormat(zod.object, zod.title),
  };
  try {
    let response;
    if (private_msg) {
      response = await openai_private.beta.chat.completions.parse(inputParameters);
    } else {
      response = await openai.beta.chat.completions.parse(inputParameters);
    }
    return response;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

const responses = async (messages, model, effort) => {
  try {
    const input_messages = [];
    for (const m of messages) {
      if (m.role === "system") {
        input_messages.push({
          role: "developer",
          content: [
            {
              type: "input_text",
              text: m.content[0].text,
            },
          ],
        });
      } else if (m.role === "user") {
        input_messages.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: m.content[0].text,
            },
          ],
        });
      } else if (m.role === "assistant") {
        input_messages.push({
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: m.content[0].text,
            },
          ],
        });
      } else {
        console.log(`Role "${m.role}" has not been implemented, continue without the following message:`, m);
      }
    }
    const response = await openai.responses.create({
      model,
      input: input_messages,
      text: {
        "format": {
          "type": "text"
        }
      },
      reasoning: {
        effort: effort ? effort : "medium"
      },
      tools: [],
      store: false
    });
    return {
      "id": response.id,
      "object": response.object,
      "created": response.created_at,
      "model": response.model,
      "choices": [
        {
          "index": 0,
          "message": {
            "role": response.output[0].role,
            "content": response.output[0].content[0].text,
            "refusal": null,
            "annotations": response.output[0].content[0].annotations
          },
          "logprobs": null,
          "finish_reason": "stop"
        }
      ],
      "usage": {
        "prompt_tokens": response.usage.input_tokens,
        "completion_tokens": response.usage.output_tokens,
        "total_tokens": response.usage.total_tokens,
        "prompt_tokens_details": response.usage.input_tokens_details,
        "completion_tokens_details": response.usage.output_tokens_details
      },
      "service_tier": "default"
    };
  } catch (error) {
    console.error(`Error while calling the OpenAI responses API: ${error}`);
    throw error;
  }
};

// reasoning_effort: "low" / "medium" / "high"
const chatGPT_o1 = async (messages, model, reasoning_effort = null, private_msg=false) => {
  // context not supported, so remove context message
  // "system" -> "developer", starting from "o1-2024-12-17"
  // Include "Formatting reenabled" in developer message to get markdown output
  let use_msg;
  if (model === "o1-2024-12-17" || model === "o1" || model === "o3-mini-2025-01-31") {
    for (let i = 0; i < messages.length; i++) {
      if (messages.role === "system") {
        messages.role === "developer";
      }
    }
    use_msg = messages;
  } else {
    use_msg = messages.filter(m => m.role != "system");
  }
  try {
    const openai_load = {
      messages: use_msg,
      model,
    };
    if (reasoning_effort && (model === "o1-2024-12-17" || model === "o1" || model === "o3-mini-2025-01-31")) {
      openai_load["reasoning_effort"] = reasoning_effort;
    }
    let response;
    if (model === "o1-pro-2025-03-19") {
      response = await responses(messages, model, reasoning_effort);
    } else {
      if (private_msg) {
        response = await openai_private.chat.completions.create(openai_load);
      } else {
        response = await openai.chat.completions.create(openai_load);
      }
      // o1 and o3-mini don't generate markdown, so put in codeblock to handle as text (to prevent html generation from disrupting the page)
      if (model === "o1-2024-12-17" || model === "o1" || model === "o3-mini-2025-01-31") {
        response.choices[0].message.content = "```\n" + response.choices[0].message.content + "\n```";
      }
    }
    return response;
  } catch (error) {
    console.error(`Error while calling the OpenAI API: ${error}`);
    return null;
  }
};

const chatGPT_Tool = async (messages, model, tools, tool_choice, private_msg=false) => {
  try {
    let response;
    if (private_msg) {
      response = await openai_private.chat.completions.create({
        messages,
        model,
        tools,
        tool_choice,
      });
    } else {
      response = await openai.chat.completions.create({
        messages,
        model,
        tools,
        tool_choice,
      });
    }
    return response;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

const embedding = async (text, model, private_msg=false) => {
  try {
    let response;
    if (private_msg) {
      response = await openai_private.embeddings.create({
        input: text,
        model,
      });
    } else {
      response = await openai.embeddings.create({
        input: text,
        model,
      });
    }
    return response;
  } catch (error) {
    console.error(`Error while calling Embedding API: ${error}`);
    return null;
  }
};

const tts = async (api_endpoint, text, voice, private_msg=false) => {
  const api_val = ["tts-1", "tts-1-hd"];
  const v_val = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
  if (text.length > 4096 || api_val.indexOf(api_endpoint) == -1 || v_val.indexOf(voice) == -1) {
    return 'Invalid input'
  }

  const filename = `sound-${Date.now()}-.mp3`;
  const outputfile = path.resolve(`./public/mp3/${filename}`);
  let mp3;
  if (private_msg) {
    mp3 = await openai_private.audio.speech.create({
      model: api_endpoint,
      voice,
      input: text,
    });
  } else {
    mp3 = await openai.audio.speech.create({
      model: api_endpoint,
      voice,
      input: text,
    });
  }
  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.promises.writeFile(outputfile, buffer);
  await OpenAIAPICallLog_tts("Lennart", api_endpoint, text, voice, filename)
  return { filename, prompt: text };
};

const ig = async (prompt, quality, size, img_id = Date.now(), private_msg=false) => {
  const q_val = ["standard", "hd"];
  const s_val = ["1024x1024", "1792x1024", "1024x1792"];
  if (prompt.length > 4000 || q_val.indexOf(quality) == -1 || s_val.indexOf(size) == -1) {
    return 'invalid input';
  }

  const number = img_id;
  const filename = `image-${number}-.png`;
  const outputfile = path.resolve(`./public/img/${filename}`);
  let image;
  if (private_msg) {
    image = await openai_private.images.generate({
      model: "dall-e-3",
      prompt, // MAX 4000 character
      n: 1,
      quality, // "standard" or "hd"
      response_format: "b64_json",
      size, // "1024x1024" or "1792x1024" or "1024x1792"
    });
  } else {
    image = await openai.images.generate({
      model: "dall-e-3",
      prompt, // MAX 4000 character
      n: 1,
      quality, // "standard" or "hd"
      response_format: "b64_json",
      size, // "1024x1024" or "1792x1024" or "1024x1792"
    });
  }
  const data = image.data[0].b64_json.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(data, 'base64');
  await fs.promises.writeFile(outputfile, buffer);
  await OpenAIAPICallLog_ig("Lennart", "dall-e-3", size, quality, image.data[0].revised_prompt || prompt, filename);

  // Convert PNG to JPEG using sharp
  const jpg_filename = `image-${number}-.jpg`;
  const jpg_outputfile = path.resolve(`./public/img/${jpg_filename}`);
  try {
    // Convert PNG buffer to JPG
    const jpgBuffer = await sharp(buffer)
      .jpeg({ quality: 70 }) // Adjust the quality as needed
      .toBuffer();
    
    // Save the JPG buffer to a file
    await fs.promises.writeFile(jpg_outputfile, jpgBuffer);
    console.log('The JPEG file has been saved successfully!');
  } catch(err) {
    // Handle errors
    console.error('An error occurred:', err);
  }

  return { filename: jpg_filename, prompt: image.data[0].revised_prompt || prompt };
  // return { filename, prompt: image.data[0].revised_prompt || prompt };
};

const localGPT = async (messages, model) => {
  try {
    const response = await local_llm.chat.completions.create({
      messages,
      model: 'lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF',//model,
    });
    return response;
  } catch (error) {
    console.error(`Error while calling LocalGPT API: ${error}`);
    return null;
  }
};

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, organization: process.env.OPENAI_ORG_ID });
const upload_file = async (file_data, private_msg=true) => {
  try {
    const filePath = path.join(__dirname, 'batch_input.jsonl');
    fs.writeFileSync(filePath, file_data);

    // Upload batch input file
    let fileUploader;
    if (private_msg) {
      fileUploader = await openai_private.files.create({
        file: fs.createReadStream(filePath),
        purpose: 'batch',
      });
    } else {
      fileUploader = await openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: 'batch',
      });
    }

    return fileUploader.id;
  } catch (error) {
    console.error(`[upload_file] Error while calling OpenAI API: ${error}`);
    return null;
  }
};

const download_file = async (file_id, private_msg=true) => {
  try {
    // Download file
    let response;
    if (private_msg) {
      response = await openai_private.files.content(file_id);
    } else {
      response = await openai.files.content(file_id);
    }
    const body = await response.text();
    const outputs = body.split('\n').filter(line => !!line.trim()).map(line => JSON.parse(line));
    
    return outputs;
  } catch (error) {
    console.error(`[download_file] Error while calling OpenAI API: ${error}`);
    return [];
  }
};

const delete_file = async (file_id, private_msg=true) => {
  try {
    let response;
    if (private_msg) {
      response = await openai_private.files.del(file_id);
    } else {
      response = await openai.files.del(file_id);
    }
    
    return response;
  } catch (error) {
    console.error(`[delete_file] Error while calling OpenAI API: ${error}`);
    return null;
  }
};

const start_batch = async (file_id, private_msg=true) => {
  try {
    let batch;
    if (private_msg) {
      batch = await openai_private.batches.create({
        input_file_id: file_id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      });
    } else {
      batch = await openai.batches.create({
        input_file_id: file_id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      });
    }
    
    return batch;
  } catch (error) {
    console.error(`[start_batch] Error while calling OpenAI API: ${error}`);
    return null;
  }
};

const batch_status = async (batch_id, private_msg=true) => {
  try {
    let batch;
    if (private_msg) {
      batch = await openai_private.batches.retrieve(batch_id);
    } else {
      batch = await openai.batches.retrieve(batch_id);
    }
    
    return batch;
  } catch (error) {
    console.error(`[batch_status] Error while calling OpenAI API: ${error}`);
    return null;
  }
};

const whisper = async (sound_path, private_msg=false) => {
  let transcription;
  if (private_msg) {
    transcription = await openai_private.audio.transcriptions.create({
      file: fs.createReadStream(sound_path),
      model: "whisper-1",
    });
  } else {
    transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(sound_path),
      model: "whisper-1",
    });
  }

  return transcription.text;
}

module.exports = {
  GetOpenAIModels,
  OpenAIAPICallLog,
  chatGPT,
  chatGPTaudio,
  chatGPT_beta,
  chatGPT_o1,
  chatGPT_Tool,
  embedding,
  GetModels,
  AddModel,
  DeleteModel,
  GetOpenAIAPICallHistory,
  tts,
  ig,
  localGPT,
  upload_file,
  download_file,
  delete_file,
  start_batch,
  batch_status,
  whisper,
};
