const path = require('path');
const pug = require('pug');
const {
  filterPromptTemplatesByWorkspace,
  getPromptLengthState,
  selectErrorProcessEvents,
  selectFocusedProcessEvents,
  summarizeEditedFiles,
} = require('../../public/js/codex');

const commonLocals = {
  pageTitle: 'Codex',
  loggedIn: false,
  permissions: [],
  htmlPaths: [],
  bookmarks: [],
  admin: false,
};

function renderCodexView(view, codexState, locals = {}) {
  return pug.renderFile(path.join(process.cwd(), 'views', 'codex', `${view}.pug`), {
    ...commonLocals,
    ...locals,
    codexState,
    codexStateJson: JSON.stringify(codexState),
  });
}

describe('Codex request prompt controls', () => {
  test('reports the configured prompt boundary and over-limit state', () => {
    const atLimit = getPromptLengthState('x'.repeat(20000), 20000);
    const overLimit = getPromptLengthState('x'.repeat(20001), 20000);

    expect(atLimit).toEqual({
      count: 20000,
      maximum: 20000,
      overLimit: false,
      label: `${(20000).toLocaleString()} / ${(20000).toLocaleString()} characters`,
    });
    expect(overLimit).toEqual({
      count: 20001,
      maximum: 20000,
      overLimit: true,
      label: `${(20001).toLocaleString()} / ${(20000).toLocaleString()} characters`,
    });
  });

  test('renders the dashboard counter and reversible maximize control', () => {
    const state = {
      config: { maxPromptChars: 12345 },
      workspaces: [{ id: 'workspace-1', name: 'Workspace', rootPath: '/workspace' }],
      runningTurns: [],
      queuedTurns: [],
      recentSessions: [],
      requestProfiles: [],
      promptTemplates: [],
      stats: {},
      pricing: {},
    };

    const html = renderCodexView('index', state);

    expect(html).toContain('id="codex-new-request-panel"');
    expect(html).toContain('id="codex-new-request-maximize"');
    expect(html).toContain('data-codex-maximize-request');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('id="codex-prompt"');
    expect(html).toContain('maxlength="12345"');
    expect(html).toContain('data-max-characters="12345"');
    expect(html).toContain('id="codex-prompt-character-count"');
    expect(html).toContain(`0 / ${(12345).toLocaleString()} characters`);
    expect(html).toContain('data-codex-prompt-submit');
  });

  test('renders an explicit Ollama provider and configured local-model choices', () => {
    const state = {
      config: {
        maxPromptChars: 20000,
        localModelOptions: [
          { value: 'qwen3.6:27b', label: 'Qwen 3.6 27B', description: 'Local model.' },
          { value: 'llama4:scout', label: 'Llama 4 Scout', description: 'Second local model.' },
        ],
      },
      workspaces: [{ id: 'workspace-1', name: 'Workspace', rootPath: '/workspace' }],
      runningTurns: [],
      queuedTurns: [],
      recentSessions: [],
      requestProfiles: [{ id: 'default', name: 'Default' }],
      promptTemplates: [],
      stats: {},
      pricing: {},
    };

    const html = renderCodexView('index', state);

    expect(html).toContain('id="codex-model-provider"');
    expect(html).toContain('name="modelProvider"');
    expect(html).toContain('<option value="ollama">Ollama (local)</option>');
    expect(html).toContain('id="codex-local-model"');
    expect(html).toContain('value="qwen3.6:27b"');
    expect(html).toContain('value="llama4:scout"');
  });

  test('renders independent OpenAI and Ollama pricing forms for admins', () => {
    const state = {
      config: { maxPromptChars: 20000, localModelOptions: [{ value: 'qwen3.6:27b', label: 'Qwen' }] },
      workspaces: [{ id: 'workspace-1', name: 'Workspace', rootPath: '/workspace' }],
      runningTurns: [],
      queuedTurns: [],
      recentSessions: [],
      requestProfiles: [],
      promptTemplates: [],
      stats: {},
      pricingByProvider: {
        openai: { prices: { input: 1, cached: 2, output: 3, reasoning: 4 } },
        ollama: { prices: { input: 5, cached: 6, output: 7, reasoning: 8 } },
      },
    };

    const html = renderCodexView('index', state, { admin: true });

    expect(html).toContain('data-provider="openai"');
    expect(html).toContain('data-provider="ollama"');
    expect(html).toContain('id="codex-price-openai-input"');
    expect(html).toContain('id="codex-price-ollama-input"');
    expect(html).toContain('Save OpenAI Prices');
    expect(html).toContain('Save Ollama Prices');
  });

  test('shows only global and selected-workspace templates for a new request', () => {
    const state = {
      config: { maxPromptChars: 20000 },
      workspaces: [
        { id: 'workspace-1', name: 'First', rootPath: '/first' },
        { id: 'workspace-2', name: 'Second', rootPath: '/second' },
      ],
      runningTurns: [],
      queuedTurns: [],
      recentSessions: [],
      requestProfiles: [],
      promptTemplates: [
        { id: 'global', name: 'Global template', prompt: 'Global prompt', workspaceId: '' },
        { id: 'first', name: 'First template', prompt: 'First prompt', workspaceId: 'workspace-1' },
        { id: 'second', name: 'Second template', prompt: 'Second prompt', workspaceId: 'workspace-2' },
      ],
      stats: {},
      pricing: {},
    };

    const html = renderCodexView('index', state);
    const templateSelect = html.match(/<select id="codex-prompt-template"[\s\S]*?<\/select>/)?.[0] || '';

    expect(templateSelect).toContain('Global template');
    expect(templateSelect).toContain('First template');
    expect(templateSelect).not.toContain('Second template');
  });

  test('filters templates whenever the selected workspace changes', () => {
    const templates = [
      { id: 'legacy', name: 'Legacy global' },
      { id: 'global', name: 'Global', workspaceId: '' },
      { id: 'first', name: 'First', workspaceId: 'workspace-1' },
      { id: 'second', name: 'Second', workspaceId: 'workspace-2' },
    ];

    expect(filterPromptTemplatesByWorkspace(templates, 'workspace-2').map((template) => template.id))
      .toEqual(['legacy', 'global', 'second']);
    expect(filterPromptTemplatesByWorkspace(templates, '').map((template) => template.id))
      .toEqual(['legacy', 'global']);
  });

  test('renders the same configured counter for follow-up requests', () => {
    const state = {
      config: { maxPromptChars: 20000 },
      session: {
        id: 'session-1',
        title: 'Session',
        status: 'active',
        codexThreadId: 'thread-1',
      },
      workspace: { name: 'Workspace' },
      turns: [],
      requestProfiles: [],
      promptTemplates: [],
      stats: {},
    };

    const html = renderCodexView('session', state);

    expect(html).toContain('id="codex-followup-prompt"');
    expect(html).toContain('maxlength="20000"');
    expect(html).toContain('data-max-characters="20000"');
    expect(html).toContain('id="codex-followup-character-count"');
    expect(html).toContain(`0 / ${(20000).toLocaleString()} characters`);
    expect(html).toContain('data-codex-prompt-submit');
  });

  test('locks an Ollama follow-up to its local provider and selected model', () => {
    const state = {
      config: {
        maxPromptChars: 20000,
        localModelOptions: [
          { value: 'qwen3.6:27b', label: 'Qwen 3.6 27B', description: 'Local model.' },
        ],
      },
      session: {
        id: 'session-local',
        title: 'Local session',
        status: 'active',
        codexThreadId: 'thread-local',
        modelProvider: 'ollama',
        model: 'qwen3.6:27b',
      },
      workspace: { name: 'Workspace' },
      turns: [{
        id: 'turn-local',
        sequence: 1,
        kind: 'question',
        status: 'succeeded',
        modelProvider: 'ollama',
        model: 'qwen3.6:27b',
      }],
      requestProfiles: [{ id: 'default', name: 'Default' }],
      promptTemplates: [],
      stats: {},
    };

    const html = renderCodexView('session', state);

    expect(html).toContain('name="modelProvider" value="ollama"');
    expect(html).toContain('id="codex-followup-local-model"');
    expect(html).toContain('value="qwen3.6:27b" selected');
    expect(html).not.toContain('id="codex-followup-profile"');
  });

  test('renders workspace choices when managing prompt templates', () => {
    const state = {
      config: { maxPromptChars: 20000 },
      workspaces: [
        { id: 'workspace-1', name: 'First', rootPath: '/first', enabled: true },
        { id: 'workspace-2', name: 'Second', rootPath: '/second', enabled: false },
      ],
      templates: [
        {
          id: 'template-1',
          name: 'Scoped template',
          description: '',
          prompt: 'Scoped prompt',
          workspaceId: 'workspace-2',
        },
      ],
    };

    const html = renderCodexView('templates', state);

    expect(html).toContain('id="template-workspace"');
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('All workspaces');
    expect(html).toContain('Second - /second (disabled)');
    expect(html).toContain('value="workspace-2" selected');
  });
});

describe('Codex focused process details', () => {
  test('includes reasoning and keeps only the latest todo list at the bottom', () => {
    const events = [
      { seq: 1, payload: { item: { type: 'todo_list', items: [{ text: 'Old' }] } } },
      { seq: 2, payload: { item: { type: 'reasoning', text: 'Thinking' } } },
      { seq: 3, payload: { item: { type: 'command_execution' } } },
      { seq: 4, payload: { item: { type: 'todo_list', items: [{ text: 'Current' }] } } },
      { seq: 5, payload: { item: { type: 'agent_message', text: 'Done' } } },
    ];

    expect(selectFocusedProcessEvents(events).map((event) => event.seq)).toEqual([2, 5, 4]);
  });

  test('recognizes focused event types from server presentation data', () => {
    const reasoning = {
      seq: 8,
      presentation: { itemType: 'reasoning', html: '<p>Thinking</p>' },
      payload: {},
    };

    expect(selectFocusedProcessEvents([reasoning])).toEqual([reasoning]);
    expect(selectFocusedProcessEvents(null)).toEqual([]);
  });

  test('combines file-change kinds by path and ignores unrelated event items', () => {
    const events = [
      {
        seq: 1,
        payload: {
          item: {
            type: 'file_change',
            changes: [
              { path: '/workspace/models/item.js', kind: 'add' },
              { path: '/workspace/app.js', kind: 'update' },
            ],
          },
        },
      },
      {
        seq: 2,
        presentation: {
          itemType: 'file_change',
          changes: [
            { path: '/workspace/app.js', kind: 'update' },
            { path: '/workspace/app.js', kind: 'rename' },
          ],
        },
        payload: {},
      },
      { seq: 3, payload: { item: { type: 'command_execution', path: '/workspace/ignored.js' } } },
    ];

    expect(summarizeEditedFiles(events)).toEqual([
      { path: '/workspace/app.js', kinds: ['update', 'rename'] },
      { path: '/workspace/models/item.js', kinds: ['add'] },
    ]);
    expect(summarizeEditedFiles(null)).toEqual([]);
  });

  test('selects structured error output without scanning ordinary event text', () => {
    const events = [
      {
        seq: 1,
        eventType: 'stderr.line',
        stream: 'stderr',
        severity: 'warning',
        text: 'Warning: no last agent message',
      },
      {
        seq: 2,
        eventType: 'turn.failed',
        stream: 'system',
        severity: 'error',
        text: 'Turn failed',
      },
      {
        seq: 3,
        eventType: 'item.failed',
        stream: 'stdout-json',
        severity: 'info',
        payload: {},
      },
      {
        seq: 4,
        eventType: 'item.completed',
        stream: 'stdout-json',
        severity: 'info',
        payload: { item: { type: 'command_execution', status: 'rejected' } },
      },
      {
        seq: 5,
        eventType: 'stdout.line',
        stream: 'stdout',
        severity: 'info',
        text: 'const error = buildExpectedResult();',
      },
      {
        seq: 6,
        eventType: 'item.completed',
        stream: 'stdout-json',
        severity: 'info',
        payload: {
          item: {
            type: 'file_change',
            status: 'completed',
            changes: [{ path: '/workspace/error-handler.js', kind: 'update' }],
          },
        },
      },
      {
        seq: 7,
        eventType: 'events.truncated',
        stream: 'system',
        severity: 'warning',
        text: 'Event storage warning',
      },
    ];

    expect(selectErrorProcessEvents(events).map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(selectErrorProcessEvents(null)).toEqual([]);
  });

  test('renders the focused and Errors process-detail mode controls', () => {
    const html = renderCodexView('turn', {
      turn: {
        id: 'turn-1',
        sequence: 1,
        status: 'succeeded',
        prompt: 'Update the app',
        tokenUsage: {},
        costEstimate: {},
      },
      session: { id: 'session-1', title: 'Session' },
      workspace: { id: 'workspace-1', name: 'Workspace' },
    });

    expect(html).toContain('data-event-view-mode="focused" aria-pressed="true"');
    expect(html).toContain('Agent messages, reasoning & todos');
    expect(html).toContain('data-event-view-mode="errors" aria-pressed="false"');
    expect(html).toContain('>Errors</button>');
  });
});
