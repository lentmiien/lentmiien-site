/* Local synthetic-save migration and labeled fixture checks; no personal storage. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { runProgression } = require('./progression.cjs'), { runExpansion } = require('./expansion-progression.cjs');
const out = process.env.EVIDENCE_DIR || path.join(__dirname, '../docs/validation/outer-gardens');
fs.mkdirSync(out, { recursive: true });
const legacy = fs.readFileSync(path.join(__dirname, 'fixtures/v1-save.json'), 'utf8');
const checks = [], errors = [], stats = [], requests = [];
const check = (name, value) => { assert(value, name); checks.push(name); console.log('PASS', name); };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url())); page.on('dialog', d => d.accept());
    await page.addInitScript(raw => { if (!localStorage.getItem('fixture-seeded')) { localStorage.setItem('emberwake.v1.1.save', raw); localStorage.setItem('fixture-seeded', 'yes'); } }, legacy);
    await page.route('**/js/boot.js', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__test={get game(){return game},get renderer(){return renderer},saves,openPanel,closePanel,saveNow,replaceGame};' }); });
    const ready = () => page.waitForFunction(() => {
      if (!window.__test?.renderer) return false;
      const g = __test.game, p = g.state.player, r = __test.renderer;
      return r.lastChunk === `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)},${g.state.settings.view}` && r.queue.length === 0 && g.world.dirty.size === 0 && document.getElementById('loading').hidden;
    }, {}, { timeout: 60000 });
    const shot = name => page.screenshot({ path: path.join(out, name + '.png') });
    await page.goto(process.env.ISLES_URL || 'http://127.0.0.1:8770/'); await page.locator('#welcome').waitFor({ state: 'visible' });
    await page.locator('#continueGame').click(); await page.getByRole('button', { name: 'Load', exact: true }).click(); await ready();
    check('actual Load UI migrates v1 camp, inventory, crops and chest without deleting old save', await page.evaluate(raw => {
      const s = __test.game.state, old = JSON.parse(raw);
      return s.version === 2 && JSON.stringify(s.inventory) === JSON.stringify(old.inventory) && s.crops['-207,14,100'].ready === 400 && s.harvests['chest:-209,15,100'].crystal === 8 && __test.game.world.get(0, 12, 0) === EWData.ids.marble && localStorage.getItem('emberwake.v1.1.save') === raw;
    }, legacy));
    await shot('expansion-migrated-journal');
    await page.getByRole('button', { name: 'Chart', exact: true }).click(); await shot('expansion-chart');
    check('full chart names both new islands', await page.locator('#panelContent').innerText().then(t => t.includes('Reedglass Haven') && t.includes('Honeycomb Isle')));
    await page.evaluate(() => __test.saveNow());
    check('first v2 write retains byte-identical v1 backup', await page.evaluate(raw => localStorage.getItem('emberwake.v1.1.backup') === raw, legacy));
    // Fresh normal-action run, separately from the migration fixture.
    const result = await page.evaluate(async ({ original, expansion }) => {
      await __test.replaceGame(EWGame.fresh(741092), 3);
      const controller = {}, log = [];
      const first = (0, eval)('(' + original + ')'), next = (0, eval)('(' + expansion + ')');
      first(__test.game, EWData, EWWorld, { controller, note: text => log.push(text) });
      const result = next(__test.game, EWData, EWWorld, controller);
      __test.game.paused = true;
      return { log, time: result.time, stats: result.stats, inventory: result.state.inventory, discoveries: result.state.discoveries, projects: result.state.expedition.projects, saved: __test.saveNow() };
    }, { original: runProgression.toString(), expansion: runExpansion.toString() });
    check('empty-pack browser scenario earns new resources, craft effects and restoration progress', result.inventory.jade > 0 && result.inventory.bambooStaff === 1 && result.projects.reed === 1 && result.stats.harvest >= 2 && result.saved.ok);
    fs.writeFileSync(path.join(out, 'expansion-progression.json'), JSON.stringify(result, null, 2));
    await page.reload(); await page.locator('#welcome').waitFor({ state: 'visible' }); await page.locator('#continueGame').click();
    await page.getByRole('button', { name: 'Load', exact: true }).last().click(); await ready();
    check('reload retains earned expansion edits and project progress', await page.evaluate(() => __test.game.state.expedition.projects.reed === 1 && __test.game.state.inventory.bambooShoot >= 2 && Object.values(__test.game.state.placed).includes(EWData.ids.bambooPlanter)));
    const stage = async (island, cave = false) => {
      await page.evaluate(({ island, cave }) => {
        const g = __test.game, i = EWData.islands.find(i => i.id === island);
        const c = g.world.networks.find(c => c.island === island), x = cave ? c.chamber[0] - 3 : i.x + 12, z = cave ? c.chamber[2] : i.z + 3;
        Object.assign(g.state.player, { x: x + .5, y: cave ? 5.01 : g.world.top(x, z) + .01, z: z + .5, boat: null, yaw: 0, pitch: -.1 }); g.velocity = 0;
        g.encounters.step(0); g.paused = true; __test.closePanel(false); g.paused = true;
      }, { island, cave });
      await ready(); await page.evaluate(() => { __test.renderer.frames = []; __test.renderer.intervals = []; }); await page.waitForTimeout(2400);
      stats.push({ scene: `${island}${cave ? '-cave' : ''}`, ...await page.evaluate(() => __test.renderer.stats()) });
    };
    await stage('reed'); await shot('expansion-reedglass'); await stage('reed', true); await shot('expansion-jade-cave');
    await stage('amber'); await shot('expansion-honeycomb'); await stage('amber', true); await shot('expansion-amber-cave');
    // Combat positioning fixture; defeat itself uses real pointer lock and held mouse input.
    await page.evaluate(() => {
      const g = __test.game; Object.assign(g.state.player, { x: 647.5, z: 207.5, y: g.world.top(647.5, 207.5), boat: null }); g.encounters.step(0);
      const a = g.encounters.actors[0]; Object.assign(g.state.player, { x: a.x, y: a.y, z: a.z - 2, yaw: Math.PI, pitch: Math.atan2(.5 - 1.62, 2) });
      g.state.hotbar[0] = 'log'; g.state.selected = 0; g.paused = true; __test.openPanel('Help');
    });
    await ready(); await page.locator('#resume').click(); await page.waitForTimeout(150); await shot('expansion-mite');
    check('combat view obtains real pointer lock', await page.evaluate(() => !!document.pointerLockElement));
    await page.mouse.down({ button: 'left' });
    for (let n = 0; n < 40; n++) {
      const done = await page.evaluate(() => {
        const g = __test.game, a = g.encounters.actors[0], eye = g.eye();
        g.state.player.yaw = Math.atan2(eye.x - a.x, eye.z - a.z);
        g.state.player.pitch = Math.atan2(a.y + .5 - eye.y, Math.hypot(a.x - eye.x, a.z - eye.z));
        return g.state.expedition.defeated > 0;
      });
      if (done) break;
      await page.waitForTimeout(300);
    }
    await page.mouse.up({ button: 'left' });
    check('held mouse defeats a weak mite without a weapon and yields fossil', await page.evaluate(() => __test.game.state.expedition.defeated === 1 && __test.game.state.inventory.fossil >= 1));
    await page.keyboard.press('Tab');
    // Read-only UI crafting with earned bamboo makes the owned staff visible.
    await page.evaluate(() => __test.openPanel('Craft')); await page.locator('input[type="search"]').fill('bamboo'); await shot('expansion-recipes');
    // Small player-built island fixture for visual cartography, then remove it through world edits.
    const maps = await page.evaluate(() => {
      const g = __test.game; Object.assign(g.state.player, { x: 13, y: 13, z: 10, boat: null }); g.paused = true;
      for (let x = 4; x < 12; x++) for (let z = 4; z < 12; z++) { g.world.set(x, 12, z, EWData.ids.bambooPlank); g.state.placed[`${x},12,${z}`] = EWData.ids.bambooPlank; }
      __test.openPanel('Chart'); return document.querySelector('#panelContent canvas').toDataURL();
    });
    await shot('expansion-built-island-chart'); await page.evaluate(() => { __test.closePanel(false); __test.game.paused = true; }); await ready(); await page.waitForTimeout(1000); await shot('expansion-built-island-local-map');
    const miniBefore = await page.locator('#miniMap').evaluate(c => c.toDataURL());
    const after = await page.evaluate(() => {
      const g = __test.game;
      for (let x = 4; x < 12; x++) for (let z = 4; z < 12; z++) { g.world.set(x, 12, z, 0); delete g.state.placed[`${x},12,${z}`]; }
      __test.openPanel('Chart'); return document.querySelector('#panelContent canvas').toDataURL();
    });
    check('full chart invalidates cached terrain after building and removing an ocean island', maps !== after);
    await page.evaluate(() => { __test.closePanel(false); __test.game.paused = true; }); await page.waitForTimeout(1000);
    check('live mini-map updates after the same terrain removal', miniBefore !== await page.locator('#miniMap').evaluate(c => c.toDataURL()));
    await shot('expansion-removed-island-local-map');
    await page.evaluate(() => {
      const g = __test.game;
      for (let x = 3; x <= 16; x++) for (let z = 3; z <= 16; z++) { g.world.set(x, 12, z, EWData.ids.limestoneBrick); g.state.placed[`${x},12,${z}`] = EWData.ids.limestoneBrick; }
      const designs = ['paperLamp', 'reedChair', 'teaTable', 'jadeBath', 'amberLamp', 'reedOrgan', 'amberCrown', 'bambooPlanter', 'fossilDisplay'];
      designs.forEach((id, n) => { const x = 5 + n % 3 * 3, z = 5 + Math.floor(n / 3) * 3; g.world.set(x, 13, z, EWData.ids[id]); g.state.placed[`${x},13,${z}`] = EWData.ids[id]; });
      Object.assign(g.state.player, { x: 15.5, y: 15.01, z: 17.5, yaw: .7, pitch: -.35 }); g.state.camp = { x: 10, y: 13, z: 10 }; g.paused = true;
      g.notify('VISUAL FIXTURE · all nine new furnishing designs on a limestone terrace');
    });
    await ready(); await shot('expansion-furnishings');
    check('all nine new furnishing designs contribute comfort variety', await page.evaluate(() => __test.game.luxury().varieties === 9));
    await page.evaluate(() => __test.openPanel('Saves')); await shot('expansion-save-ui');
    check('no browser exceptions', errors.length === 0);
    check('no off-device requests', requests.every(url => url.startsWith('http://127.0.0.1:8770/')));
    fs.writeFileSync(path.join(out, 'expansion-browser-results.json'), JSON.stringify({ checks, errors, stats, fixtureNotice: 'Migration uses synthetic v1 fixture. Scenic/combat/map viewpoints are seeded test positions. Progression starts empty and uses only normal actions.' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
