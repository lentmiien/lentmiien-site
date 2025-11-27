const { loadModelList, chat } = require('./utils/Ollama_API');

async function run() {
  console.log('Fetching available Ollama models...');
  const models = await loadModelList();

  if (!Array.isArray(models) || models.length === 0) {
    console.error('No Ollama models are available. Add at least one model before running this test.');
    process.exit(1);
  }

  const primaryModel = models[0];
  const modelName = primaryModel.name || primaryModel.model || primaryModel.modelName;

  if (!modelName) {
    console.error('Unable to determine model name from Ollama response:', primaryModel);
    process.exit(1);
  }

  console.log(`Using model: ${modelName}`);

  const mockConversation = {
    contextPrompt: 'You are a concise assistant that answers with short sentences.',
    metadata: {
      contextPrompt: 'You are a concise assistant that answers with short sentences.',
      outputFormat: 'text',
    },
  };

  const mockMessages = [
    {
      user_id: 'user',
      contentType: 'text',
      content: {
        text: 'Give me a two sentence summary of why local LLMs are interesting.',
      },
      hideFromBot: false,
    },
  ];

  const mockModelCard = {
    api_model: modelName,
    in_modalities: ['text'],
    context_type: 'system',
  };

  console.log('Sending chat request to Ollama...');
  const response = await chat(mockConversation, mockMessages, mockModelCard);
  console.log('Response received:');
  console.dir(response, { depth: 4 });
}

run().catch((error) => {
  console.error('Test run failed:', error);
  process.exit(1);
});
