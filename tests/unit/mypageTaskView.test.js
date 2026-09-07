const path = require('path');
const pug = require('pug');

const render = (overrides = {}) => pug.renderFile(path.join(__dirname, '../../views/mypage.pug'), {
  admin: false, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [],
  canCompleteMypageTask: true, csrfToken: 'fixture-token',
  tasks: [
    { _id: 'todo-id', type: 'todo', title: '<img src=x onerror="alert(1)">', start: new Date(Date.now() + 3600000) },
    { _id: 'tobuy-id', type: 'tobuy', title: 'Buy rice' },
    { _id: 'done-id', type: 'todo', title: 'Already done', done: true },
    { _id: 'presence-id', type: 'presence', title: 'Presence' },
  ], ...overrides,
});

test('renders escaped individual links, timing, progress and a separate section link', () => {
  const html = render();
  expect(html).toContain('data-task-id="todo-id"');
  expect(html).toContain('data-task-id="tobuy-id"');
  expect(html).not.toContain('data-task-id="done-id"');
  expect(html).not.toContain('data-task-id="presence-id"');
  expect(html).toContain('starts in');
  expect(html).toContain('mypage-task-progress__fill');
  expect(html).toContain('aria-describedby="mypage-task-hint"');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img src=x');
  const section = html.slice(html.indexOf('id="mypage-tasks"'), html.indexOf('id="mypage-task-hint"'));
  expect(section.match(/href="\/scheduleTask\/upcoming"/g)).toHaveLength(4);
  expect(section).toContain('schedule-task-pill--empty" href="/scheduleTask/upcoming" hidden');
  expect(section).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
});

test('empty task section retains the all-tasks link', () => {
  const html = render({ tasks: [] });
  expect(html).toContain('schedule-task-pill--empty" href="/scheduleTask/upcoming">Show all tasks');
});

test('without the capability, leaves navigation without advertising or loading the shortcut', () => {
  const html = render({ canCompleteMypageTask: false });
  expect(html).not.toContain('data-task-id=');
  expect(html).not.toContain('data-csrf-token=');
  expect(html).not.toContain('src="/js/mypage_tasks.js"');
  expect(html).not.toContain('Hold a task for 0.9');
  expect(html).toContain('href="/scheduleTask/upcoming"');
});
