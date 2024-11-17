require('dotenv').config();
const fs = require('fs');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  // Generate an audio response to the given prompt
  const response = await openai.chat.completions.create({
    model: "gpt-4o-audio-preview",
    modalities: ["text", "audio"],
    audio: { voice: "alloy", format: "wav" },
    messages: [
      {
        role: "user",
        content: "Is a golden retriever a good family dog?"
      }
    ]
  });

  // Inspect returned data
  console.log(response.choices[0]);

  // Write audio data to a file
  fs.writeFileSync(
    "dog.wav",
    Buffer.from(response.choices[0].message.audio.data, 'base64'),
    { encoding: "utf-8" }
  );
}

main();