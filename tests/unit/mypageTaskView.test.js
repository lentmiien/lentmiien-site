const pug = require('pug');
const formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
const path = require('path');
const { SECTIONS } = require('../../services/accountSurfacePolicy');
const render = () => pug.renderFile(path.join(__dirname, '../../views/mypage.pug'), { formAssetUrl, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [], csrfToken: 'fixture-token',
  dashboard: { sections: SECTIONS.filter(s => s.id === 'tasks'), hiddenSections: [], collapsedSections: [], jobs: {} } });
test('task shell has delegated hold and keyboard completion support, status and all-tasks destination', () => {
  const html = render();
  expect(html).toContain('id="mypage-tasks" data-csrf-token="fixture-token"');
  expect(html).toContain('id="mypage-task-status" role="status"');
  expect(html).toContain('Hold a task for 0.9 seconds');
  expect(html).toContain('href="/scheduleTask/upcoming"');
  expect(html).toContain(`src="${formAssetUrl('mypage_tasks.js')}"`);
  expect(html).not.toContain('data-task-id=');
});
