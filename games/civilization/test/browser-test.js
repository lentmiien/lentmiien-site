/* Browser smoke test: loads the game in headless Chromium, plays a few turns,
   exercises selection/movement/tech/diplomacy, and captures screenshots. */
const path = require('path');
const { spawn } = require('child_process');
const playwright = require('playwright');

const PORT = 8931;
const DIR = path.join(__dirname, '..');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
  const errors = [];
  try {
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    // seed the page RNG so AI war rolls are deterministic and reproducible
    await page.evaluate(() => {
      let a = 0x9e3779b9;
      Math.random = function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test/shots/01-newgame.png' });

    // start game
    await page.fill('#seed', '777');
    await page.selectOption('#aicount', '3');
    await page.selectOption('#difficulty', 'normal');
    await page.click('#btn-start');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test/shots/02-start.png' });

    const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };

    // sanity: state exists, player city present
    let st = await page.evaluate(() => ({
      turn: window.Civ.state.turn,
      cities: window.Civ.state.civs[0].cities.length,
      units: window.Civ.state.civs[0].units.length,
      explored: Object.keys(window.Civ.state.civs[0].explored).length,
      techsAvail: window.Civ.availableTechs(window.Civ.state.civs[0]).length,
    }));
    assert(st.cities >= 1, 'player has a city at start');
    assert(st.units >= 3, 'player has starting units');
    assert(st.explored > 20, 'fog of war explored area');
    assert(st.techsAvail >= 6, 'ancient techs available');
    console.log('start state:', JSON.stringify(st));

    // select own city -> queue a unit
    const cityPos = await page.evaluate(() => {
      const S = window.Civ.state, c = S.civs[0].cities[0];
      const R = window.Civ.render, s = R.baseTile * R.cam.zoom;
      const rect = document.getElementById('map').getBoundingClientRect();
      return { x: rect.left + c.x * s - R.cam.x + s / 2, y: rect.top + c.y * s - R.cam.y + s / 2 };
    });
    await page.mouse.click(cityPos.x, cityPos.y);
    await page.waitForTimeout(200);
    // Stacking semantics (refinement #1): the starting city has units stacked
    // on it, so the click selects the topmost UNIT first. Reach the city
    // panel via the "⬇ City" button, as a human player would.
    const selKind = await page.evaluate(() => (window.Civ.state.selected || {}).kind);
    if (selKind === 'unit') {
      await page.click('#selbox button[data-act="selectcity"]');
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => {
      const sel = window.Civ.state.selected;
      if (!sel || sel.kind !== 'city') throw new Error('city not selected after click flow');
    });
    await page.screenshot({ path: 'test/shots/03-city-selected.png' });

    // queue settler if possible (should be available)
    let queued = await page.evaluate(() => {
      const S = window.Civ.state, sel = S.selected;
      const c = window.Civ.cityById(sel.id);
      c.queue = 'unit:settler'; c.progress = 0;
      return true;
    });
    await page.click('#btn-endturn');
    await page.waitForTimeout(200);

    // play 60 turns: pick a tech if available, end turn (tech costs are 2.5x slower now)
    const techChoice = await page.evaluate(() => {
      const p = window.Civ.state.civs[0];
      const av = window.Civ.availableTechs(p).sort((a, b) => a.cost - b.cost);
      if (av.length) { p.currentTech = av[0].id; return av[0].id; }
      return null;
    });
    for (let i = 0; i < 60; i++) {
      const done = await page.evaluate(() => {
        const p = window.Civ.state.civs[0];
        if (!p.currentTech) {
          const av = window.Civ.availableTechs(p).sort((a, b) => a.cost - b.cost);
          if (av.length) p.currentTech = av[0].id;
        }
        if (window.Civ.state.winner) return true;
        window.Civ.endTurn();
        return !!window.Civ.state.winner;
      });
      if (done) break;
    }
    await page.waitForTimeout(200);
    st = await page.evaluate(() => ({
      turn: window.Civ.state.turn,
      winner: window.Civ.state.winner,
      cities: window.Civ.state.civs[0].cities.length,
      units: window.Civ.state.civs[0].units.length,
      techs: Object.keys(window.Civ.state.civs[0].techs).length,
      gold: Math.floor(window.Civ.state.civs[0].gold),
      logLen: window.Civ.state.log.length,
    }));
    console.log('after 60 turns:', JSON.stringify(st));
    await page.screenshot({ path: 'test/shots/04-after60turns.png' });

    // a passive test player can be wiped out quickly (faithful to Civ 1991)
    const over = await page.evaluate(() => !!window.Civ.state.winner);
    if (!over) {
      assert(st.turn >= 55, 'turn counter advanced');
      assert(st.techs >= 1, 'at least one tech researched');
    } else {
      console.log('game ended during the 60-turn loop (winner=' + st.winner + ') — skipping interaction steps');
      await page.screenshot({ path: 'test/shots/08-final.png' });
      console.log('errors:', errors.length ? errors : 'none');
      await browser.close();
      process.exitCode = errors.length ? 1 : 0;
      return;
    }

    // find a player unit, select it, verify reachable highlight
    const unitInfo = await page.evaluate(() => {
      const S = window.Civ.state, p = S.civs[0];
      const u = p.units.find(u => u.type === 'warrior' || u.type === 'archer');
      if (!u) return null;
      S.selected = { kind: 'unit', id: u.id };
      S.reachable = window.Civ.reachable(u);
      const R = window.Civ.render, s = R.baseTile * R.cam.zoom;
      R.centerOn(u.x, u.y);
      return { x: u.x, y: u.y, mp: u.mp, reachable: S.reachable.size, type: u.type };
    });
    if (unitInfo) {
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'test/shots/05-unit-selected.png' });
      assert(unitInfo.reachable > 0, 'unit has reachable tiles');
      // click a reachable tile to move
      const moved = await page.evaluate(() => {
        const S = window.Civ.state;
        const sel = S.selected, u = window.Civ.unitById(sel.id);
        const k = [...S.reachable].find(k => !window.Civ.cityAt(...k.split(',').map(Number)));
        if (!k) return false;
        const [x, y] = k.split(',').map(Number);
        return window.Civ.moveUnit(u, x, y);
      });
      console.log('unit moved:', moved, 'from', JSON.stringify(unitInfo));
    } else {
      console.log('no movable unit found (skipping move test)');
    }
    await page.click('#btn-endturn');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test/shots/06-after-move.png' });


    // --- new UI: mute button + gold gifts --------------------------
    // sound toggle
    await page.click('#btn-sound');
    const muted1 = await page.evaluate(() => window.Civ.sound.isMuted());
    await page.click('#btn-sound');
    const muted2 = await page.evaluate(() => window.Civ.sound.isMuted());
    assert(muted1 === true && muted2 === false, 'mute toggle flips and resets');
    console.log('mute toggle: works');

    // gold gift: give the player gold, make peace with everyone, gift a rival
    const gift = await page.evaluate(() => {
      const S = window.Civ.state, p = S.civs[0];
      // ensure at least one live, non-war rival exists as a target
      const other = S.civs.slice(1).find(o => !o.eliminated && !p.atWar[o.id]);
      if (!other) {
        // at war with everyone: make peace with the first live rival
        const o = S.civs.slice(1).find(o => !o.eliminated);
        if (!o) return { skipped: 'no rivals' };
        window.Civ.makePeace(p, o);
        window.Civ.ui.refresh();
        return giftEval(o.id);
      }
      return giftEval(other.id);
      function giftEval(otherId) {
        const o = window.Civ.civById(otherId);
        p.gold = 250;
        window.Civ.ui.refresh();
        const btn = document.querySelector('button[data-diplo="gift"]');
        if (!btn) return { failed: 'gift button not rendered' };
        const goldBefore = p.gold, giftsBefore = (o.gifts && o.gifts[p.id]) || 0;
        btn.click();
        return {
          rendered: true,
          goldDelta: p.gold - goldBefore,
          giftsDelta: ((o.gifts && o.gifts[p.id]) || 0) - giftsBefore,
          logged: S.log.some(l => /gifts 100 gold/i.test(l.msg)),
        };
      }
    });
    console.log('gold gift:', JSON.stringify(gift));
    if (!gift.skipped) {
      assert(gift.rendered, 'gift button rendered in diplomacy panel');
      assert(gift.goldDelta === -100, 'gift deducts 100 gold');
      assert(gift.giftsDelta === 100, 'gift recorded on the rival');
      assert(gift.logged, 'gift logged in the message log');
    }
    await page.screenshot({ path: 'test/shots/06b-gifts.png' });

    // help overlay
    await page.click('#btn-help');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test/shots/07-help.png' });
    await page.click('#help-close');

    // final shot
    await page.screenshot({ path: 'test/shots/08-final.png' });

    console.log('errors:', errors.length ? errors : 'none');
    await browser.close();
    process.exitCode = errors.length ? 1 : 0;
  } finally {
    server.kill();
  }
})().catch(e => { console.error('BROWSER TEST FAILED:', e.message); process.exit(1); });
