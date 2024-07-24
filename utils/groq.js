const Groq = require('groq-sdk');

const groq_api = new Groq({ apiKey: process.env.GROQ_API_KEY });

const groq = async (messages, model) => {
  // Adjust `messages` from OpenAI format to Groq format (*no images supported at this time)
  const system = messages[0].content[0].text;
  const groq_messages = [{
    role: "system",
    content: system,
  }];
  for (let i = 1; i < messages.length; i++) {
    const role = messages[i].role;
    for (let j = 0; j < messages[i].content.length; j++) {
      if (!(messages[i].content[j].type === 'image_url')) {
        groq_messages.push({
          role,
          content: messages[i].content[j].text,
        });
      }
    }
  }
  try {
    const completion = await groq_api.chat.completions.create({
      messages: groq_messages,
      model,
    });
    return completion;
  } catch (err) {
    console.error(`Error while calling Groq API: ${err}`);
    return null;
  }
};

module.exports = {
  groq,
};
