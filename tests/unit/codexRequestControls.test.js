const path = require('path');
const pug = require('pug');
const { getPromptLengthState } = require('../../public/js/codex');

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
});
