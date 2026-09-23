/* Run from the repository root with Playwright available:
 * PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/codexWorkspaces.smoke.js
 * Optional BOOTSTRAP_CSS points to Bootstrap 5.3.3 CSS for offline checks.
 * Optional CHROMIUM_EXECUTABLE selects an installed Chromium binary.
 * --measure-only reports dimensions without assertions for before/after comparisons.
 * Only synthetic in-memory data; never imports app.js or connects to MongoDB.
 */
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { workspacesFixture } = require('../fixtures/codexWorkspaces');
const { createFormAssets } = require('../../utils/formAssets');

async function measure(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      const { x, y, width, height, bottom, right } = node.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    const root = document.querySelector('[data-codex-page="workspaces"]');
    return {
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      forms: [...root.querySelectorAll('form')].map((form) => {
        const main = form.querySelector('.codex-workspace-row__main') || form;
        const style = getComputedStyle(main);
        const available = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return {
          id: form.dataset.workspaceForm || 'create', available, main: rect(main),
          columns: style.gridTemplateColumns.split(' ').length,
          fields: [...main.querySelectorAll('.codex-field input:not([type="checkbox"]), .codex-field select, .codex-field textarea')].map((node) => ({ name: node.name, ...rect(node) })),
          enabled: rect(form.querySelector('.codex-check')),
          checkbox: rect(form.querySelector('[name="enabled"]')),
          dangerous: rect(form.querySelector('[name="allowYolo"]').closest('label')),
          actions: rect(form.querySelector('.codex-workspace-row__actions, .codex-actions')),
          buttons: [...form.querySelectorAll('button')].map(rect),
        };
      }),
      scrollTraps: [...root.querySelectorAll('*')].filter((node) =>
        !node.matches('input, select, textarea') && /(auto|scroll|hidden)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1
      ).map((node) => node.className),
    };
  });
}

async function checkLayout(page, width) {
  const result = await measure(page);
  assert.ok(result.content <= result.viewport, `Page overflow at ${width}: ${JSON.stringify(result)}`);
  assert.deepEqual(result.scrollTraps, []);
  for (const form of result.forms) {
    assert.ok(form.fields.every((field) => field.width >= (width <= 760 ? width - 90 : 130)), `Cramped fields at ${width}: ${JSON.stringify(form)}`);
    assert.ok(form.fields.every((field) => field.right <= result.viewport && field.x >= 0));
    assert.ok(form.checkbox.width >= 18 && form.checkbox.width <= 24);
    assert.ok(form.enabled.height >= 44);
    assert.ok(form.dangerous.height >= 44);
    assert.ok(form.buttons.every((button) => button.width >= 44 && button.height >= 44 && button.right <= result.viewport));
    if (width <= 760) {
      assert.ok(form.fields.every((field) => Math.abs(field.width - form.available) < 2), `Fields must fill the column: ${JSON.stringify(form)}`);
      assert.ok(form.enabled.y >= form.fields.at(-1).bottom);
      assert.ok(form.dangerous.y >= form.enabled.bottom);
      assert.ok(form.actions.y >= form.dangerous.bottom);
      assert.ok(form.buttons.every((button) => Math.abs(button.y - form.buttons[0].y) < 1), 'Keep phone actions on one compact row');
    }
    assert.equal(form.columns, width <= 760 ? 1 : width <= 1180 ? 2 : 4);
    if (width <= 1180 && form.id !== 'create') assert.ok(form.actions.y >= form.main.bottom);
    if (width === 1440 && form.id !== 'create') assert.ok(form.actions.x >= form.main.right);
  }
  return result;
}

(async () => {
  let fixture = workspacesFixture();
  const requests = [];
  const app = express();
  app.use(express.json());
  app.get('/codex/workspaces', (_req, res) => res.send(fixture.render()));
  app.use('/codex/api/workspaces', (req, res, next) => {
    assert.equal(req.get('X-CSRF-Token'), fixture.state.csrfToken);
    requests.push({ method: req.method, body: req.body, path: req.path });
    next();
  });
  app.post('/codex/api/workspaces', (req, res) => {
    fixture.workspaces.push({ id: 'new-fixture', defaultModel: '', defaultProfile: '', ...req.body });
    res.json({ ok: true });
  });
  app.patch('/codex/api/workspaces/:id', (req, res) => {
    Object.assign(fixture.workspaces.find((workspace) => workspace.id === req.params.id), req.body);
    res.json({ ok: true });
  });
  app.delete('/codex/api/workspaces/:id', (req, res) => {
    fixture.workspaces.find((workspace) => workspace.id === req.params.id).enabled = false;
    res.json({ ok: true });
  });
  app.get('/assets/forms/:revision/:filename', createFormAssets().serve);
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  let browser;
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Keep Bootstrap's actual inherited layout; omit unrelated external scripts/editor CSS.
    await page.route(/^https:\/\//, (route) => {
      if (route.request().url().includes('bootstrap.min.css')) {
        return process.env.BOOTSTRAP_CSS ? route.fulfill({ path: process.env.BOOTSTRAP_CSS, contentType: 'text/css' }) : route.continue();
      }
      return route.fulfill({ body: '', contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript' });
    });
    const url = `http://127.0.0.1:${server.address().port}/codex/workspaces`;
    for (const width of [320, 390, 768, 1440]) {
      fixture = workspacesFixture();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).margin), '0px', 'Bootstrap must load');
      if (process.argv.includes('--measure-only')) {
        console.log(JSON.stringify({ width, measurements: await measure(page) }));
        continue;
      }
      const result = await checkLayout(page, width);
      const form = page.locator('[data-workspace-form="long-workspace"]');
      for (const name of ['name', 'rootPath', 'defaultModel', 'defaultProfile']) {
        assert.equal(await form.locator(`[name="${name}"]`).inputValue(), fixture.workspaces[1][name]);
      }
      // Labels focus their fields and native tab order reaches every editor/action.
      await form.getByText('Name', { exact: true }).click();
      for (const name of ['name', 'rootPath', 'defaultQuestionPermission', 'defaultActionPermission', 'defaultModel', 'defaultProfile', 'enabled', 'allowYolo']) {
        assert.equal(await page.evaluate(() => document.activeElement.name), name);
        assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth), '2px');
        await page.keyboard.press('Tab');
      }
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Save');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Disable');
      const rootPath = `/synthetic/${'long-edit/'.repeat(45)}END`;
      await form.locator('[name="rootPath"]').fill(rootPath);
      await page.keyboard.press('End');
      assert.equal(await form.locator('[name="rootPath"]').evaluate((node) => node.selectionStart), rootPath.length);
      await page.keyboard.press('Home');
      assert.equal(await form.locator('[name="rootPath"]').evaluate((node) => node.selectionStart), 0);
      await form.locator('[name="allowYolo"]').uncheck();
      await form.locator('[name="name"]').fill('');
      const beforeInvalid = requests.length;
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      assert.equal(await form.locator('[name="name"]').evaluate((node) => node.validity.valueMissing), true);
      assert.equal(requests.length, beforeInvalid);
      await form.locator('[name="name"]').fill('Edited synthetic workspace');
      await Promise.all([page.waitForEvent('load'), form.getByRole('button', { name: 'Save', exact: true }).click()]);
      assert.equal(requests.at(-1).method, 'PATCH');
      assert.equal(requests.at(-1).body.rootPath, rootPath);
      assert.equal(requests.at(-1).body.allowYolo, false);
      assert.equal(requests.at(-1).body.defaultQuestionPermission, 'workspace-write');
      assert.equal(requests.at(-1).body.defaultActionPermission, 'read-only');
      assert.equal(await form.locator('[name="rootPath"]').inputValue(), rootPath);
      await checkLayout(page, width);
      await Promise.all([page.waitForEvent('load'), form.getByRole('button', { name: 'Disable', exact: true }).click()]);
      assert.equal(requests.at(-1).method, 'DELETE');
      assert.equal(await form.locator('[name="enabled"]').isChecked(), false);
      assert.equal(await form.locator('.codex-status').textContent(), 'disabled');
      await form.locator('[name="enabled"]').check();
      await Promise.all([page.waitForEvent('load'), form.getByRole('button', { name: 'Save', exact: true }).click()]);
      assert.equal(requests.at(-1).body.enabled, true);
      await page.locator('#workspace-name').fill('Created synthetic workspace');
      await page.locator('#workspace-root').fill('/synthetic/new-workspace');
      await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Add', exact: true }).click()]);
      assert.equal(requests.at(-1).method, 'POST');
      assert.equal(requests.at(-1).body.targetId, 'synthetic-target');
      assert.equal(await page.locator('[data-workspace-form="new-fixture"]').count(), 1);
      await checkLayout(page, width); // Newly created entries follow the same reload/render path.
      await form.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/codex-workspaces-${width}.png` });
      console.log(`PASS ${width}px: existing field width ${result.forms[2].fields[0].width}px; full-width phone inputs, page scrolling, labels/tab order, validation, save/disable/enable/create with reload`);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
