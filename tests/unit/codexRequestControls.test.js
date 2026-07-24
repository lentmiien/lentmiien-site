const path = require('path');
const pug = require('pug');
const {
  filterPromptTemplatesByWorkspace,
  getPromptLengthState,
} = require('../../public/js/codex');

const commonLocals = {
  pageTitle: 'Codex',
  loggedIn: false,
  permissions: [],
  htmlPaths: [],
  bookmarks: [],
  admin: false,
};

function renderCodexView(view, codexState) {
  return pug.renderFile(path.join(process.cwd(), 'views', 'codex', `${view}.pug`), {
    ...commonLocals,
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
