const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

const anthropicAPI = new Anthropic();

const model_list = [];
async function Models() {
  const list = await anthropicAPI.models.list({limit: 1000});

  for await (const model of list.data) {
    model_list.push({
      model: model.id,
      created: Math.round(((new Date(model.created_at)).getTime())/1000),
    })
  }

  model_list.sort((a,b) => {
    if (a.created > b.created) return -1;
    if (a.created < b.created) return 1;
    return 0;
  });
}
Models();

const GetAnthropicModels = () => {
  return model_list;
};

const max_per_model = {
  "claude-opus-4-20250514": 32000,
  "claude-3-5-sonnet-20241022": 8192,
  "claude-3-7-sonnet-20250219": 64000,
  "claude-sonnet-4-20250514": 64000,
  "claude-3-5-haiku-20241022": 8192,
}

const anthropic = async (messages, model) => {
  const max_tokens = max_per_model[model] ? max_per_model[model] : 32000;
  const temperature = 1;
  let system = "You are a helpful assistant";
  if (messages[0].role === "system") {
    system = messages[0].content[0].text;
    messages.shift();
  }
  // Rearrange image input in format expected by Anthropic API
  for (let i = 0; i < messages.length; i++) {
    let image_count = 0;
    for (let j = 0; j < messages[i].content.length; j++) {
      if (messages[i].content[j].type === 'image_url') {
        messages[i].content[j].type = "image";
        messages[i].content[j].source = {
          type: "base64",
          media_type: "image/jpeg",
          data: messages[i].content[j].image_url.url.split("data:image/jpeg;base64,")[1]
        };
        delete messages[i].content[j].image_url;
        image_count++;
      }
    }
    if (image_count === 1) {
      // Reverse array
      messages[i].content.reverse();
    } else if (image_count > 1) {
      // Reverse array and add message labeling of images
      messages[i].content.reverse();
      for (let j = 0; j < image_count; j++) {
        messages[i].content.splice(j*2, 0, {type: "text", text: `Image ${j+1}:`});
      }
    }
  }
  try {
    let text_response = "";

    const msg = await new Promise((resolve, reject) => {
      // Start the streaming API call
      anthropicAPI.messages.stream({
        system,
        messages,
        model,
        max_tokens,
        temperature,
      })
      .on('text', text => {
        // Collect streamed text
        text_response += text;
      })
      .on('end', () => {
        // When the stream ends, resolve the Promise with the complete response object
        const msg = {
          choices: [
            {
              message: { content: text_response }
            }
          ],
          usage: {
            total_tokens: 0
          }
        };
        resolve(msg);
      })
      .on('error', err => {
        // If an error occurs, reject the Promise
        logger.error("Stream error:", err);
        reject(err);
      });
    });

    return msg;
  } catch (error) {
    logger.error(`Error while calling Anthropic API: ${error}`);
    return null;
  }
};

const anthropic_batch_start = async (batch_array) => {
  const requests = [];
  batch_array.forEach(d => {
    requests.push({
      custom_id: d.custom_id,
      params: {
        model: d.model,
        max_tokens: d.max_tokens,
        messages: d.messages,
      }
    });
  });
  const batch = await anthropicAPI.beta.messages.batches.create({requests});

  return batch;
};

const anthropic_batch_status = async (batch_id) => {
  const batch = await anthropicAPI.beta.messages.batches.retrieve(batch_id);
  return batch;
};

const anthropic_batch_results = async (batch_id) => {
  const output = [];
  for await (const result of await anthropicAPI.beta.messages.batches.results(batch_id)) {
    if (result.result.type === 'succeeded') {
      output.push({
        custom_id: result.custom_id,
        model: result.result.message.model,
        content: result.result.message.content[0],
        usage: result.result.message.usage,
      });
    } else {
      logger.error(result);
      logger.error(result.result.error.error);
    }
  }
  return output;
};

module.exports = {
  GetAnthropicModels,
  anthropic,
  anthropic_batch_start,
  anthropic_batch_status,
  anthropic_batch_results,
};
