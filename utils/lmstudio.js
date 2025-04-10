const { LMStudioClient } = require('@lmstudio/sdk');

const client = new LMStudioClient();

const chat = async (prompt) => {
  // Get any loaded LLM
  const llm = await client.llm.model();

  const prediction = llm.respond(prompt);
  let output = "";

  for await (const { content } of prediction) {
    output += content;
  }

  return output;
}

module.exports = {
  chat
};
