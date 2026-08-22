const path = require('path');
const pug = require('pug');

function renderTrainingGroups({ trainingGroups, trainingEntries }) {
  return pug.renderFile(path.join(process.cwd(), 'views', 'chat5_chat.pug'), {
    loggedIn: true,
    permissions: ['chat5'],
    htmlPaths: [],
    bookmarks: [],
    conversation: {
      _id: 'conversation-1',
      title: 'Training group test',
      summary: '',
      category: 'Chat5',
      tags: ['chat5'],
      members: ['Lennart'],
      messages: [],
      metadata: {
        contextPrompt: '',
        model: 'gpt-5.6-sol',
        maxMessages: 999,
        startMessageId: null,
        maxAudioMessages: 3,
        tools: [],
        reasoning: 'high',
        mode: 'standard',
        verbosity: 'high',
        outputFormat: 'text',
      },
    },
    messages: [],
    chat_models: [],
    templates: [],
    personalities: [],
    responseTypes: [],
    availableTools: [],
    conversationSource: 'conversation5',
    messageWindow: {
      batchSize: 25,
      initialLimit: 25,
      total: 0,
      loadedStart: 0,
      loadedEnd: 0,
      hasMoreOlder: false,
      source: 'conversation5',
    },
    ttsVoices: { voices: [], defaultVoiceId: '' },
    trainingGroups,
    trainingEntries,
    quickSettingOptions: [],
    currentUser: 'Lennart',
    trainingStatus: {},
  });
}

function getTrainingGroupOptions(html) {
  const select = html.match(/<select[^>]*id="trainingGroupId"[^>]*>([\s\S]*?)<\/select>/);
  return select ? select[1] : '';
}

describe('chat5 training group default', () => {
  const trainingGroups = [
    { groupId: 'alpha', stats: { entryCount: 2 } },
    { groupId: 'beta', stats: { entryCount: 3 } },
  ];

  test('selects the group from the latest conversation training entry', () => {
    const html = renderTrainingGroups({
      trainingGroups,
      trainingEntries: [
        {
          _id: 'entry-2',
          groupId: 'beta',
          promptMessageIds: [],
          outputMessageId: 'message-2',
          createdAt: new Date('2026-08-22T02:00:00.000Z'),
        },
        {
          _id: 'entry-1',
          groupId: 'alpha',
          promptMessageIds: [],
          outputMessageId: 'message-1',
          createdAt: new Date('2026-08-22T01:00:00.000Z'),
        },
      ],
    });

    const options = getTrainingGroupOptions(html);
    expect(options).toContain('<option value="beta" selected>beta (3 entries)</option>');
    expect(options).not.toContain('<option value="alpha" selected>');
  });

  test('selects the first group when the conversation has no training entries', () => {
    const html = renderTrainingGroups({ trainingGroups, trainingEntries: [] });

    const options = getTrainingGroupOptions(html);
    expect(options).toContain('<option value="alpha" selected>alpha (2 entries)</option>');
    expect(options).not.toContain('<option value="beta" selected>');
  });
});
