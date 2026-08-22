const path = require('path');
const pug = require('pug');

function buildMessage(id, userId, text) {
  return {
    _id: id,
    user_id: userId,
    category: 'Chat5',
    tags: ['chat5'],
    contentType: 'text',
    content: {
      text,
      html: `<p>${text}</p>`,
      image: null,
      audio: null,
      tts: null,
      transcript: null,
      revisedPrompt: null,
      imageQuality: null,
      toolOutput: null,
    },
    timestamp: new Date('2026-08-22T00:00:00.000Z'),
    hideFromBot: false,
  };
}

describe('chat5 start message controls', () => {
  test('renders the saved setting and a selector on every raw message', () => {
    const messages = [
      buildMessage('message-1', 'Lennart', 'Older message'),
      buildMessage('message-2', 'bot', 'Selected message'),
    ];
    const html = pug.renderFile(path.join(process.cwd(), 'views', 'chat5_chat.pug'), {
      loggedIn: true,
      permissions: ['chat5'],
      htmlPaths: [],
      bookmarks: [],
      conversation: {
        _id: 'conversation-1',
        title: 'Start-message test',
        summary: '',
        category: 'Chat5',
        tags: ['chat5'],
        members: ['Lennart'],
        messages: messages.map((message) => message._id),
        metadata: {
          contextPrompt: '',
          model: 'gpt-5.6-sol',
          maxMessages: 999,
          startMessageId: 'message-2',
          maxAudioMessages: 3,
          tools: [],
          reasoning: 'high',
          mode: 'standard',
          verbosity: 'high',
          outputFormat: 'text',
        },
      },
      messages,
      chat_models: [],
      templates: [],
      personalities: [],
      responseTypes: [],
      availableTools: [],
      conversationSource: 'conversation5',
      messageWindow: {
        batchSize: 25,
        initialLimit: 25,
        total: 2,
        loadedStart: 0,
        loadedEnd: 2,
        hasMoreOlder: false,
        source: 'conversation5',
      },
      ttsVoices: { voices: [], defaultVoiceId: '' },
      trainingGroups: [],
      trainingEntries: [],
      quickSettingOptions: [],
      currentUser: 'Lennart',
      trainingStatus: {},
    });

    expect(html).toContain('id="startMessageId"');
    expect(html).toContain('value="message-2"');
    expect(html.match(/data-chat5-start-message-id=/g)).toHaveLength(2);
    expect(html).toContain('data-chat5-start-message-id="message-2"');
    expect(html).toContain('Selected start message');
    expect(html).toContain('Select start message');
  });
});
