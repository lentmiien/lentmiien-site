/* Local browser context. Only the scenic viewpoints and rainbow showcase use fixtures. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { runProgression } = require('./progression.cjs'), { visitPoppy } = require('./spectrum-voyage.cjs');
const out = process.env.EVIDENCE_DIR || path.join(__dirname, '../docs/validation/spectrum');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(save => {
      if (!localStorage.getItem('emberwake.v1.1.save')) localStorage.setItem('emberwake.v1.1.save', JSON.stringify(save));
    }, require('./fixtures/v2-voyage.json'));
    await page.route('**/js/boot.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + '\nwindow.qa={get game(){return game},get renderer(){return renderer},replaceGame,saveNow,closePanel};' });
    });
    const load = async () => { await page.locator('#continueGame').click(); await page.getByRole('button', { name: 'Load', exact: true }).first().click(); await page.waitForFunction(() => window.qa?.game?.state.version === 3 && document.querySelector('#panel').open && document.querySelector('#loading').hidden); };
    await page.goto(process.env.ISLES_URL || 'http://127.0.0.1:8770/'); await load();
    assert(await page.evaluate(() => qa.game.state.inventory.jade === 12 && qa.game.state.expedition.projects.reed === 1));
    const progression = await page.evaluate(async ([base, extension]) => {
      await qa.replaceGame(EWGame.fresh(741092), 2);
      const controller = {}, g = qa.game;
      (0, eval)('(' + base + ')')(g, EWData, EWWorld, { controller });
      const placed = (0, eval)('(' + extension + ')')(g, EWData, EWWorld, controller);
      g.paused = true;
      return { placed, stats: g.state.stats, discoveries: g.state.discoveries, saved: qa.saveNow().ok };
    }, [runProgression.toString(), visitPoppy.toString()]);
    assert(progression.saved && progression.discoveries.includes('poppy'));
    await page.reload(); await page.locator('#continueGame').click(); await page.getByRole('button', { name: 'Load', exact: true }).last().click();
    await page.waitForFunction(() => window.qa?.game?.state.discoveries.includes('poppy') && document.querySelector('#loading').hidden);
    assert(await page.evaluate(pos => qa.game.world.get(...pos) === EWData.ids.poppyBrick, progression.placed));
    await page.getByRole('button', { name: 'Chart', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'chart.png') });
    await page.evaluate(() => { qa.closePanel(false); qa.game.paused = true; });
    const stats = [];
    for (const region of ['poppy', 'sundial', 'fern', 'iris', 'rainbow']) {
      await page.evaluate(region => {
        const g = qa.game, p = g.state.player, i = EWData.islands.find(i => i.id === region);
        g.paused = true;
        if (i) {
          const x = i.x + 10, z = i.z + 10;
          Object.assign(p, { x: x + .5, z: z + .5, y: g.world.top(x,z) + 5, yaw: -.08, pitch: -.37 });
          g.encounters.step(0);
        } else {
          const shades = ['poppyStone1','poppyStone2','sundialStone1','fernStone1','irisStone0','irisStone1','irisStone2'];
          for (let x = -13; x <= 13; x++) for (let y = 0; y <= 13; y++) {
            const band = 13 - Math.round(Math.hypot(x, y));
            if (band >= 0 && band < shades.length) g.world.set(x, EWData.C.sea + y, 0, EWData.ids[shades[band]]);
          }
          Object.assign(p, { x: 5, y: 15.5, z: 25, yaw: .19, pitch: .08 });
          g.encounters.step(0);
        }
      }, region);
      await page.waitForFunction(() => {
        const g = qa.game, r = qa.renderer, p = g.state.player;
        return r.lastChunk === [Math.floor(p.x / 16),Math.floor(p.z / 16),g.state.settings.view].join(',') && !r.queue.length && !g.world.dirty.size;
      }, {}, { timeout: 60000 });
      await page.screenshot({ path: path.join(out, region + '.png') });
      stats.push({ region, ...await page.evaluate(() => qa.renderer.stats()) });
      if (region !== 'rainbow') {
        const species = await page.evaluate(() => {
          const g = qa.game, p = g.state.player;
          const a = g.encounters.actors.find(actor => actor.alive);
          Object.assign(p, { x: a.x, y: a.y, z: a.z - 2, yaw: Math.PI, pitch: Math.atan2(.5 - 1.62, 2) });
          return a.species.name;
        });
        await page.waitForFunction(name => document.querySelector('#targetLabel').textContent.startsWith(name), species);
        await page.screenshot({ path: path.join(out, region + '-creature.png'), clip: { x: 390, y: 190, width: 500, height: 430 } });
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ progression, errors, stats }, null, 2) + '\n');
    console.log('Migrated v2, earned and reloaded sculpture brick, inspected chart and five WebGL scenes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
