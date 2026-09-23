const pug = require('pug');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;

function profilesFixture() {
  const profiles = [
    { id: 'default', name: 'Default', model: '', reasoningEffort: '', codexProfile: '', sortOrder: 0, description: '', enabled: true },
    { id: 'long-profile', name: 'Synthetic profile '.repeat(4), model: 'synthetic-model-'.repeat(8), reasoningEffort: 'ultra', codexProfile: 'synthetic_cli_'.repeat(9), sortOrder: 100, description: 'Synthetic editable description <tag> & "quotes". '.repeat(10), enabled: true },
    { id: 'disabled-profile', name: 'Disabled fixture', model: '', reasoningEffort: 'medium', codexProfile: '', sortOrder: 200, description: 'Synthetic disabled profile, still editable.', enabled: false },
  ];
  const state = { profiles, config: { codexModelOptions: [{ value: profiles[1].model, label: 'Synthetic model', description: 'Fixture only' }] }, csrfToken: 'synthetic-test-token' };
  function render() {
    return pug.renderFile('views/codex/profiles.pug', {
      formAssetUrl, loggedIn: false, permissions: [], htmlPaths: [], bookmarks: [],
      codexState: state, codexStateJson: JSON.stringify(state).replace(/</g, '\\u003c'),
    });
  }
  return { profiles, state, render };
}

module.exports = { profilesFixture };
