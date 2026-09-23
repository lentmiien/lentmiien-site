const pug = require('pug');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;

function workspacesFixture() {
  const workspaces = [
    { id: 'short-workspace', name: 'Synthetic workspace', rootPath: '/synthetic/project', defaultQuestionPermission: 'read-only', defaultActionPermission: 'workspace-write', defaultModel: '', defaultProfile: '', enabled: true, allowYolo: false },
    { id: 'long-workspace', name: 'Synthetic workspace '.repeat(6), rootPath: '/synthetic/' + 'long-path-segment/'.repeat(30) + '<tag> & "quotes"', defaultQuestionPermission: 'workspace-write', defaultActionPermission: 'read-only', defaultModel: 'synthetic-model-'.repeat(8), defaultProfile: 'synthetic_cli_'.repeat(9), enabled: true, allowYolo: true },
    { id: 'disabled-workspace', name: 'Disabled fixture', rootPath: 'C:\\synthetic\\' + 'long-directory\\'.repeat(25), defaultQuestionPermission: 'read-only', defaultActionPermission: 'workspace-write', defaultModel: '', defaultProfile: '', enabled: false, allowYolo: false },
  ];
  const targets = [{ id: 'synthetic-target', name: 'Synthetic target '.repeat(12), platform: 'linux' }];
  const state = { workspaces, targets, csrfToken: 'synthetic-test-token' };
  function render() {
    return pug.renderFile('views/codex/workspaces.pug', {
      formAssetUrl, loggedIn: false, permissions: [], htmlPaths: [], bookmarks: [],
      codexState: state, codexStateJson: JSON.stringify(state).replace(/</g, '\\u003c'),
    });
  }
  return { workspaces, state, render };
}

module.exports = { workspacesFixture };
