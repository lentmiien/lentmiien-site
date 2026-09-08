// Isolated browser QA: synthetic data, loopback HTTP only, no application startup.
// Requires an independently installed Playwright; see task-planning-release.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const pug = require('pug');
const { chromium } = require(process.env.TASK_PLANNING_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const { createFormAssets } = require('../../utils/formAssets');
const { SECTIONS, resolvePolicy } = require('../../services/accountSurfacePolicy');
const { createDashboardData } = require('../../services/accountDashboardData');
const { taskDates, taskMonth, formatTaskDate } = require('../../utils/scheduleTaskDates');
const { now, tasks, matches } = require('../fixtures/taskDates');

async function main() {
  const assets = createFormAssets();
  const common = { formAssetUrl: assets.url, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [], csrfToken: 'synthetic-token',
    navigationGroups: ['Planning'], accountNavigation: [{ id: 'fixture-tool', label: 'Fixture tool', group: 'Planning', subgroup: 'Tasks', href: '/scheduleTask/calendar', src: '/i/fixture.png' }] };
  const model = () => ({ find(filter) {
    let limit;
    const chain = { select: () => chain, sort: () => chain, limit: n => { limit = n; return chain; },
      maxTimeMS: () => chain, setOptions: () => chain, lean: () => chain,
      exec: async () => tasks.filter(task => matches(task, filter)).slice(0, limit) };
    return chain;
  } });
  const policy = await resolvePolicy({ _id: '1'.repeat(24), name: 'member', type_user: 'user' },
    { findOne: async () => ({ permissions: ['scheduletask'] }) });
  const data = await createDashboardData({ model, now: () => now }).load('tasks', policy);
  const overdueTasks = []; const months = new Map();
  for (const raw of tasks) {
    const task = { ...raw, ...taskDates(raw, now) };
    if (task.status === 'Overdue') { overdueTasks.push(task); continue; }
    const { key, label } = taskMonth(task.planningDate);
    if (!months.has(key)) months.set(key, { key, label, items: [] });
    months.get(key).items.push(task);
  }
  const app = express();
  app.use('/css', express.static(path.join(root, 'public/css')));
  app.use('/js', express.static(path.join(root, 'public/js')));
  app.get('/assets/forms/:revision/:filename', assets.serve);
  app.get('/mypage/api/cards/tasks', (_req, res) => res.json({ ok: true, ...data }));
  app.get('/mypage', (_req, res) => res.send(pug.renderFile(path.join(root, 'views/mypage.pug'), { ...common,
    dashboard: { sections: SECTIONS.filter(s => s.id === 'tasks'), hiddenSections: [], collapsedSections: [], jobs: {} } })));
  app.get('/scheduleTask/upcoming', (_req, res) => res.send(pug.renderFile(path.join(root, 'views/scheduleTask/upcoming.pug'), {
    ...common, overdueTasks, taskGroups: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)), formatTaskDate,
  })));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.TASK_PLANNING_CHROMIUM || undefined });
    const errors = []; let writes = 0; let fail = false;
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true });
    await context.route('**/*', route => {
      const request = route.request(); const url = request.url();
      if (!url.startsWith(origin + '/')) {
        if (url.includes('bootstrap@5.3.3/dist/css/bootstrap.min.css') && process.env.TASK_PLANNING_BOOTSTRAP_CSS) {
          return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.TASK_PLANNING_BOOTSTRAP_CSS, 'utf8') });
        }
        return route.abort();
      }
      if (request.resourceType() === 'script' && !['account_dashboard.js', 'mypage_tasks.js', 'upcoming.js', 'nav.js'].some(file => url.endsWith('/' + file))) return route.abort();
      if (request.method() === 'PATCH') {
        writes++;
        assert.deepEqual(request.postDataJSON(), { done: true });
        if (url.includes('/mypage/')) assert.equal(request.headers()['x-csrf-token'], 'synthetic-token');
        return new Promise(resolve => setTimeout(resolve, 200)).then(() => route.fulfill({ status: fail ? 403 : 200,
          contentType: 'application/json', body: JSON.stringify({ ok: !fail, done: !fail }) }));
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const load = async () => { await page.goto(origin + '/mypage'); await page.locator('[data-task-id]').first().waitFor(); };
    const hold = async (milliseconds = 1000) => {
      const row = page.locator('[data-task-id]').first(); await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox(); await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down();
      await page.waitForTimeout(milliseconds); return row;
    };
    await load();
    assert.equal(await page.locator('.account-task-row button').count(), 0);
    assert.deepEqual(await page.locator('.account-task-group-title').allTextContents(), ['Overdue', 'Due today', 'Ongoing', 'Upcoming']);
    assert.equal(await page.locator('[data-task-id="beyond-horizon"]').count(), 0);
    await page.screenshot({ path: path.join(os.tmpdir(), 'task-planning-desktop.png'), fullPage: true });
    await page.locator('[data-task-id]').first().click();
    await page.waitForURL(origin + '/scheduleTask/upcoming'); assert.equal(writes, 0);
    assert.equal(await page.locator('.task-card').count(), tasks.length);
    assert.equal(await page.locator('.section-group[data-key="2028-02"]').count(), 1);
    assert.equal(await page.locator('.section-group[data-key="2026-09"] [data-id="past-start"]').count(), 1);
    await page.screenshot({ path: path.join(os.tmpdir(), 'task-planning-upcoming.png'), fullPage: true });
    const count = await page.locator('.task-card').count();
    await page.locator('.btn-complete').first().click();
    await page.waitForFunction(n => document.querySelectorAll('.task-card').length === n - 1, count);
    await load(); let initial = await page.locator('[data-task-id]').count();
    await hold(450); assert.equal(writes, 1);
    const progress = await page.locator('[data-task-id]').first().evaluate(el => Number(el.style.getPropertyValue('--hold-progress')));
    assert(progress > 0.3 && progress < 0.8);
    await page.waitForTimeout(750); await page.mouse.up();
    await page.waitForFunction(n => document.querySelectorAll('[data-task-id]').length === n - 1, initial);
    assert.equal(page.url(), origin + '/mypage'); assert.equal(writes, 2);
    await load(); fail = true; await hold(); await page.mouse.up();
    await page.locator('#mypage-task-status.is-error').waitFor();
    assert.equal(await page.locator('[data-task-id]').count(), initial); fail = false;
    const beforeCancel = writes;
    await hold(250); await page.mouse.move(0, 0); await page.waitForTimeout(900); await page.mouse.up();
    assert.equal(writes, beforeCancel);
    const row = page.locator('[data-task-id]').first(); await row.focus(); await page.keyboard.press('Space');
    await page.waitForFunction(n => document.querySelectorAll('[data-task-id]').length === n - 1, initial);
    assert(await page.evaluate(() => document.activeElement.hasAttribute('data-task-id')));
    await page.keyboard.press('Enter'); await page.waitForURL(origin + '/scheduleTask/upcoming');
    await page.setViewportSize({ width: 390, height: 844 }); await load();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(os.tmpdir(), 'task-planning-mobile.png'), fullPage: true });
    const cdp = await context.newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    const first = page.locator('[data-task-id]').first(); await first.scrollIntoViewIfNeeded();
    let box = await first.boundingBox(); let x = box.x + 30; let y = box.y + 20;
    const beforeTouch = writes;
    await touch('touchStart', x, y); await page.waitForTimeout(200); await touch('touchMove', x, y + 50);
    await page.waitForTimeout(1000); await touch('touchEnd'); assert.equal(writes, beforeTouch);
    await first.scrollIntoViewIfNeeded(); box = await first.boundingBox(); x = box.x + 30; y = box.y + 20;
    await touch('touchStart', x, y); await page.waitForTimeout(1200); await touch('touchEnd');
    await page.waitForFunction(n => document.querySelectorAll('[data-task-id]').length === n - 1, initial);
    assert.equal(writes, beforeTouch + 1); assert.equal(page.url(), origin + '/mypage');
    assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile dates and groups, horizon, all planning months, click/Enter navigation, 900ms progress/hold, Space/focus, failure retention, movement/touch cancellation and completion.');
    console.log('Screenshots: ' + ['desktop', 'mobile', 'upcoming'].map(name => path.join(os.tmpdir(), `task-planning-${name}.png`)).join(', '));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
