const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const chat = async (conversation, messages, prompt, model, beta = null) => {
  const messageArray = [];
  // Context
  if (model.context_type != "none" && conversation.context_prompt && conversation.context_prompt.length > 0) {
    messageArray.push({
      role: model.context_type,
      content: [{ type: 'text', text: conversation.context_prompt }],
    });
  }
  // Messages
  for (const message of messages) {
    messageArray.push({
      role: 'user',
      content: [{ type: 'text', text: message.prompt }],
    });
    // TODO: process images, if message has images, and the model accept image input
    messageArray.push({
      role: 'assistant',
      content: [{ type: 'text', text: message.response }],
    });
  }
  // Append prompt
  messageArray.push({
    role: 'user',
    content: [{ type: 'text', text: prompt.text }],
  });
  // TODO: process images, if prompt has images, and the model accept image input
  // Connect to API
  const inputParameters = {
    model: model.api_model,
    messages: messageArray,
  };
  //--- Audio output model parameters
  // modalities: ["text", "audio"],
  // audio: { voice: "sage", format: "mp3" },
  //--- Reasoning models
  // reasoning_effort
  //--- Tools usage
  // tools,
  // tool_choice,
  try {
    let response;
    if (beta) {
      inputParameters["response_format"] = zodResponseFormat(beta.zod.object, beta.zod.title);
      response = await openai.beta.chat.completions.parse(inputParameters);
    } else {
      response = await openai.chat.completions.create(inputParameters);
    }
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
