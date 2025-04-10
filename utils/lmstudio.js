const { LMStudioClient, Chat } = require('@lmstudio/sdk');

const client = new LMStudioClient();

/*
const imageBase64 = "Your base64 string here";
const image = await client.files.prepareImageBase64(imageBase64);

const chat = Chat.empty();
chat.append("user", "What is this object?", { images: [image] });

const prediction = model.respond(chat);
*/

const chat = async (messages) => {
  // Get any loaded LLM
  const llm = await client.llm.model();
  const chat = Chat.empty();

  for (const m of messages) {
    const images = [];
    for (let i = 1; i < m.content.length; i++) {
      if (messages[i].content[j].type === 'image_url') {
        const image = await client.files.prepareImageBase64(m.content[i].image_url.url.split("data:image/jpeg;base64,")[1]);
        images.push(image);
      }
    }
    if (images.length > 0) {
      chat.append(m.role, m.content[0].text, { images });
    } else {
      chat.append(m.role, m.content[0].text);
    }
  }

  const prediction = llm.respond(chat);
  let output = "";

  for await (const { content } of prediction) {
    output += content;
  }

  return {
    "id": "chatcmpl-123",
    "object": "chat.completion",
    "created": Date.now(),
    "model": "local",
    "system_fingerprint": "fp_44709d6fcb",
    "choices": [{
      "index": 0,
      "message": {
        "role": "assistant",
        "content": output,
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

module.exports = {
  chat
};
