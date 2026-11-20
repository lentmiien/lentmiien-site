/* Browser UI test for refinement #4:
   - Technology panel display modes: HIDDEN / SELECTABLE / ALL
     (default SELECTABLE; HIDDEN shows era titles that expand per-era)
   - carrier-first selection: clicking a square whose stack contains a
     transport ship with a passenger aboard selects the SHIP, and the
     "Units here" stack list lists the carrier first                  */
const path = require('path');
const { spawn } = require('child_process');
const playwright = require('playwright');

const PORT = 8934;
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
    await page.waitForTimeout(500);

    /* ---------------- tech panel display modes ---------------- */
    const panelState = () => page.evaluate(() => {
      const box = document.getElementById('techbox');
      const modes = Array.from(box.querySelectorAll('button[data-techmode]')).map(b => ({
        mode: b.dataset.techmode, active: b.classList.contains('active'),
      }));
      return {
        modes,
        techBtns: box.querySelectorAll('button[data-tech]').length,
        eraTitles: box.querySelectorAll('button[data-era]').length,
        eraOpen: Array.from(box.querySelectorAll('button[data-era]')).filter(b => b.classList.contains('open')).length,
      };
    });

    let st = await panelState();
    assert(st.modes.length === 3, 'tech panel has 3 display modes');
    assert(st.modes.find(m => m.mode === 'selectable').active, 'default mode is SELECTABLE');
    assert(st.techBtns > 0, 'SELECTABLE mode lists currently available techs');
    assert(st.techBtns < 48, 'SELECTABLE mode is not the full tree');
    assert(st.eraTitles === 0, 'SELECTABLE mode hides era titles');
    const selectableCount = st.techBtns;
    console.log('selectable mode:', JSON.stringify(st));

    // HIDDEN mode: era titles only, no tech buttons until one is expanded
    await page.click('#techbox button[data-techmode="hidden"]');
    await page.waitForTimeout(200);
    st = await panelState();
    assert(st.modes.find(m => m.mode === 'hidden').active, 'switched to HIDDEN mode');
    assert(st.eraTitles === 4, 'HIDDEN mode shows 4 era titles');
    assert(st.techBtns === 0, 'HIDDEN mode hides all techs until an era is expanded');
    console.log('hidden mode (collapsed):', JSON.stringify(st));

    // expand the first era -> its techs appear
    await page.click('#techbox button[data-era]');
    await page.waitForTimeout(200);
    st = await panelState();
    assert(st.eraOpen === 1, 'one era expanded');
    const eraTechs = await page.evaluate(() =>
      window.Civ.TECHS.filter(t => t.era === 0).length);
    assert(st.techBtns === eraTechs, 'expanded era shows exactly its techs (' + eraTechs + ')');
    console.log('hidden mode (era 0 expanded):', JSON.stringify(st));

    // collapse again
    await page.click('#techbox button[data-era].open');
    await page.waitForTimeout(200);
    st = await panelState();
    assert(st.techBtns === 0 && st.eraOpen === 0, 'era collapses again');

    // ALL mode: the entire 48-tech tree
    await page.click('#techbox button[data-techmode="all"]');
    await page.waitForTimeout(200);
    st = await panelState();
    assert(st.modes.find(m => m.mode === 'all').active, 'switched to ALL mode');
    assert(st.techBtns === 48, 'ALL mode lists all 48 techs (got ' + st.techBtns + ')');
    assert(st.eraTitles === 0, 'ALL mode uses era labels, not era buttons');
    console.log('all mode:', JSON.stringify(st));

    // back to default for the rest of the page
    await page.click('#techbox button[data-techmode="selectable"]');
    await page.waitForTimeout(200);
    st = await panelState();
    assert(st.techBtns === selectableCount, 'SELECTABLE mode restored');

    /* ---------------- carrier-first selection ---------------- */
    // Deterministic strait scenario (same as transport-ui)
    await page.evaluate(() => {
      const Civ = window.Civ, S = Civ.state, p = S.civs[0];
      for (const t of S.tiles) { t.terrain = 'ocean'; t.resource = null; t.road = false; }
      for (const c of S.civs) { c.units = []; c.cities = []; }
      for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
        if (x <= 5) S.tiles[Civ.idx(x, y)].terrain = 'grassland';
        if (x >= 9) S.tiles[Civ.idx(x, y)].terrain = 'grassland';
      }
      const warrior = { id: 9001, civ: p, type: 'warrior', x: 5, y: 10, hp: 100, mp: 2, moved: false };
      const ship = { id: 9002, civ: p, type: 'transport', x: 6, y: 10, hp: 100, mp: 2, moved: false };
      p.units.push(warrior, ship);
      Civ.board(warrior, ship);
      Civ.ui.refresh();
    });
    await page.waitForTimeout(200);

    const posOf = (x, y) => page.evaluate(([tx, ty]) => {
      const R = window.Civ.render, s = R.baseTile * R.cam.zoom;
      const rect = document.getElementById('map').getBoundingClientRect();
      return { px: rect.left + tx * s - R.cam.x + s / 2, py: rect.top + ty * s - R.cam.y + s / 2 };
    }, [x, y]);

    const c = await posOf(6, 10);
    await page.mouse.click(c.px, c.py);
    await page.waitForTimeout(250);
    const sel = await page.evaluate(() => {
      const Civ = window.Civ, S = Civ.state;
      const u = S.selected ? Civ.unitById(S.selected.id) : null;
      const stack = Array.from(document.querySelectorAll('#selbox .stacklist button')).map(b => b.textContent);
      const html = document.getElementById('selbox').innerHTML;
      return { type: u && u.type, stack, carrying: /Carrying:/i.test(html) };
    });
    assert(sel.type === 'transport', 'clicking the stack selects the carrier ship (got ' + sel.type + ')');
    assert(sel.stack.length === 2, 'stack list shows both units');
    assert(/transport/i.test(sel.stack[0]), 'carrier is listed first in the stack list');
    assert(sel.carrying === true, 'ship panel shows it is carrying the passenger');
    console.log('carrier-first selection:', JSON.stringify(sel));

    // the passenger is still reachable via the stack list and gets the
    // Disembark affordance
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#selbox .stacklist button')).find(x => /warrior/i.test(x.textContent));
      b.click();
    });
    await page.waitForTimeout(200);
    const pax = await page.evaluate(() => {
      const u = window.Civ.unitById(window.Civ.state.selected.id);
      return { type: u.type, aboard: !!u.aboard, disembark: !!document.querySelector('#selbox button[data-act="disembark"]') };
    });
    assert(pax.type === 'warrior' && pax.aboard, 'passenger selectable from the stack list');
    assert(pax.disembark === true, 'passenger panel offers Disembark');
    console.log('passenger selected:', JSON.stringify(pax));

    assert(errors.length === 0, 'no page/console errors: ' + errors.join(' | '));
    console.log('refine4-ui: OK');
    await browser.close();
  } finally {
    server.kill();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
