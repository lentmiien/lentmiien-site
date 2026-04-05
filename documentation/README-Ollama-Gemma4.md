# Ollama Gemma 4 Chat Integration

This document describes the Gemma 4-specific Ollama chat path added to the main app, how to test it, and what the AI Gateway needs to support to avoid the current compatibility fallback.

## Purpose

The existing Ollama helper in `utils/Ollama_API.js` already supported regular chat requests through the AI Gateway endpoint:

- `POST /llm/chat`

Gemma 4 adds three requirements that are now handled by a separate helper path:

1. Thinking output
2. Tool calling
3. Image input with a max of 1 image

The new Gemma-focused helper keeps the existing `chat()` function unchanged and adds a second path for Gemma 4 models.

## New Functions

Implemented in:

- `utils/Ollama_API.js`

New exports:

- `chatWithThinkingAndTools(conversation, messages, model, options = {})`
- `chatGemma4(conversation, messages, model, options = {})`

`chatGemma4()` is a convenience wrapper around `chatWithThinkingAndTools()` and forces the input image limit to 1.

## Behavior

### Thinking

Pass `think: true` in the options object to enable thinking mode for the request.

Example:

```js
const response = await chatGemma4(conversation, messages, modelCard, {
  think: true,
});
```

The returned assistant message may contain:

- `message.content`
- `message.thinking`

Some Gemma 4 responses may include thinking text even when you do not want a visible final answer yet. The current integration preserves that text in the response object for debugging and testing.

### Tool Calling

Pass:

- `tools`: array of tool definitions
- `toolHandlers`: local handlers keyed by tool name

Example:

```js
const response = await chatGemma4(conversation, messages, modelCard, {
  think: true,
  tools: [
    {
      type: 'function',
      function: {
        name: 'lookup_test_value',
        description: 'Look up a test value by key.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
          required: ['key'],
        },
      },
    },
  ],
  toolHandlers: {
    lookup_test_value: async ({ key }) => {
      return { key, value: 'example-value' };
    },
  },
});
```

The helper:

1. Sends the first request to the gateway
2. Detects tool calls
3. Executes the matching local tool handler
4. Sends a follow-up request with the tool result
5. Returns the final assistant response

### Image Input Limit

Gemma 4 models support image input, but this integration intentionally limits the request to at most 1 image.

Rule:

- If the conversation contains multiple images, only the last image is sent to the model.

This is enforced in the Gemma 4 path before the request is posted to `/llm/chat`.

### Tool-Call Recovery from Gemma 4 Output

Some Gemma 4 outputs do not return a populated `tool_calls` array, even when the model is clearly trying to call a tool.

The integration therefore supports three detection modes:

1. Native `message.tool_calls`
2. Textual tool-call blocks inside assistant content
3. Function-style calls mentioned in assistant thinking text, for example:

```text
lookup_test_value(key="tool_only_case")
```

If the tool name matches one of the allowed tool definitions, the helper converts that into an executable local tool call.

## Gateway Compatibility Fallback

### Current Issue

Your gateway currently rejects follow-up tool-result messages with:

```text
Invalid role: tool
```

That means:

1. The app successfully detected or synthesized a tool call
2. The local tool handler executed successfully
3. The second request failed because the gateway does not accept `role: "tool"`

### Current Workaround

If the gateway rejects `role: "tool"`, the helper automatically retries the same request with the tool result rewritten as a normal `role: "user"` message.

The fallback message looks like this conceptually:

```text
Tool result for lookup_test_value:

{"key":"tool_only_case","value":"tool-call-ok"}

Use this tool result to continue the conversation and answer the original request.
```

This keeps the tool loop working, but it is a compatibility layer, not the preferred transport.

The test script prints:

- `Gateway tool-role fallback used: yes`

when this retry path was required.

## What The Gateway Should Change

To avoid the fallback, the gateway should accept the native tool-calling conversation format on `/llm/chat`.

### Required Change

Allow a message with:

```json
{
  "role": "tool",
  "tool_name": "lookup_test_value",
  "content": "{\"key\":\"tool_only_case\",\"value\":\"tool-call-ok\"}"
}
```

inside the `messages` array for follow-up requests.

### Expected Tool Loop Shape

Round 1 request:

```json
{
  "model": "gemma4:31b",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Call the lookup_test_value tool..." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "lookup_test_value",
        "description": "Look up a fixed verification value for a given test key.",
        "parameters": {
          "type": "object",
          "properties": {
            "key": { "type": "string" }
          },
          "required": ["key"]
        }
      }
    }
  ],
  "stream": false,
  "think": false
}
```

Round 1 model response:

```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "type": "function",
        "function": {
          "name": "lookup_test_value",
          "arguments": {
            "key": "tool_only_case"
          }
        }
      }
    ]
  }
}
```

Round 2 request:

```json
{
  "model": "gemma4:31b",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Call the lookup_test_value tool..." },
    {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "type": "function",
          "function": {
            "name": "lookup_test_value",
            "arguments": {
              "key": "tool_only_case"
            }
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_name": "lookup_test_value",
      "content": "{\"key\":\"tool_only_case\",\"value\":\"tool-call-ok\"}"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "lookup_test_value",
        "description": "Look up a fixed verification value for a given test key.",
        "parameters": {
          "type": "object",
          "properties": {
            "key": { "type": "string" }
          },
          "required": ["key"]
        }
      }
    }
  ],
  "stream": false,
  "think": false
}
```

### Practical Gateway Requirements

The gateway should:

1. Permit `tool` as a valid message role in the request schema
2. Preserve assistant `tool_calls` in the forwarded payload
3. Forward `tool_name` and `content` for tool messages unchanged
4. Pass the payload to the Ollama backend without stripping tool-calling fields
5. Return assistant `tool_calls` back to the Node app without rewriting them away

### If The Gateway Has A Strict Role Validator

Update the validator to allow:

- `system`
- `user`
- `assistant`
- `tool`

If the gateway currently converts or normalizes messages before forwarding, that normalization must also preserve:

- `tool_calls`
- `tool_name`
- tool-result message ordering

## Test Script

Standalone test file:

- `test_ollama_gemma4.js`

NPM command:

```bash
npm run test:ollama:gemma4
```

The script runs 4 cases:

1. No thinking, no tools
2. Thinking only
3. Tool call only
4. Thinking and tool call

It prints:

- round count
- whether gateway tool-role fallback was used
- assistant thinking text
- tool calls requested by the model
- tool calls executed locally
- final assistant message

## Recommended Usage Pattern In App Code

Use:

- `chat()` for normal Ollama chat flows
- `chatGemma4()` when you want Gemma 4 thinking, tools, or image input

Suggested model card fields:

```js
const modelCard = {
  api_model: 'gemma4:31b',
  allow_images: true,
  in_modalities: ['text', 'image'],
  context_type: 'system',
};
```

Suggested call:

```js
const response = await chatGemma4(conversation, messages, modelCard, {
  think: true,
  tools,
  toolHandlers,
  maxToolRounds: 4,
});
```

## Notes

- The fallback solution is only for gateway compatibility.
- The preferred long-term fix is to make `/llm/chat` accept native tool-role follow-up messages.
- If Gemma 4 produces tool intent only in thinking text, the current helper may still recover and execute the tool call as long as the function-style text matches an allowed tool name.
