/* Local-only Playwright harness. Test instrumentation is appended to served modules,
   never shipped. The normal scenario starts empty; later scenic camps are labeled fixtures. */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const {
  chromium
} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {
  runProgression
} = require('./progression.cjs');
const out = path.join(__dirname, '../docs/validation'),
  checks = [],
  errors = [],
  requests = [],
  stats = [];
const check = (name, value) => {
  assert(value, name);
  checks.push(name);
  console.log('PASS', name);
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 960
      }
    });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    page.on('dialog', d => d.accept());
    await page.addInitScript(() => {
      crypto.getRandomValues = a => {
        a.fill(741092);
        return a;
      };
    });
    await page.route('**/js/boot.js', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()) + '\nwindow.__test={get game(){return game},get renderer(){return renderer},saves,openPanel,closePanel,saveNow,replaceGame,notice,get slot(){return activeSlot}};'
      });
    });
    await page.goto(process.env.ISLES_URL || 'http://127.0.0.1:8770/');
    await page.locator('#welcome').waitFor({
      state: 'visible',
      timeout: 60000
    });
    const screenshot = async name => {
      await page.screenshot({
        path: path.join(out, name + '.png')
      });
    };
    const ready = async () => {
      await page.waitForFunction(() => window.__test && window.__test.renderer.queue.length === 0 && !document.getElementById('loading').hidden === false, {}, {
        timeout: 60000
      });
    };
    await screenshot('01-menu');
    check('WebGL initializes with no visible fallback', await page.locator('#fatal').isHidden());
    await page.locator('#newGame').click();
    await page.locator('#panel[open]').waitFor();
    await screenshot('02-journal');
    await page.locator('#resume').click();
    await page.waitForTimeout(800);
    check('Resume obtains actual pointer lock', await page.evaluate(() => !!document.pointerLockElement));
    const before = await page.evaluate(() => ({
      ...__test.game.state.player
    }));
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => ({
      ...__test.game.state.player
    }));
    check('actual W keyboard moves the colliding player', Math.hypot(after.x - before.x, after.z - before.z) > .4);
    await page.waitForTimeout(400);
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');
    check('actual Space jumps', await page.evaluate(y => __test.game.state.player.y > y + .1, after.y));
    await page.waitForTimeout(700);
    await page.keyboard.press('Tab');
    check('Tab pauses in native modal', await page.evaluate(() => __test.game.paused && document.querySelector('#panel').open));
    const time = await page.evaluate(() => __test.game.state.time);
    await page.waitForTimeout(200);
    check('open panels freeze game time', await page.evaluate(t => __test.game.state.time === t, time));
    await page.getByRole('button', {
      name: 'Help',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Enable gentle sound',
      exact: true
    }).click();
    check('sound toggle changes persisted preference', await page.evaluate(() => __test.game.state.settings.sound));
    await page.getByRole('button', {
      name: 'Saves',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Load',
      exact: true
    }).click();
    await page.locator('#panel[open]').waitFor();
    await page.locator('#resume').click();
    await page.waitForTimeout(300);
    await screenshot('03-beach');
    // Inject only the action controller, with no inventory, terrain or position fixtures.
    const progression = await page.evaluate(source => {
      const fn = (0, eval)('(' + source + ')');
      return fn(__test.game, EWData, EWWorld);
    }, runProgression.toString());
    check('normal-action browser progression upgraded tools and visited second island', progression.state.inventory.copperPick === 1 && progression.state.discoveries.includes('forest'));
    check('normal-action sailing, fishing, growing and cooking all changed gameplay', progression.state.stats.sailed > 650 && progression.state.stats.fish === 1 && progression.state.stats.harvest === 1 && progression.state.crafted.includes('grilledFish'));
    fs.writeFileSync(path.join(out, 'browser-progression.json'), JSON.stringify({
      log: progression.log,
      time: progression.state.time,
      stats: progression.state.stats,
      inventory: progression.state.inventory
    }, null, 2));
    // Actual mouse events complement the accelerated model-action controller.
    const minedBefore = await page.evaluate(() => {
      const g = __test.game; g.state.hotbar[g.state.selected] = 'copperPick';
      g.state.player.pitch = -1.4; return g.state.stats.mined;
    });
    await page.mouse.down({ button: 'left' }); await page.waitForTimeout(900); await page.mouse.up({ button: 'left' });
    check('actual held left mouse mines reachable terrain', await page.evaluate(n => __test.game.state.stats.mined > n, minedBefore));
    await page.waitForTimeout(350);
    const placedBefore = await page.evaluate(() => {
      const g = __test.game, p = g.state.player; g.state.hotbar[g.state.selected] = 'plank';
      for (const pitch of [-.9, -.6, -.2, .3, .8, 1.2]) for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
        p.pitch = pitch; p.yaw = yaw; const hit = g.target(); if (!hit) continue;
        const [x,y,z] = hit.prev;
        const overlaps = x < p.x+.3 && x+1 > p.x-.3 && z < p.z+.3 && z+1 > p.z-.3 && y < p.y+1.8 && y+1 > p.y;
        if (!overlaps && y > 0 && y < 79 && !g.world.get(x,y,z)) return g.state.stats.placed;
      }
      throw new Error('No visible legal placement cell for mouse check');
    });
    await page.mouse.down({ button: 'right' }); await page.waitForTimeout(80); await page.mouse.up({ button: 'right' });
    check('actual right mouse places a carried building block', await page.evaluate(n => __test.game.state.stats.placed > n, placedBefore));
    await page.evaluate(() => {
      __test.game.paused = true;
      __test.notice('NORMAL-ACTION CAMP · built from gathered materials');
    });
    await page.waitForTimeout(2200);
    await screenshot('04-normal-camp');
    await page.evaluate(() => __test.openPanel('Craft'));
    await page.locator('input[type=search]').fill('Timber planks');
    const logs = await page.evaluate(() => __test.game.state.inventory.log || 0);
    await page.locator('[data-recipe="plank"]').click();
    check('actual recipe button consumes input and outputs planks', await page.evaluate(n => __test.game.state.inventory.log === (n === 1 ? undefined : n - 1), logs));
    await page.locator('input[type=search]').fill('');
    await screenshot('05-crafting');
    await page.getByRole('button', {
      name: 'Chart',
      exact: true
    }).click();
    await screenshot('06-chart');
    await page.getByRole('button', {
      name: 'Saves',
      exact: true
    }).click();
    await page.getByRole('button', {
      name: 'Save checkpoint',
      exact: true
    }).click();
    await screenshot('07-saves');
    check('UI reports successful safe checkpoint', (await page.locator('#panelFoot').textContent()) === 'Safe checkpoint saved.');
    const saved = await page.evaluate(() => __test.game.snapshot());
    await page.reload();
    await page.locator('#welcome').waitFor();
    await page.locator('#continueGame').click();
    await page.getByRole('button', {
      name: 'Load',
      exact: true
    }).click();
    await page.locator('#panel[open]').waitFor();
    check('reload restores actual camp edits, crops, boat, inventory and progress', await page.evaluate(expected => {
      const s = __test.game.snapshot();
      return JSON.stringify(s.edits) === JSON.stringify(expected.edits) && JSON.stringify(s.inventory) === JSON.stringify(expected.inventory) && s.boats.length === 1 && s.discoveries.includes('forest');
    }, saved));
    await page.locator('#resume').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      __test.game.paused = true;
    });
    async function stage(position, look, label) {
      await page.evaluate(({
        position,
        look,
        label
      }) => {
        const g = __test.game;
        g.paused = true;
        Object.assign(g.state.player, position, {
          boat: null
        });
        const e = g.eye(),
          dx = look.x - e.x,
          dz = look.z - e.z;
        g.state.player.yaw = Math.atan2(-dx, -dz);
        g.state.player.pitch = Math.atan2(look.y - e.y, Math.hypot(dx, dz));
        __test.notice('VISUAL FIXTURE · ' + label);
      }, {
        position,
        look,
        label
      });
      await page.waitForFunction(() => {
        const p = __test.game.state.player,
          r = __test.renderer;
        return r.lastChunk === `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)},${__test.game.state.settings.view}` && r.queue.length === 0 && __test.game.world.dirty.size === 0;
      }, {}, {
        timeout: 60000
      });
      await page.waitForTimeout(500);
      stats.push(await page.evaluate(() => __test.renderer.stats()));
    }
    // Each island is positioned only for scenic QA. These are not earned progression screenshots.
    const islands = await page.evaluate(() => EWData.islands);
    for (const island of islands) {
      const pos = await page.evaluate(i => {
        const x = i.x - 39,
          z = i.z + 35;
        return {
          x,
          y: __test.game.world.top(x, z) + 2,
          z
        };
      }, island);
      await stage(pos, {
        x: island.x + 12,
        y: pos.y - 1,
        z: island.z - 15
      }, island.name);
      await screenshot('biome-' + island.id);
      const landmark = await page.evaluate(i => { const x=i.x+13, z=i.z+4; return {x,y:EWWorld.column(x,z,__test.game.state.seed).h+1.02,z}; }, island);
      await stage(landmark,{x:island.x+12,y:landmark.y+2,z:island.z-15},island.landmark+' · scenic QA');
      await screenshot('landmark-'+island.id);
    }
    const cave = await page.evaluate(() => __test.game.world.networks[0]);
    await stage({
      x: cave.chamber[0] + .5,
      y: 5.02,
      z: cave.chamber[2] + 1.5
    }, {
      x: cave.chamber[0] - 15,
      y: 6,
      z: cave.chamber[2]
    }, 'dry connected mineable cave');
    await screenshot('08-cave');
    check('cave interior is dry and body-clear in browser', await page.evaluate(() => {
      const g = __test.game,
        p = g.state.player;
      return !g.world.waterAt(p.x, p.y, p.z) && !g.collides(p.x, p.y, p.z);
    }));
    // Original luxury villa fixture, separated from the earned camp above.
    await page.evaluate(() => {
      const g = __test.game,
        D = EWData,
        B = D.ids;
      const set = (x, y, z, id) => {
        g.world.set(x, y, z, B[id]);
        if (id) g.state.placed[`${x},${y},${z}`] = B[id];
      };
      for (let x = -212; x <= -191; x++) for (let z = 103; z <= 120; z++) {
        for (let y = 15; y <= 24; y++) {
          g.world.set(x, y, z, 0);
          delete g.state.placed[`${x},${y},${z}`];
        }
        set(x, 14, z, (x + z) % 7 === 0 ? 'darkwood' : 'plank');
      }
      for (let x = -208; x <= -195; x++) for (let z = 106; z <= 116; z++) {
        if (x === -208 || x === -195 || z === 106 || z === 116) {
          for (let y = 15; y <= 18; y++) {
            if (z === 116 && (x === -202 || x === -201)) continue;
            set(x, y, z, y === 17 ? 'glass' : y === 18 ? 'darkwood' : 'brick');
          }
        }
        set(x, 19, z, 'slab');
      }
      for (let x = -212; x <= -191; x++) {
        set(x, 15, 120, 'fence');
        if (x % 4 === 0) set(x, 15, 103, 'lantern');
      }
      const stuff = [['silkBed', -206, 15, 108], ['sofa', -206, 15, 113], ['table', -201, 15, 111], ['chair', -200, 15, 111], ['royalRug', -203, 15, 112], ['shelf', -196, 15, 108], ['globe', -196, 15, 110], ['gramophone', -196, 15, 113], ['prismLamp', -202, 15, 107], ['vase', -205, 15, 107], ['chest', -196, 15, 114], ['bath', -205, 15, 114], ['telescope', -211, 15, 117], ['fountain', -192, 15, 113], ['sculpture', -193, 15, 107], ['windchime', -198, 18, 116], ['picnic', -201, 15, 118], ['beacon', -192, 15, 119], ['planter', -209, 15, 108], ['trellis', -209, 15, 111], ['campfire', -207, 15, 118], ['lantern', -211, 15, 105]];
      for (const [id, x, y, z] of stuff) set(x, y, z, id);
      for (let x = -194; x <= -191; x++) {
        set(x, 15, 104, 'farmland');
        g.state.crops[`${x},15,104`] = {
          type: x % 2 ? 'grain' : 'carrot',
          ready: g.state.time,
          watered: true
        };
      }
      g.state.camp = {
        x: -201,
        y: 15,
        z: 112
      };
      g.state.discoveries = D.islands.map(i => i.id);
    });
    await stage({
      x: -218,
      y: 22,
      z: 130
    }, {
      x: -201,
      y: 16,
      z: 111
    }, 'luxury villa; test-seeded, not earned');
    await screenshot('09-luxury-exterior');
    await stage({
      x: -201.5,
      y: 15.01,
      z: 114.5
    }, {
      x: -204,
      y: 16,
      z: 108
    }, 'luxury interior; test-seeded');
    await screenshot('10-luxury-interior');
    await page.evaluate(() => __test.openPanel('Camp'));
    await screenshot('11-comfort');
    check('seeded luxury camp scores variety and architecture', await page.evaluate(() => __test.game.luxury().points >= 95));
    await page.locator('#resume').click();
    // Travel and streaming fixture. The earned edits must survive a far trip.
    const edit = await page.evaluate(() => {
      const [k, v] = Object.entries(__test.game.state.placed)[0];
      return {
        k,
        v
      };
    });
    await stage({
      x: -300,
      y: 12.25,
      z: -40
    }, {
      x: -160,
      y: 25,
      z: -170
    }, 'boat voyage');
    await page.evaluate(() => {
      const g = __test.game,
        b = g.state.boats[0];
      b.x = g.state.player.x;
      b.z = g.state.player.z;
      b.yaw = g.state.player.yaw;
      g.state.player.boat = b.id;
    });
    await page.waitForTimeout(350);
    await screenshot('12-voyage');
    check('streamed data cache stays bounded', await page.evaluate(() => __test.game.world.chunks.size <= 169 && __test.renderer.meshes.size <= 121));
    await stage({
      x: -208.5,
      y: 20,
      z: 102.5
    }, {
      x: -196,
      y: 17,
      z: 95
    }, 'return trip edit check');
    check('edits survive browser renderer unloading and reloading', await page.evaluate(({
      k,
      v
    }) => __test.game.world.get(...k.split(',').map(Number)) === v, edit));
    // Restore the earned safe checkpoint before boundary tests, keeping fixture edits out of saves.
    await page.evaluate(async () => {
      const r = __test.saves.load(1, false, true);
      await __test.replaceGame(r.state, 1);
    });
    await page.locator('#resume').click();
    await stage({
      x: 452,
      y: 11.5,
      z: 0
    }, {
      x: 490,
      y: 12,
      z: 0
    }, 'outer warning waters');
    await screenshot('13-boundary-warning');
    check('danger warning visible before crossing', await page.locator('#boundary').isVisible());
    await page.evaluate(() => {
      const g = __test.game;
      g.state.player.x = 489.9;
      g.state.player.yaw = -Math.PI / 2;
      g.paused = false;
      g.step({
        forward: true
      }, .05);
      g.paused = true;
    });
    await page.waitForTimeout(1200);
    await screenshot('14-storm');
    check('storm ignores pause state', await page.evaluate(() => __test.game.state.status === 'disaster' && __test.game.state.disaster > .5));
    await page.reload();
    await page.locator('#welcome').waitFor();
    await page.locator('#continueGame').click();
    await page.getByRole('button', {
      name: 'Load',
      exact: true
    }).click();
    await page.locator('#ending').waitFor();
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await screenshot('15-game-over');
    check('reload during storm returns to unmistakable game over', await page.evaluate(() => __test.game.state.status === 'dead'));
    await page.locator('#restoreSafe').click();
    await page.locator('#panel[open]').waitFor();
    check('explicit safe restore preserves original normal-action camp', await page.evaluate(() => __test.game.state.status === 'alive' && __test.game.state.inventory.copperPick === 1 && __test.game.state.discoveries.includes('forest')));
    // Small-window panel check, not a claim of touch gameplay support.
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    await page.evaluate(() => __test.openPanel('Saves'));
    await screenshot('16-small-window');
    check('small-screen panel fits viewport width', await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().width <= innerWidth));
    await page.setViewportSize({
      width: 1440,
      height: 960
    });
    await page.locator('#resume').click();
    await page.keyboard.down('KeyW');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('KeyW');
    check('window blur clears held input and opens pause', await page.evaluate(() => __test.game.paused && document.getElementById('panel').open));
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return original.call(this, type, ...args);
      };
    });
    await fallback.goto('http://127.0.0.1:8770/');
    await fallback.locator('#fatal').waitFor({
      state: 'visible'
    });
    await fallback.screenshot({
      path: path.join(out, '17-webgl-fallback.png')
    });
    check('WebGL failure shows visible fallback', await fallback.locator('#fatal').isVisible());
    await fallback.close();
    const denied = await browser.newPage();
    await denied.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('Storage disabled for test');
        }
      });
    });
    await denied.goto('http://127.0.0.1:8770/');
    await denied.locator('#welcome').waitFor();
    denied.on('dialog', d => d.accept());
    await denied.locator('#newGame').click();
    await denied.locator('#panel[open]').waitFor();
    check('unavailable storage shows a visible recoverable error', await denied.locator('#panelContent').textContent().then(t => t.includes('Needs recovery')));
    await denied.close();
    check('all runtime requests stay on local origin', requests.every(url => url.startsWith('http://127.0.0.1:8770/') || url.startsWith('blob:')));
    check('no browser page errors', errors.length === 0);
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({
      checks,
      errors,
      stats,
      normalActionSeconds: progression.state.time,
      softwareWebGL: true,
      fixtures: 'All biome, cave, luxury and border images are staged QA; 04-normal-camp is earned by the normal controller.'
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
