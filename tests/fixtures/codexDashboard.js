const pug = require('pug');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;

function dashboardFixture(admin = true) {
  const workspace = { id: 'workspace-1', name: 'Lentmiien workspace', rootPath: '/workspace/project', enabled: true };
  const state = {
    config: {}, csrfToken: 'synthetic-test-token', workspaces: [workspace], requestProfiles: [], promptTemplates: [],
    runningTurns: [{ id: 'running-1', status: 'running', workspace, startedAt: '2026-09-18T10:00:00Z' }],
    queuedTurns: [{ id: 'queued-1', status: 'queued', workspace, queuedAt: '2026-09-18T10:01:00Z' }],
    recentSessions: [],
    stats: {
      period: { label: 'Jul – Sep 2026' },
      summary: { turnCount: 42, sessionCount: 37, tokens: { total: 120000 }, statusDistribution: [{ label: 'Succeeded', count: 30 }, { label: 'Failed', count: 12 }] },
      months: [7, 8, 9].map((month) => ({ key: `2026-0${month}`, label: `2026-0${month}`, turnCount: 14, sessionCount: 12, tokens: { input: 20000, cached: 5000, output: 10000, reasoning: 5000, total: 40000 } })),
      workspaceActivity: [{ workspaceName: workspace.name, rootPath: workspace.rootPath, turnCount: 42, sessionCount: 37, tokens: { total: 120000 } }],
    },
  };
  const sessions = Array.from({ length: 37 }, (_, index) => ({
    id: `session-${index + 1}`, title: index ? `Historical session ${index + 1}` : `Long title ${'x'.repeat(160)}`,
    workspace, workspaceId: workspace.id, status: index % 3 ? 'active' : 'failed',
    updatedAt: new Date(Date.UTC(2026, 8, 18 - index)).toISOString(),
    lastResponsePreview: 'A synthetic response preview; no personal data.',
  }));
  state.recentSessions = sessions.slice(0, 12);
  const html = pug.renderFile('views/codex/index.pug', {
    formAssetUrl, loggedIn: false, permissions: [], htmlPaths: [], bookmarks: [], admin,
    codexState: state, codexStateJson: JSON.stringify(state).replace(/</g, '\\u003c'),
  });
  function history(url) {
    const query = new URL(url, 'http://localhost').searchParams;
    const page = Number(query.get('page') || 1);
    const status = query.get('status') || 'recent';
    const search = (query.get('search') || '').toLowerCase();
    const matches = sessions.filter((session) => (!search || session.title.toLowerCase().includes(search)) &&
      (['recent', 'all'].includes(status) || session.status === status));
    return { ok: true, sessions: matches.slice((page - 1) * 12, page * 12), pagination: { page, total: matches.length, limit: 12, pages: Math.ceil(matches.length / 12), hasNext: page * 12 < matches.length } };
  }
  return { html, state, sessions, history };
}
module.exports = { dashboardFixture };
