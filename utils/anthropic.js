const Anthropic = require('@anthropic-ai/sdk');

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

const anthropic = async (messages, model) => {
  const max_tokens = 8192;
  const temperature = 1;
  const system = messages[0].content[0].text;
  messages.shift();
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
    const msg = await anthropicAPI.messages.create({ model, max_tokens, temperature, system, messages });
    // Adjust response format, so function can be used in place of other API calls, without breaking the code
    msg.choices = msg.content;
    msg.choices[0].message = { content: msg.choices[0].text };
    msg.usage.total_tokens = msg.usage.input_tokens + msg.usage.output_tokens;
    return msg;
  } catch (error) {
    console.error(`Error while calling Anthropic API: ${error}`);
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
      console.error(result);
      console.error(result.result.error.error);
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
