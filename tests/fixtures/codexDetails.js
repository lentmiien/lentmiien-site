const pug = require('pug');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
const { presentCodexTranscripts } = require('../../utils/codexTranscriptPresentation');

function detailFixture() {
  const workspace = { id: 'workspace-1', name: 'Workspace with a long repository name', rootPath: '/workspace/project' };
  const base = {
    id: 'turn-1', sequence: 1, status: 'running', kind: 'question', permissionMode: 'read-only',
    prompt: '# Request\n\nReview **this code**.\n\n```js\n' + 'const value = "long"; '.repeat(30) + '\n```',
    finalResponse: '## Result\n\nA **formatted response** with [a safe link](https://example.com).\n\n- First item\n- Second item\n\n| Metric | Value |\n| --- | --- |\n| Count | 42 |\n\n<img src="/unwanted" onerror="alert(1)">',
    queuedAt: '2026-09-19T10:00:00Z', startedAt: '2026-09-19T10:00:01Z', durationMs: 42000,
    tokenUsage: { input: 1000, cached: 400, output: 200, reasoning: 50 },
    model: 'gpt-test', modelProvider: 'openai', canAddMessage: true,
  };
  const state = {
    config: {}, csrfToken: 'synthetic-test-token', workspace,
    session: { id: 'session-1', title: 'Review the responsive session layout', lastTurnId: 'turn-1', status: 'active', codexThreadId: 'thread-1', turnCount: 2 },
    turns: [base, { ...base, id: 'turn-2', sequence: 2, status: 'failed', finalResponse: '', errorMessage: '<img src=x> A synthetic error' }],
    stats: { turnCount: 2, tokens: base.tokenUsage, totalDurationMs: 84000, elapsedMs: 90000 },
    requestProfiles: [], promptTemplates: [],
  };
  function payload(page) {
    return presentCodexTranscripts(page === 'session' ? state : { ...state, turns: undefined, turn: state.turns[0] });
  }
  function html(page) {
    const presented = payload(page);
    return pug.renderFile(`views/codex/${page}.pug`, {
      formAssetUrl, loggedIn: false, permissions: [], htmlPaths: [], bookmarks: [], admin: true,
      codexState: presented, codexStateJson: JSON.stringify(presented).replace(/</g, '\\u003c'),
    });
  }
  return { state, payload, html };
}
module.exports = { detailFixture };
