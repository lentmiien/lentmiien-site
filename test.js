require('dotenv').config();

const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const Step = z.object({
  explanation: z.string(),
  output: z.string(),
});

const MathReasoning = z.object({
  steps: z.array(Step),
  final_answer: z.string(),
});

async function main() {
  const completion = await openai.beta.chat.completions.parse({
    model: "gpt-4o-2024-08-06",
    messages: [
      { role: "system", content: "You are a helpful math tutor. Guide the user through the solution step by step." },
      { role: "user", content: "how can I solve cos(8x + 7) = 0.1" },
    ],
    response_format: zodResponseFormat(MathReasoning, "math_reasoning"),
  });
  
  const math_reasoning = completion.choices[0].message.parsed;
  
  console.log(math_reasoning);
}

main();
