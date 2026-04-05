const {
  loadModelList,
  isModelAvailable,
  chatGemma4,
} = require('./utils/Ollama_API');

const PREFERRED_GEMMA4_MODELS = [
  'gemma4:31b',
  'gemma4:26b',
  'gemma4:e4b',
];

const BASE_CONTEXT_PROMPT = 'You are a concise assistant. When a tool is provided and the user explicitly tells you to use it, your first assistant turn must be a structured tool call with no natural-language prose. After the tool result arrives, answer briefly.';

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'lookup_test_value',
      description: 'Look up a fixed verification value for a given test key. Use this when the user explicitly asks for a test value.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The verification key to look up.',
          },
        },
        required: ['key'],
      },
    },
  },
];

const TEST_VALUES = {
  tool_only_case: 'tool-call-ok',
  thinking_tool_case: 'thinking-tool-ok',
};

const TOOL_HANDLERS = {
  lookup_test_value: async ({ key }) => {
    const normalizedKey = typeof key === 'string' ? key.trim() : '';
    if (!normalizedKey) {
      throw new Error('key must be a non-empty string.');
    }
    return {
      key: normalizedKey,
      value: TEST_VALUES[normalizedKey] || `unknown:${normalizedKey}`,
    };
  },
};

function pickGemma4Model() {
  const requested = typeof process.env.OLLAMA_GEMMA4_MODEL === 'string'
    ? process.env.OLLAMA_GEMMA4_MODEL.trim()
    : '';
  if (requested.length > 0) {
    return requested;
  }

  const detected = PREFERRED_GEMMA4_MODELS.find((modelName) => isModelAvailable(modelName));
  if (detected) {
    return detected;
  }

  throw new Error(`None of the preferred Gemma 4 models are available: ${PREFERRED_GEMMA4_MODELS.join(', ')}`);
}

function buildConversation() {
  return {
    contextPrompt: BASE_CONTEXT_PROMPT,
    metadata: {
      contextPrompt: BASE_CONTEXT_PROMPT,
      outputFormat: 'text',
      maxMessages: 24,
    },
  };
}

function buildMessages(prompt) {
  return [
    {
      user_id: 'user',
      contentType: 'text',
      content: {
        text: prompt,
      },
      hideFromBot: false,
    },
  ];
}

function getAssistantMessage(response) {
  if (response?.message && typeof response.message === 'object') {
    return response.message;
  }
  if (Array.isArray(response?.choices) && response.choices[0]?.message) {
    return response.choices[0].message;
  }
  return null;
}

function printCaseResult(name, response) {
  const assistantMessage = getAssistantMessage(response);
  const assistantSteps = Array.isArray(response?.tool_steps)
    ? response.tool_steps.filter((step) => step && step.type === 'assistant')
    : [];
  const requestedToolCalls = assistantSteps.flatMap((step) => (
    Array.isArray(step.tool_calls)
      ? step.tool_calls.map((toolCall) => ({
          round: step.round,
          source: step.tool_call_source || 'tool_calls',
          toolCall,
        }))
      : []
  ));
  const toolSteps = Array.isArray(response?.tool_steps)
    ? response.tool_steps.filter((step) => step && step.type === 'tool')
    : [];

  console.log(`\n=== ${name} ===`);
  console.log(`Rounds: ${response?.rounds ?? 0}`);
  console.log(`Gateway tool-role fallback used: ${response?.gateway_tool_role_fallback === true ? 'yes' : 'no'}`);
  console.log('Thinking:');
  console.log(assistantMessage?.thinking || '[none]');
  console.log('Tool calls requested by model:');
  if (requestedToolCalls.length === 0) {
    console.log('[none]');
  } else {
    console.dir(requestedToolCalls, { depth: 8 });
  }
  console.log('Tool calls executed locally:');
  if (toolSteps.length === 0) {
    console.log('[none]');
  } else {
    console.dir(toolSteps, { depth: 8 });
  }
  if (requestedToolCalls.length === 0 && assistantSteps.length > 0) {
    console.log('Assistant steps (debug):');
    console.dir(assistantSteps, { depth: 8 });
  }
  console.log('Final assistant message:');
  console.dir(assistantMessage || response, { depth: 8 });
}

async function runCase({ name, prompt, think, useTools, modelCard }) {
  const response = await chatGemma4(
    buildConversation(),
    buildMessages(prompt),
    modelCard,
    {
      think,
      tools: useTools ? TOOL_DEFINITIONS : [],
      toolHandlers: useTools ? TOOL_HANDLERS : {},
      maxToolRounds: 4,
    },
  );

  printCaseResult(name, response);
}

async function run() {
  console.log('Fetching available Ollama models...');
  await loadModelList();

  const modelName = pickGemma4Model();
  console.log(`Using Gemma 4 model: ${modelName}`);

  const modelCard = {
    api_model: modelName,
    allow_images: true,
    in_modalities: ['text', 'image'],
    context_type: 'system',
  };

  const cases = [
    {
      name: 'Baseline (No Thinking, No Tools)',
      prompt: 'Reply with exactly: baseline ok',
      think: false,
      useTools: false,
    },
    {
      name: 'Thinking Only',
      prompt: 'Think first, then answer: how many letter r are in the word "strawberry"?',
      think: true,
      useTools: false,
    },
    {
      name: 'Tool Call Only',
      prompt: 'Call the lookup_test_value tool with key "tool_only_case". Your first assistant turn must be a tool call only, with no prose. After the tool result arrives, answer with exactly the returned value.',
      think: false,
      useTools: true,
    },
    {
      name: 'Thinking And Tool Call',
      prompt: 'Think first. Then call the lookup_test_value tool with key "thinking_tool_case". Your first assistant turn must be a tool call only, with no prose. After the tool result arrives, answer with exactly the returned value.',
      think: true,
      useTools: true,
    },
  ];

  for (const testCase of cases) {
    await runCase({
      ...testCase,
      modelCard,
    });
  }
}

run().catch((error) => {
  console.error('Gemma 4 Ollama test run failed:', error);
  process.exit(1);
});
