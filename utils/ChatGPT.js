const { Configuration, OpenAIApi } = require('openai');

// Set your OpenAI API key
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

const chatGPT = async (messages, model) => {
  try {
    const response = await openai.createChatCompletion({
      messages,
      model,
    });
    return response.data;
  } catch (error) {
    console.error(`Error while calling ChatGPT API: ${error}`);
    return null;
  }
};

module.exports = chatGPT;
