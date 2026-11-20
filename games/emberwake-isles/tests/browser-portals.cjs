/* Place the player on a short test pier. All crossings use keyboard and map UI. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Game } = require('../js/game');
const D = require('../js/data');
const g = new Game();
function install(x, y, z) {
  g.world.set(x, y, z, D.ids.portal);
  g.state.placed[[x, y, z].join(',')] = D.ids.portal;
}
for (let z = -2; z < 5; z++) g.world.set(0, 29, z, D.ids.stone);
install(0, 30, 0);
install(0, 34, 0);
install(1050, 30, 40);
for (let z = 38; z < 44; z++) g.world.set(1050, 29, z, D.ids.stone);
Object.assign(g.state.player, { x: .5, y: 30, z: 2.5, yaw: 0 });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(raw => localStorage.setItem('emberwake.v1.1.save', raw), JSON.stringify(g.snapshot()));
    await page.goto(process.env.ISLES_URL || 'http://127.0.0.1:8770/');
    await page.locator('#continueGame').click();
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.locator('#resume').click();
    const enter = async key => {
      await page.keyboard.down(key);
      try { await page.getByRole('heading', { name: 'Portal crossings' }).waitFor(); }
      finally { await page.keyboard.up(key); }
    };
    const pick = async (x, z) => {
      const chart = page.locator('.portal-chart'), rect = await chart.boundingBox();
      const fraction = n => (n + .5 + D.C.extent) / (2 * D.C.extent);
      await chart.click({ position: { x: fraction(x) * rect.width, y: fraction(z) * rect.height } });
    };
    await enter('KeyW');
    if (process.env.PORTAL_SCREENSHOT) await page.screenshot({ path: process.env.PORTAL_SCREENSHOT });
    await pick(1050, 40);
    await page.locator('#panel').waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => !!document.pointerLockElement));
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(800);
    await page.keyboard.up('KeyS');
    await enter('KeyW');
    await pick(0, 0);
    await page.getByRole('button', { name: 'Show all exits' }).waitFor();
    await page.getByRole('button', { name: /0, 34, 0$/ }).click();
    await page.locator('#panel').waitFor({ state: 'hidden' });
    await page.keyboard.press('KeyJ');
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await page.getByRole('button', { name: /save now|save checkpoint/i }).first().click();
    const end = await page.evaluate(() => JSON.parse(localStorage.getItem('emberwake.v1.1.save')).player);
    assert(Math.abs(end.y - 34.18) < .1 && Math.abs(end.x - .5) < .1);
    assert.deepEqual(errors, []);
    console.log('Walked onto a pad, chose a distant chart marker, used a stacked exit and verified saved arrival.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
