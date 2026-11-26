/* Isolated browser storage. The ascent uses game actions with supplied materials.
   The two elevation views of each island use staged cameras for visual inspection. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { climbFromSea } = require('./sky-climb.cjs');
const old = require('./fixtures/v3-balcony.json');
const out = process.env.EVIDENCE_DIR || path.join(__dirname, '../docs/validation/sky');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(raw => {
      if (!localStorage.getItem('emberwake.v1.1.save')) localStorage.setItem('emberwake.v1.1.save', raw);
    }, JSON.stringify(old));
    await page.route('**/js/boot.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + '\nwindow.qa={get game(){return game},get renderer(){return renderer},replaceGame,closePanel,openPanel,saveNow};' });
    });
    const load = async slot => {
      await page.locator('#continueGame').click();
      await page.getByRole('button', { name: 'Load', exact: true }).nth(slot - 1).click();
      await page.waitForFunction(() => window.qa?.game?.state.version === EWData.C.version && document.querySelector('#loading').hidden && document.querySelector('#panel').open);
    };
    await page.goto(process.env.ISLES_URL || 'http://127.0.0.1:8770/');
    await load(1);
    assert(await page.evaluate(() => {
      const g = qa.game;
      return g.state.sky.berths[0] !== 0 && g.standingPortal() === '852,50,-804' && g.state.inventory.irisStone1 === 3100 &&
        JSON.parse(localStorage.getItem('emberwake.v1.1.save')).version === 3;
    }));
    const journeys = await page.evaluate(async source => {
      const climb = (0, eval)('(' + source + ')');
      await qa.replaceGame(EWGame.fresh(741092), 2);
      const g = qa.game, journeys = [];
      for (const site of g.world.sky.sites) journeys.push(climb(g, EWData, site));
      // Climb fixtures start each approach at sea. Both constructed towers remain in the same world.
      g.paused = true;
      if (!qa.saveNow().ok) throw Error('Tower save failed');
      return journeys;
    }, climbFromSea.toString());
    await page.reload(); await load(2);
    assert(await page.evaluate(() => qa.game.state.discoveries.includes('kestrel') && qa.game.state.discoveries.includes('vesper') && qa.game.state.stats.placed >= 90));
    await page.getByRole('button', { name: 'Chart', exact: true }).click();
    assert(await page.locator('#panelContent').getByText('✓ Kestrel Wing').isVisible());
    await page.screenshot({ path: path.join(out, 'chart.png') });
    await page.getByRole('button', { name: 'Craft', exact: true }).click();
    await page.locator('input[type=search]').fill('opal fanlight');
    assert(await page.locator('button[data-recipe=opalScreen]').isVisible());
    // Stage the marked roof and a mica outcrop. The player must mine the real
    // cap, fall into the chamber, open it, mine two ingredients and craft at a bench.
    const vault = await page.evaluate(() => {
      const g = qa.game, w = g.world; w.sky.prepare();
      const [key] = [...w.sky.vaults].find(([,v]) => v.id === 'aviator');
      const [x,y,z] = key.split(',').map(Number);
      Object.assign(g.state.player,{ x:x+.5, y:w.top(x,z+1)+.01, z:z+1.5, yaw:0, pitch:-1.48 });
      g.state.hotbar[0] = 'woodPick'; g.state.selected = 0;
      g.give({ bench:1, torch:1 });
      return { x,y,z };
    });
    await page.locator('#resume').click();
    await page.waitForFunction(() => !!document.pointerLockElement && qa.game.target()?.id === EWData.ids.windOpal);
    await page.mouse.down();
    try { await page.waitForFunction(() => qa.game.state.inventory.windOpal >= 1); }
    finally { await page.mouse.up(); }
    await page.waitForFunction(y => Math.abs(qa.game.state.player.y-y)<.15,vault.y);
    const aim = async (x,y,z) => page.evaluate(([x,y,z]) => {
      const g=qa.game, eye=g.eye(), p=g.state.player;
      p.yaw=Math.atan2(eye.x-x,eye.z-z);
      p.pitch=Math.atan2(y-eye.y,Math.hypot(eye.x-x,eye.z-z));
    },[x,y,z]);
    await aim(vault.x+.5,vault.y+.42,vault.z+.5);
    await page.waitForFunction(() => qa.game.target()?.id === EWData.ids.skyCoffer);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => qa.game.state.sky.finds.includes('aviator'));
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Found'));
    await page.screenshot({ path:path.join(out,'courier-vault.png') });
    const outcrop = await page.evaluate(() => {
      const g=qa.game, w=g.world, s=w.sky.sites[0];
      for (let z=s.z-24; z<s.z+25; z++) for (let x=s.x-35; x<s.x+35; x++) {
        const y=w.top(x,z)-1;
        if (y<40 || [0,1,2,3,4].some(n => w.top(x+n,z)!==y+1 || w.get(x+n,y,z)!==EWData.ids.honeyMica)) continue;
        Object.assign(g.state.player,{ x:x+2.5,y:y+1.01,z:z+.5,boat:null });
        g.velocity=0; return {x,y,z};
      }
      throw Error('Missing open mica ledge');
    });
    for (const [i, offset] of [0,1].entries()) {
      await aim(outcrop.x+offset+.5,outcrop.y+.98,outcrop.z+.5);
      await page.waitForFunction(() => qa.game.target()?.id===EWData.ids.honeyMica);
      await page.mouse.down();
      try { await page.waitForFunction(i => qa.game.state.inventory.honeyMica>=i+1,i); }
      finally { await page.mouse.up(); }
    }
    await aim(outcrop.x+4.5,outcrop.y+.98,outcrop.z+.5);
    await page.evaluate(() => { qa.game.state.hotbar[0]='bench'; });
    await page.mouse.down({button:'right'}); await page.mouse.up({button:'right'});
    await page.waitForFunction(() => qa.game.stations().has('bench'));
    await page.keyboard.press('KeyB');
    await page.locator('input[type=search]').fill('Mica sail lamp');
    await page.locator('button[data-recipe=micaSconce]').click();
    await page.waitForFunction(() => qa.game.state.inventory.micaSconce===2);
    await page.getByRole('button',{name:'Journal',exact:true}).click();
    assert(await page.getByRole('heading',{name:'Kestrel Wing · 1/2 treasures'}).isVisible());
    await page.locator('#resume').click();
    await page.evaluate(() => { qa.game.state.hotbar[0]='micaSconce'; });
    await aim(outcrop.x+3.5,outcrop.y+.98,outcrop.z+.5);
    await page.mouse.down({button:'right'}); await page.mouse.up({button:'right'});
    await page.waitForFunction(() => Object.values(qa.game.state.placed).includes(EWData.ids.micaSconce));
    await page.keyboard.press('KeyJ');
    await page.getByRole('button',{name:'Saves',exact:true}).click();
    await page.getByRole('button',{name:/save now|save checkpoint/i}).first().click();
    await page.reload(); await load(2);
    const recovered = await page.evaluate(() => {
      const s=qa.game.state;
      return { finds:s.sky.finds, mantle:s.inventory.sailMantle, lampsCarried:s.inventory.micaSconce,
        lampsPlaced:Object.values(s.placed).filter(id=>id===EWData.ids.micaSconce).length };
    });
    assert.deepEqual(recovered,{ finds:['aviator'],mantle:1,lampsCarried:1,lampsPlaced:1 });
    await page.evaluate(() => { qa.closePanel(); qa.game.paused = true; });
    const scenes = [];
    for (const [n, view, camera, target] of [
      [0,'approach',[-31,13,67],[0,46,0]], [0,'summit',[-8,118,67],[-1,48,-4]], [0,'deck',[-15,null,-11],[-4,59,-20]],
      [1,'approach',[24,15,77],[0,48,0]], [1,'summit',[7,135,56],[0,50,0]], [1,'deck',[35,null,-28],[30,64,-13]]
    ]) {
      const id = await page.evaluate(([n,camera,target]) => {
        const g = qa.game, s = g.world.sky.sites[n], p = g.state.player;
        const x = s.x+camera[0]+.5, z = s.z+camera[2]+.5;
        Object.assign(p, { x, y: camera[1] ?? g.world.top(x,z)+.02, z, boat: null });
        const eye = g.eye();
        p.yaw = Math.atan2(eye.x-s.x-target[0], eye.z-s.z-target[2]);
        p.pitch = Math.atan2(target[1]-eye.y, Math.hypot(eye.x-s.x-target[0],eye.z-s.z-target[2]));
        g.notify('Scenic view · ' + s.name); g.paused = true;
        return s.id;
      }, [n,camera,target]);
      await page.waitForFunction(() => {
        const g = qa.game, r = qa.renderer, p = g.state.player;
        return r.lastChunk === [Math.floor(p.x/16), Math.floor(p.z/16), g.state.settings.view].join(',') && !r.queue.length &&
          ![...r.skyTiles].some(([key,t]) => t.dirty && !r.meshes.has(key) && Math.hypot(p.x-t.cx*16-8,p.z-t.cz*16-8)<560);
      }, {}, { timeout: 90000 });
      await page.screenshot({ path: path.join(out, id + '-' + view + '.png') });
      scenes.push({ island: id, view, ...await page.evaluate(() => qa.renderer.stats()) });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ journeys, recovered, scenes, errors }, null, 2) + '\n');
    console.log('Loaded v3 balcony, built both ascents, reloaded towers and discoveries, opened the mined vault, crafted and saved its island lamp, captured six sky views.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
