const Anthropic = require('@anthropic-ai/sdk');

const anthropicAPI = new Anthropic();

const anthropic = async (messages, model, system, max_tokens=4096, temperature=1) => {
  try {
    const msg = await anthropicAPI.messages.create({ model, max_tokens, temperature, system, messages });
    console.log(msg);
    return msg;
  } catch (error) {
    console.error(`Error while calling Anthropic API: ${error}`);
    return null;
  }
};

module.exports = {
  anthropic,
};
