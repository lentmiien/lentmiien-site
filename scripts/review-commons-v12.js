/* Real browser/HTTP/session/socket with synthetic source adapters; no app.js or providers. */
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreview } = require('./preview-commons');
async function run() {
  const output = path.resolve(process.env.COMMONS_SCREENSHOTS || 'documentation/commons/validation-v1.2'); await fs.mkdir(output, { recursive: true });
  const preview = await createPreview({ v12: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.COMMONS_CHROMIUM || undefined });
  const results = [], errors = [];
  const expect = (value, message) => { if (!value) throw new Error(message); results.push(message); process.stdout.write(`PASS ${message}\n`); };
  async function resident(n, viewport, mobile = false) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await context.request.post(preview.url + '/__preview/login', { data: { resident: n } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(preview.url + '/commons'); await page.waitForFunction(() => !document.getElementById('enter').disabled);
    await page.click('#enter'); await page.waitForFunction(() => document.getElementById('cover').hidden);
    const player = () => preview.room.state.players.find(p => p.userId === String(n).padStart(24, '0'));
    return { context, page, player };
  }
  async function position(r, values) { Object.assign(r.player(), values); await r.page.waitForTimeout(200); }
  async function close(r) { if (await r.page.locator('#interaction').evaluate(n => n.open)) await r.page.click('#close-dialog'); await r.page.waitForTimeout(550); }
  async function visit(r, label, touch = false) {
    const button = r.page.locator('#nearby-list button').filter({ hasText: label });
    if (touch) await button.tap(); else await button.click();
    await r.page.waitForTimeout(650);
  }
  try {
    const admin = await resident(1, { width: 1440, height: 1000 });
    const family = await resident(2, { width: 390, height: 844 }, true);
    await position(admin, { x: 30, y: 22 }); await visit(admin, 'Quest board');
    await admin.page.getByRole('heading', { name: 'Your quests' }).waitFor();
    await admin.page.screenshot({ path: path.join(output, 'desktop-quest-board.png') });
    await admin.page.getByRole('button', { name: 'Next', exact: true }).click();
    await admin.page.getByRole('button', { name: 'Report as done' }).click();
    await admin.page.waitForFunction(() => document.getElementById('private-panel').textContent.includes('1 of 1'));
    expect(preview.fixtures.records['scheduleTask/Task'].filter(t => t.userId === 'Preview 1' && t.done).length === 1, 'Quest page flip and canonical completion persist and refresh board');
    await close(admin);
    await position(admin, { scene: 'village', x: 32, y: 17.6 }); await visit(admin, 'Lantern Hall'); await close(admin);
    expect(admin.player().scene === 'hall', 'Admin enters Lantern Hall through real scene action');
    await admin.page.screenshot({ path: path.join(output, 'desktop-hall.png') });
    await position(admin, { x: 9, y: 5 }); await visit(admin, 'Site almanac');
    await admin.page.getByText('Chat5 conversations', { exact: true }).waitFor();
    await admin.page.screenshot({ path: path.join(output, 'desktop-site-almanac.png') });
    expect((await admin.page.locator('#private-panel').textContent()).includes('42 records'), 'Site almanac renders synthetic aggregate source and freshness');
    await close(admin); await position(admin, { x: 3, y: 5 }); await visit(admin, 'Village chronicle');
    expect((await admin.page.locator('#private-panel').textContent()).includes('Saving healthy'), 'Commons diagnostic bookshelf opens'); await close(admin);
    await position(admin, { x: 6, y: 8 }); await visit(admin, 'Return'); expect(admin.player().scene === 'village', 'Hall exit returns to safe public door');
    await position(family, { scene: 'village', x: 44, y: 19.6 }); await visit(family, 'The Shelter', true); await close(family);
    expect(family.player().scene === 'shelter', 'Family enters Shelter by touch');
    await family.page.screenshot({ path: path.join(output, 'portrait-shelter.png') });
    await position(family, { x: 3, y: 5 }); await visit(family, 'Water reserves', true);
    await family.page.getByText('Household reserves', { exact: true }).waitFor();
    expect((await family.page.locator('#private-panel').textContent()).includes('person-meals'), 'Shelter displays canonical person-meals separately from litres and equipment');
    await family.page.screenshot({ path: path.join(output, 'portrait-stock-panel.png') }); await close(family);
    await position(admin, { scene: 'village', x: 44, y: 19.6 }); await visit(admin, 'The Shelter');
    expect(admin.player().scene === 'village', 'Different admin cannot enter the Shelter');
    await position(family, { scene: 'village', x: 17, y: 8.2 }); await visit(family, 'Your cottage', true); await close(family);
    await position(family, { x: 8, y: 5 }); await visit(family, 'Your private diary', true);
    const editor = family.page.getByRole('textbox', { name: 'Diary text', exact: true });
    await editor.fill('<script>synthetic diary only</script> A quiet evening.');
    await family.page.getByRole('button', { name: 'Save today’s page' }).tap();
    await family.page.getByText('Saved · revision 1.', { exact: true }).waitFor();
    expect(preview.fixtures.records.diary[0].text.startsWith('<script>'), 'Diary saves plain text through real CSRF/session HTTP endpoint');
    expect(await family.page.locator('#private-panel script').count() === 0, 'Diary markup remains inert text');
    const past = '2025-01-02'; preview.fixtures.records.diary.push({ ownerId: String(2).padStart(24, '0'), date: past, text: 'Synthetic historical page', revision: 1 });
    await family.page.getByRole('button', { name: 'Browse saved dates' }).tap(); await family.page.getByRole('button', { name: past, exact: true }).tap();
    await family.page.waitForFunction(() => document.querySelector('[aria-label="Diary text"]').readOnly);
    expect(await editor.evaluate(n => n.readOnly), 'Historical diary entry is read-only');
    expect(await family.page.getByRole('button', { name: 'Save today’s page' }).isDisabled(), 'Historical diary has no enabled save action');
    await family.page.getByRole('button', { name: 'Load today', exact: true }).tap(); await family.page.waitForTimeout(200);
    await family.page.screenshot({ path: path.join(output, 'portrait-diary.png') });
    await editor.fill('Synthetic conflicting local draft');
    preview.fixtures.records.diary[0].revision++; preview.fixtures.records.diary[0].text = 'Synthetic saved by another tab';
    await family.page.getByRole('button', { name: 'Save today’s page' }).tap();
    await family.page.getByText(/Another tab saved this date/).waitFor();
    expect(await editor.inputValue() === 'Synthetic conflicting local draft', 'Revision conflict preserves editor draft');
    await family.page.getByRole('button', { name: 'Reload saved entry' }).tap();
    await family.page.getByRole('textbox', { name: 'Retained draft', exact: true }).waitFor();
    expect(await editor.inputValue() === 'Synthetic saved by another tab', 'Conflict recovery presents saved text and retained local draft separately');
    await close(family);
    await position(admin, { scene: 'home', x: 8, y: 5 }); await visit(admin, 'Your private diary');
    expect(await admin.page.getByRole('textbox', { name: 'Diary text' }).inputValue() === '', 'Admin sees only own diary, never the other account entry'); await close(admin);
    // Touch also exercises the board and Hall; fixtures change only synthetic eligibility.
    await position(family, { scene: 'village', x: 30, y: 23 }); await visit(family, 'Quest board', true);
    await family.page.getByRole('button', { name: 'Next', exact: true }).tap();
    await family.page.getByRole('button', { name: 'Report as done' }).tap();
    await family.page.waitForFunction(() => document.getElementById('private-panel').textContent.includes('1 of 1'));
    expect(preview.fixtures.records['scheduleTask/Task'].filter(t => t.userId === 'Preview 2' && t.done).length === 1, 'Touch board flip/completion stays scoped to the second account');
    await close(family);
    preview.users.get(String(2).padStart(24, '0')).type_user = 'admin';
    await position(family, { scene: 'village', x: 32, y: 17.6 }); await visit(family, 'Lantern Hall', true); await close(family);
    await position(family, { x: 9, y: 5 }); await visit(family, 'Site almanac', true);
    await family.page.getByText('Chat5 conversations', { exact: true }).waitFor();
    expect(true, 'Touch Hall shelf opens an authorized aggregate panel'); await close(family);
    preview.users.get(String(2).padStart(24, '0')).type_user = 'family';
    // The desktop matrix uses actual village camera zoom. Interiors deliberately auto-fit.
    for (const phase of ['Daylight', 'Night']) for (const zoom of ['out', 'in']) {
      await position(admin, { scene: 'village', x: 30, y: 23 });
      await admin.page.evaluate(phase => { window.originalCommonsClock ||= CommonsWorld.clock; CommonsWorld.clock = now => ({ ...window.originalCommonsClock(now), phase, darkness: phase === 'Night' ? .4 : 0 }); }, phase);
      for (let i = 0; i < 8; i++) await admin.page.click('#zoom-' + zoom);
      await admin.page.waitForTimeout(120);
      expect(await admin.page.evaluate(() => { const canvas = document.getElementById('world'); return canvas.width === Math.round(canvas.getBoundingClientRect().width * 2); }), `Desktop ${phase} zoom-${zoom} retains DPR 2`);
      await admin.page.screenshot({ path: path.join(output, `desktop-${phase.toLowerCase()}-zoom-${zoom}.png`) });
    }
    for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
      await family.page.setViewportSize(viewport);
      for (const phase of ['Daylight', 'Night']) for (const zoom of ['out', 'in']) {
        await position(family, { scene: 'shelter', x: 6, y: 7 });
        await family.page.evaluate(phase => { window.originalCommonsClock ||= CommonsWorld.clock; CommonsWorld.clock = now => ({ ...window.originalCommonsClock(now), phase, darkness: phase === 'Night' ? .4 : 0 }); }, phase);
        for (let i = 0; i < 6; i++) await family.page.click('#zoom-' + zoom);
        await family.page.waitForTimeout(120);
        expect(await family.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} ${phase} zoom-${zoom} has no horizontal overflow`);
        await family.page.screenshot({ path: path.join(output, `${label}-${phase.toLowerCase()}-zoom-${zoom}.png`) });
      }
    }
    await position(family, { x: 3, y: 5 }); await visit(family, 'Water reserves', true);
    preview.users.get(String(2).padStart(24, '0')).type_user = 'user';
    await family.page.waitForFunction(() => document.getElementById('place').textContent === 'The village square');
    expect(await family.page.locator('#private-panel').evaluate(n => n.hidden && n.textContent === ''), 'Role revocation ejects safely and purges sensitive panel');
    expect(errors.length === 0, 'No browser JavaScript errors');
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ environment: 'Headless Chromium; real HTTP/session/Socket.IO, synthetic source models and in-memory world repository; no production or provider', results, errors }, null, 2) + '\n');
  } finally { await browser.close(); await preview.stop(); }
}
run().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
