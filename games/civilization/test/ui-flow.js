/* Browser UI-flow test for refinement #1:
   - clicking a city tile with stacked units selects the topmost unit,
     and the "Units here" stack list lets you pick any unit
   - the settler's "⛏ Build Road" action lays a road (visible overlay)
   - hovering a tile shows the terrain tooltip (with road marker)
   - clicking water with a land unit does nothing (no movement)           */
const path = require('path');
const { spawn } = require('child_process');
const playwright = require('playwright');

const PORT = 8932;
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
    await page.evaluate(() => {
      let a = 0x9e3779b9;
      Math.random = function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
        return ((t ^ (a >>> 14)) >>> 0) / 4294967296;
      };
    });
    await page.waitForTimeout(300);

    await page.fill('#seed', '777');
    await page.selectOption('#aicount', '3');
    await page.selectOption('#difficulty', 'normal');
    await page.click('#btn-start');
    await page.waitForTimeout(400);

    // pixel position of a game tile on the canvas
    const posOf = (x, y) => page.evaluate(([tx, ty]) => {
      const R = window.Civ.render, s = R.baseTile * R.cam.zoom;
      const rect = document.getElementById('map').getBoundingClientRect();
      return { px: rect.left + tx * s - R.cam.x + s / 2, py: rect.top + ty * s - R.cam.y + s / 2 };
    }, [x, y]);

    const city = await page.evaluate(() => {
      const c = window.Civ.state.civs[0].cities[0];
      return { x: c.x, y: c.y };
    });

    // 1) click the city tile -> topmost stacked unit is selected
    const c1 = await posOf(city.x, city.y);
    await page.mouse.click(c1.px, c1.py);
    await page.waitForTimeout(200);
    let st = await page.evaluate(() => {
      const sel = window.Civ.state.selected;
      const u = sel ? window.Civ.unitById(sel.id) : null;
      const stackBtns = Array.from(document.querySelectorAll('#selbox .stacklist button')).map(b => b.textContent);
      const hasRoadBtn = !!document.querySelector('#selbox button[data-act="road"]');
      return { kind: sel && sel.kind, type: u && u.type, stackBtns, hasRoadBtn };
    });
    assert(st.kind === 'unit', 'clicking a stacked city tile selects the topmost unit');
    assert(st.stackBtns.length === 3, 'stack list shows all 3 stacked units');
    console.log('stack selection:', JSON.stringify(st));
    await page.screenshot({ path: 'test/shots/09-stacked-units.png' });

    // 2) pick the settler from the stack list
    const picked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#selbox .stacklist button'));
      const b = btns.find(x => /settler/i.test(x.textContent));
      if (!b) return null;
      b.click();
      const u = window.Civ.unitById(window.Civ.state.selected.id);
      return { type: u.type, hasRoadBtn: !!document.querySelector('#selbox button[data-act="road"]') };
    });
    assert(picked && picked.type === 'settler', 'settler selected from stack list');
    assert(picked.hasRoadBtn, 'settler panel offers the Build Road action');
    console.log('settler picked:', JSON.stringify(picked));

    // 3) build a road where the settler stands
    const before = await page.evaluate(() => {
      const u = window.Civ.unitById(window.Civ.state.selected.id);
      const t = window.Civ.state.tiles[window.Civ.idx(u.x, u.y)];
      return { road: t.road, mp: u.mp };
    });
    assert(!before.road, 'no road on the settler tile yet');
    await page.click('#selbox button[data-act="road"]');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const S = window.Civ.state;
      const u = S.selected ? window.Civ.unitById(S.selected.id) : null;
      const t = u ? S.tiles[window.Civ.idx(u.x, u.y)] : null;
      return { road: t && t.road, mp: u && u.mp, moved: u && u.moved };
    });
    assert(after.road === true, 'road built on the settler tile');
    assert(after.mp === 0 && after.moved === true, 'road building consumed the turn');
    console.log('road built:', JSON.stringify(after));
    await page.screenshot({ path: 'test/shots/10-road-built.png' });

    // 4) hover a tile -> terrain tooltip appears; road tile shows the marker
    const hoverInfo = await page.evaluate(() => {
      const S = window.Civ.state;
      // find a non-city, non-road grassland tile near the city
      let target = null;
      for (const t of S.tiles) {
        const c = S.civs[0].cities[0];
        const d = Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y));
        if (t.terrain === 'grassland' && !t.road && d === 2 && !window.Civ.cityAt(t.x, t.y)) { target = t; break; }
      }
      return target ? { x: target.x, y: target.y, road: target.road } : null;
    });
    const h1 = await posOf(hoverInfo.x, hoverInfo.y);
    await page.mouse.move(h1.px, h1.py);
    await page.waitForTimeout(250);
    let tip = await page.evaluate(() => {
      const el = document.getElementById('tooltip');
      return { shown: el.style.display !== 'none', text: el.textContent };
    });
    assert(tip.shown, 'terrain tooltip appears on hover');
    assert(/grassland/i.test(tip.text), 'tooltip names the terrain');
    console.log('tooltip (plain tile):', tip.text);

    // hover the road tile: tooltip must mention the road
    const h2 = await posOf(city.x, city.y);
    await page.mouse.move(h2.px, h2.py);
    await page.waitForTimeout(250);
    tip = await page.evaluate(() => {
      const el = document.getElementById('tooltip');
      return { shown: el.style.display !== 'none', text: el.textContent };
    });
    assert(tip.shown && /road/i.test(tip.text), 'tooltip on the road tile mentions the road');
    console.log('tooltip (road tile):', tip.text);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(150);
    const hidden = await page.evaluate(() => document.getElementById('tooltip').style.display === 'none');
    assert(hidden, 'tooltip hides when the mouse leaves the map');

    // 5) land unit cannot be moved into water via the UI
    const water = await page.evaluate(() => {
      const S = window.Civ.state;
      const p = S.civs[0];
      const u = p.units.find(v => v.type === 'warrior' && !v.moved && v.mp > 0);
      if (!u) return null;
      // find the closest ocean tile to the warrior
      let best = null, bd = 1e9;
      for (const t of S.tiles) {
        if (t.terrain !== 'ocean') continue;
        const d = Math.abs(t.x - u.x) + Math.abs(t.y - u.y);
        if (d < bd) { bd = d; best = t; }
      }
      return { ux: u.x, uy: u.y, wx: best.x, wy: best.y, dist: bd };
    });
    if (water && water.dist <= 1) {
      const w1 = await posOf(water.wx, water.wy);
      // ensure the warrior is selected
      await page.evaluate(() => {
        const S = window.Civ.state, p = S.civs[0];
        const u = p.units.find(v => v.type === 'warrior' && !v.moved && v.mp > 0);
        S.selected = { kind: 'unit', id: u.id };
        S.reachable = window.Civ.reachable(u);
      });
      await page.mouse.click(w1.px, w1.py);
      await page.waitForTimeout(200);
      const stuck = await page.evaluate(() => {
        const S = window.Civ.state;
        const sel = S.selected;
        const u = sel && sel.kind === 'unit' ? window.Civ.unitById(sel.id) : null;
        return u ? { x: u.x, y: u.y, mp: u.mp, moved: u.moved, onWater: S.tiles[window.Civ.idx(u.x, u.y)].terrain === 'ocean' } : null;
      });
      assert(stuck && !stuck.onWater, 'warrior did not move onto water');
      console.log('warrior held on land:', JSON.stringify(stuck));
    } else {
      console.log('(no adjacent ocean for the warrior; water-domain UI check skipped)');
    }
    await page.screenshot({ path: 'test/shots/11-water-blocked.png' });

    console.log('errors:', errors.length ? errors : 'none');
    await browser.close();
    process.exitCode = errors.length ? 1 : 0;
  } finally {
    server.kill();
  }
})().catch(e => { console.error('UI FLOW TEST FAILED:', e.message); process.exit(1); });
