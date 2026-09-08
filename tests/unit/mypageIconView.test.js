const path = require('path');
const pug = require('pug');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
const { resolvePolicy, navigationFor, GROUPS } = require('../../services/accountSurfacePolicy');
const { effective } = require('../../services/accountPreferencesService');
async function render(role, id = '111111111111111111111111', overrides = {}) {
  const policy = await resolvePolicy({ _id: id, name: 'synthetic', type_user: role }, { findOne: async () => ({ permissions: ['accounting', 'budget', 'chat5'] }) }, '111111111111111111111111');
  return pug.renderFile(path.join(__dirname, '../../views/mypage.pug'), {
    formAssetUrl, loggedIn: true, permissions: policy.capabilities, bookmarks: [], htmlPaths: [], dashboard: effective(policy),
    accountNavigation: navigationFor(policy), navigationGroups: GROUPS, navChoices: navigationFor(policy), ...overrides,
  });
}
test('admin links migrate into searchable icon catalog with stable IDs and accessible controls', async () => {
  const html = await render('admin');
  for (const id of ['ask_lennart', 'runpod']) {
    expect(html).toContain(`data-tool-id="${id}"`);
    expect(html).toContain(`src="/i/${id}.svg"`);
  }
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('id="tools-search"');
  expect(html).not.toContain('class="mypage-grid"');
});
test('non-admin and other-admin surfaces exclude personal navigation and personalization choices', async () => {
  for (const html of [await render('user'), await render('admin', '222222222222222222222222')]) {
    expect(html).not.toContain('href="/admin/life_log"');
    expect(html).not.toContain('href="/admin/minute-logger"');
    expect(html).not.toContain('href="/accounting');
    expect(html).not.toContain('href="/budget');
    expect(html).not.toContain('data-setting-id="life"');
  }
});
test('retains action button, chat hooks, bookmarks and public destinations with escaped text', async () => {
  const html = await render('user', undefined, { chatmode: true, bookmarks: [{ url: '/blog', title: '<script>bad</script>', importance: 3 }] });
  for (const id of ['actionBtn', 'history_list', 'head_list']) expect(html).toContain(`id="${id}"`);
  for (const href of ['/blog', '/games', '/yaml-viewer', '/exchange-rates', '/bookmarks']) expect(html).toContain(`href="${href}"`);
  expect(html).not.toContain('<script>bad</script>');
});
