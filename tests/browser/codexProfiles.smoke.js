/* Run from the repository root with Playwright available:
 * PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/codexProfiles.smoke.js
 * Optional BOOTSTRAP_CSS points to Bootstrap 5.3.3 CSS for offline checks.
 * Only synthetic in-memory data; never imports app.js or connects to MongoDB.
 */
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { profilesFixture } = require('../fixtures/codexProfiles');
const { createFormAssets } = require('../../utils/formAssets');

async function measure(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      const { x, y, width, height, bottom, right } = node.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    const root = document.querySelector('[data-codex-page="profiles"]');
    return {
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      forms: [...root.querySelectorAll('form')].map((form) => {
        const main = form.querySelector('.codex-profile-row__main') || form;
        const style = getComputedStyle(main);
        const available = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return {
          id: form.dataset.profileForm || 'create', available, main: rect(main),
          fields: [...main.querySelectorAll('.codex-field input:not([type="checkbox"]), .codex-field select, .codex-field textarea')].map((node) => ({ name: node.name, ...rect(node) })),
          enabled: rect(form.querySelector('.codex-check')),
          checkbox: rect(form.querySelector('[name="enabled"]')),
          actions: rect(form.querySelector('.codex-profile-row__actions, .codex-actions')),
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
    assert.ok(form.buttons.every((button) => button.width >= 44 && button.height >= 44 && button.right <= result.viewport));
    if (width <= 760) {
      assert.ok(form.fields.every((field) => Math.abs(field.width - form.available) < 2), `Fields must fill the column: ${JSON.stringify(form)}`);
      assert.ok(form.enabled.y >= form.fields.at(-1).bottom);
    }
    if (width <= 1180 && form.id !== 'create') assert.ok(form.actions.y >= form.main.bottom);
    if (width === 1440 && form.id !== 'create') assert.ok(form.actions.x >= form.main.right);
  }
  return result;
}

(async () => {
  let fixture = profilesFixture();
  const requests = [];
  const app = express();
  app.use(express.json());
  app.get('/codex/profiles', (_req, res) => res.send(fixture.render()));
  app.use('/codex/api/profiles', (req, res, next) => {
    assert.equal(req.get('X-CSRF-Token'), fixture.state.csrfToken);
    requests.push({ method: req.method, body: req.body, path: req.path });
    next();
  });
  app.post('/codex/api/profiles', (req, res) => {
    fixture.profiles.push(req.body);
    res.json({ ok: true });
  });
  app.patch('/codex/api/profiles/:id', (req, res) => {
    Object.assign(fixture.profiles.find((profile) => profile.id === req.params.id), req.body);
    res.json({ ok: true });
  });
  app.delete('/codex/api/profiles/:id', (req, res) => {
    fixture.profiles.find((profile) => profile.id === req.params.id).enabled = false;
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
    const url = `http://127.0.0.1:${server.address().port}/codex/profiles`;
    for (const width of [320, 390, 768, 1440]) {
      fixture = profilesFixture();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).margin), '0px', 'Bootstrap must load');
      if (process.argv.includes('--measure-only')) {
        console.log(JSON.stringify({ width, measurements: await measure(page) }));
        continue;
      }
      const result = await checkLayout(page, width);
      const form = page.locator('[data-profile-form="long-profile"]');
      for (const name of ['name', 'model', 'codexProfile', 'description']) {
        assert.equal(await form.locator(`[name="${name}"]`).inputValue(), fixture.profiles[1][name]);
      }
      assert.match(await form.locator('[name="reasoningEffort"] option:checked').textContent(), /automatic task delegation/);
      assert.ok(await form.locator('[name="model"]').getAttribute('title'));
      // Labels focus their fields and native tab order reaches every editor/action.
      await form.getByText('Name', { exact: true }).click();
      for (const name of ['name', 'model', 'reasoningEffort', 'codexProfile', 'sortOrder', 'description', 'enabled']) {
        assert.equal(await page.evaluate(() => document.activeElement.name), name);
        await page.keyboard.press('Tab');
      }
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Save');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Disable');
      const description = `${'long-edit-'.repeat(45)} END`;
      await form.locator('[name="description"]').fill(description);
      await page.keyboard.press('End');
      assert.equal(await form.locator('[name="description"]').evaluate((node) => node.selectionStart), description.length);
      await form.locator('[name="name"]').fill('');
      const beforeInvalid = requests.length;
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      assert.equal(await form.locator('[name="name"]').evaluate((node) => node.validity.valueMissing), true);
      assert.equal(requests.length, beforeInvalid);
      await form.locator('[name="name"]').fill('Edited synthetic profile');
      await Promise.all([page.waitForEvent('load'), form.getByRole('button', { name: 'Save', exact: true }).click()]);
      assert.equal(requests.at(-1).method, 'PATCH');
      assert.equal(requests.at(-1).body.description, description);
      assert.equal(await form.locator('[name="description"]').inputValue(), description);
      await checkLayout(page, width);
      await Promise.all([page.waitForEvent('load'), form.getByRole('button', { name: 'Disable', exact: true }).click()]);
      assert.equal(requests.at(-1).method, 'DELETE');
      assert.equal(await form.locator('[name="enabled"]').isChecked(), false);
      assert.equal(await form.locator('.codex-status').textContent(), 'disabled');
      await form.locator('[name="enabled"]').check();
      await Promise.all([page.waitForEvent('load'), form.getByRole('button', { name: 'Save', exact: true }).click()]);
      assert.equal(requests.at(-1).body.enabled, true);
      const defaultForm = page.locator('[data-profile-form="default"]');
      assert.equal(await defaultForm.locator('[name="enabled"]').isDisabled(), true);
      assert.equal(await defaultForm.getByRole('button', { name: 'Disable', exact: true }).count(), 0);
      await page.locator('#profile-id').fill('new-fixture');
      await page.locator('#profile-name').fill('Created synthetic profile');
      await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Add', exact: true }).click()]);
      assert.equal(requests.at(-1).method, 'POST');
      assert.equal(await page.locator('[data-profile-form="new-fixture"]').count(), 1);
      await checkLayout(page, width); // Newly created entries follow the same reload/render path.
      await form.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/codex-profiles-${width}.png` });
      console.log(`PASS ${width}px: existing field width ${result.forms[2].fields[0].width}px; full-width phone inputs, page scrolling, labels/tab order, validation, save/disable/enable/create with reload`);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
