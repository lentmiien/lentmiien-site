const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const fs = require("node:fs");
const mime = require("mime-types");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 65536,
  responseModalities: [
  ],
  responseMimeType: "text/plain",
};

const googleAI = async (messages, use_model) => {
  const systemInstruction = messages.filter(m => m.role === "system")[0].content[0].text;
  const history = [];

  const model = genAI.getGenerativeModel({
    model: use_model,
    systemInstruction
  });

  for (let i = 0; i < messages.length-1; i++) {
    if (messages[i].role === "user") {
      history.push({
        role: "user",
        parts: [{text: messages[i].content[0].text}],
      });
    }
    if (messages[i].role === "assistant") {
      history.push({
        role: "model",
        parts: [{text: messages[i].content[0].text}],
      });
    }
  }

  const chatSession = model.startChat({
    generationConfig,
    history,
  });

  const result = await chatSession.sendMessage(messages[messages.length-1].content[0].text);
  // TODO: Following code needs to be updated for client-side apps.
  const candidates = result.response.candidates;
  for(let candidate_index = 0; candidate_index < candidates.length; candidate_index++) {
    for(let part_index = 0; part_index < candidates[candidate_index].content.parts.length; part_index++) {
      const part = candidates[candidate_index].content.parts[part_index];
      if(part.inlineData) {
        try {
          const filename = `output_${candidate_index}_${part_index}.${mime.extension(part.inlineData.mimeType)}`;
          fs.writeFileSync(filename, Buffer.from(part.inlineData.data, 'base64'));
          console.log(`Output written to: ${filename}`);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }
  return {
    "id": "chatcmpl-123",
    "object": "chat.completion",
    "created": Date.now(),
    "model": use_model,
    "system_fingerprint": "fp_44709d6fcb",
    "choices": [{
      "index": 0,
      "message": {
        "role": "assistant",
        "content": result.response.text(),
      },
      "logprobs": null,
      "finish_reason": "stop"
    }],
    "usage": {
      "prompt_tokens": 1,
      "completion_tokens": 1,
      "total_tokens": 1,
      "completion_tokens_details": {
        "reasoning_tokens": 0
      }
    }
  };
}

// const googleAI = async (messages, model) => {
//   const g_message_array = [];
//   const systemInstruction = messages.filter(m => m.role === "system")[0].content[0].text;
//   for (let i = 0; i < messages.length-1; i++) {
//     if (messages[i].role === "user") {
//       const index = g_message_array.length;
//       g_message_array.push({
//         role: "user",
//         parts: [],
//       });
//       for (let j = 0; j < messages[i].content.length; j++) {
//         if (messages[i].content[j].type === 'image_url') {
//           g_message_array[index].parts.push({
//             inlineData: {
//               data: messages[i].content[j].image_url.url.split("data:image/jpeg;base64,")[1],
//               mimeType: "image/jpeg"
//             },        
//           });
//         } else {
//           g_message_array[index].parts.push({
//             text: messages[i].content[j].text
//           });
//         }
//       }
//     }
//     if (messages[i].role === "assistant") {
//       const index = g_message_array.length;
//       g_message_array.push({
//         role: "model",
//         parts: [],
//       });
//       for (let j = 0; j < messages[i].content.length; j++) {
//         if (messages[i].content[j].type === 'image_url') {
//           g_message_array[index].parts.push({
//             inlineData: {
//               data: messages[i].content[j].image_url.url.split("data:image/jpeg;base64,")[1],
//               mimeType: "image/jpeg"
//             },        
//           });
//         } else {
//           g_message_array[index].parts.push({
//             text: messages[i].content[j].text
//           });
//         }
//       }
//     }
//   }
//   // Initialize the API client
//   const genAI = new GoogleGenerativeAI(apiKey);
//   // Get the specified model
//   const chat_model = genAI.getGenerativeModel({ model, systemInstruction });
//   // Configuration for the chat
//   const generationConfig = {
//     temperature: 0.9,
//     topP: 1,
//     topK: 1,
//     maxOutputTokens: 2048,
//   };
//   // Start a new chat session
//   const chat = chat_model.startChat({
//     generationConfig,
//     history: g_message_array
//   });
//   try {
//     const result = await chat.sendMessage(messages[messages.length - 1].content[0].text);
//     return {
//       "id": "chatcmpl-123",
//       "object": "chat.completion",
//       "created": Date.now(),
//       "model": model,
//       "system_fingerprint": "fp_44709d6fcb",
//       "choices": [{
//         "index": 0,
//         "message": {
//           "role": "assistant",
//           "content": result.response.text(),
//         },
//         "logprobs": null,
//         "finish_reason": "stop"
//       }],
//       "usage": {
//         "prompt_tokens": 1,
//         "completion_tokens": 1,
//         "total_tokens": 1,
//         "completion_tokens_details": {
//           "reasoning_tokens": 0
//         }
//       }
//     };
//   } catch (error) {
//     console.error(`Error while calling Google AI API: ${error}`);
//     return null;
//   }
// };

module.exports = {
  googleAI,
};
