/* Browser UI test for refinement #3 (transport UX):
   - a land unit on the coast sees a "⛴ Board <Ship>" button when a friendly
     transport with a free berth sits on adjacent water
   - clicking it boards the unit (aboard state), the panel flips to the
     ⚓ Disembark affordance
   - after sailing, ⚓ Disembark puts the unit on the far shore            */
const path = require('path');
const { spawn } = require('child_process');
const playwright = require('playwright');

const PORT = 8933;
const DIR = path.join(__dirname, '..');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
  const errors = [];
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };
  try {
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.fill('#seed', '777');
    await page.selectOption('#aicount', '2');
    await page.selectOption('#mapsize', '24');
    await page.selectOption('#difficulty', 'normal');
    await page.click('#btn-start');
    await page.waitForTimeout(400);

    // Build a deterministic strait scenario in-page.
    const scenario = await page.evaluate(() => {
      const Civ = window.Civ, S = Civ.state, p = S.civs[0];
      for (const t of S.tiles) { t.terrain = 'ocean'; t.resource = null; t.road = false; }
      for (const c of S.civs) { c.units = []; }
      for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
        if (x <= 5) S.tiles[Civ.idx(x, y)].terrain = 'grassland';   // island A
        if (x >= 9) S.tiles[Civ.idx(x, y)].terrain = 'grassland';   // island B
      }
      p.cities = []; // clear so nothing interferes
      const T = Civ.UNIT_TYPES;
      const warrior = { id: 9001, civ: p, type: 'warrior', x: 5, y: 10, hp: 100, mp: 2, moved: false };
      const ship = { id: 9002, civ: p, type: 'transport', x: 6, y: 10, hp: 100, mp: 2, moved: false };
      p.units.push(warrior, ship);
      return { warriorId: 9001, shipId: 9002, shipX: 6, shipY: 10 };
    });
    assert(true, 'scenario set up');

    const selbox = () => page.evaluate(() => {
      const html = document.getElementById('selbox').innerHTML;
      return {
        boardBtns: Array.from(document.querySelectorAll('#selbox button[data-act="board"]')).map(b => b.textContent),
        disembark: !!document.querySelector('#selbox button[data-act="disembark"]'),
        aboard: /Aboard/i.test(html),
      };
    });

    // select the coastal warrior -> Board button must appear
    const sel = await page.evaluate(() => {
      const Civ = window.Civ, S = Civ.state;
      const u = Civ.unitById(9001);
      S.selected = { kind: 'unit', id: u.id };
      S.reachable = Civ.reachable(u);
      Civ.ui.refresh();
      return true;
    });
    let st = await selbox();
    assert(st.boardBtns.length === 1, 'exactly one Board button for the adjacent transport');
    assert(/Transport Ship/.test(st.boardBtns[0]), 'button names the ship: ' + st.boardBtns[0]);
    assert(!st.disembark, 'no Disembark button while ashore');
    await page.screenshot({ path: 'test/shots/10-board-button.png' });

    // click Board -> unit is aboard
    await page.click('#selbox button[data-act="board"]');
    await page.waitForTimeout(200);
    st = await page.evaluate(() => {
      const Civ = window.Civ, u = Civ.unitById(9001);
      return { aboard: u.aboard === 9002, x: u.x, y: u.y };
    });
    assert(st.aboard, 'unit boarded the transport');
    assert(st.x === 6 && st.y === 10, 'unit now sits on the ship tile');
    let box = await selbox();
    assert(box.aboard, 'panel shows the aboard status');
    assert(box.disembark, 'Disembark button visible while aboard');
    assert(box.boardBtns.length === 0, 'no Board button while aboard');
    await page.screenshot({ path: 'test/shots/11-aboard.png' });

    // sail the ship to island B (col 8) and disembark
    const sailed = await page.evaluate(() => {
      const Civ = window.Civ;
      const ship = Civ.unitById(9002);
      const ok = Civ.moveUnit(ship, 8, 10);
      Civ.ui.refresh();
      return ok;
    });
    assert(sailed, 'ship sailed to the far shore');
    await page.click('#selbox button[data-act="disembark"]');
    await page.waitForTimeout(200);
    const landed = await page.evaluate(() => {
      const Civ = window.Civ, u = Civ.unitById(9001);
      return { aboard: u.aboard, x: u.x, y: u.y, terrain: Civ.tileAt(u.x, u.y).terrain };
    });
    assert(landed.aboard === null, 'disembarked');
    assert(landed.terrain === 'grassland', 'landed on land of island B (x=' + landed.x + ',y=' + landed.y + ')');
    await page.screenshot({ path: 'test/shots/12-disembarked.png' });

    // 64x64 colossal map sanity: a new game on Colossal starts fine
    const colossal = await page.evaluate(async () => {
      window.Civ.state = null;
      window.Civ.ui.showNewGame();
      document.getElementById('seed').value = '42';
      document.getElementById('aicount').value = '3';
      document.getElementById('mapsize').value = '64';
      window.Civ.ui.startGame();
      const S = window.Civ.state;
      return { W: S.W, H: S.H, playerCities: S.civs[0].cities.length, civs: S.civs.length };
    });
    assert(colossal.W === 64 && colossal.H === 64, 'colossal map is 64x64');
    assert(colossal.playerCities >= 1, 'player has a starting city on colossal');

    if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
    console.log('transport-ui: OK (Board button -> aboard -> sail -> Disembark; colossal 64x64 starts)');
    await browser.close();
  } finally {
    server.kill();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
