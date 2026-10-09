/* Synthetic visual review only. No app startup, database, provider or production access. */
const fs = require('fs/promises');
const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreview } = require('./preview-commons');
async function run() {
  const phase = process.argv.includes('--before') ? 'before' : 'after';
  const output = path.resolve(process.env.COMMONS_SCREENSHOTS || 'documentation/commons/validation-v1.1');
  await fs.mkdir(output, { recursive: true });
  const preview = await createPreview();
  const browser = await chromium.launch({ executablePath: process.env.COMMONS_CHROMIUM || undefined })
    .catch(async error => { await preview.stop(); throw error; });
  const errors = [], results = [];
  const World = require('../public/commons/world');
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'CommonsRenderer', { configurable: true, set(Renderer) {
        Object.defineProperty(window, 'CommonsRenderer', { value: class extends Renderer {
          constructor(...args) { super(...args); window.reviewRenderer = this; }
        } });
      } });
    });
    await context.request.post(preview.url + '/__preview/login', { data: { resident: 1 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    if (phase === 'before') {
      // Pin the accepted renderer inputs without checking out or modifying the worktree.
      for (const file of ['world.js', 'renderer.js', 'client.js', 'style.css']) {
        const body = execFileSync('git', ['show', `591eb138192828d3c3807e66d470d79cd3df840b:public/commons/${file}`], { encoding: 'utf8' });
        await page.route(`**/commons/${file}*`, route => route.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript' }));
      }
    }
    await page.goto(preview.url + '/commons');
    await page.waitForFunction(() => !document.getElementById('enter').disabled);
    await page.click('#enter'); await page.waitForFunction(() => document.getElementById('cover').hidden);
    await page.evaluate(() => { const clock = CommonsWorld.clock; window.reviewClock = clock; CommonsWorld.clock = now => ({ ...clock(now), darkness: 0, phase: 'Daylight', time: '09:18' }); });
    const player = () => preview.room.state.players[0];
    await page.waitForTimeout(5600); // Let the welcome toast disappear from comparison views.
    for (const [name, x, y, zoom] of [
      ['pond', 51, 34.8, 1.5], ['fountain', 32, 29.5, 1.5], ['hall', 32, 18, 1.5],
      ['north-cottages', 13, 10.7, 1.5], ['garden-road', 32, 34.8, 1], ['east-road', 57, 20, 1],
      ['west-edge', 1, 25, .5], ['overview', 32, 25, .5], ['contact', 33, 24, 1.5],
    ]) {
      Object.assign(player(), { x, y, facing: 'down', scene: 'village' });
      await page.evaluate(scale => { reviewRenderer.scale = scale; reviewRenderer.camera = null; }, zoom);
      await page.waitForTimeout(220);
      await page.screenshot({ path: path.join(output, `${phase}-${name}.png`) });
      results.push(`${name}: (${x}, ${y}), zoom ${zoom}, daylight, DPR 1`);
    }
    // Canvas-only contact sheets exercise the actual sprite routine on three backgrounds.
    for (const kind of ['village', 'scenery']) {
      await page.evaluate(kind => {
        const r = reviewRenderer, canvas = document.createElement('canvas'); canvas.id = 'review-sheet';
        canvas.width = 1440; canvas.height = 780; canvas.style = 'position:fixed;inset:0;z-index:100;background:#171a20';
        document.body.append(canvas); const c = canvas.getContext('2d');
        const atlas = kind === 'village' ? r.atlas : r.sceneryAtlas;
        for (let i = 0; i < 8; i++) for (let b = 0; b < 3; b++) {
          const x = (i % 4) * 360 + b * 120, y = Math.floor(i / 4) * 390;
          c.fillStyle = ['#171a20', '#647d53', '#e8ecf2'][b]; c.fillRect(x, y, 120, 390);
          c.save(); c.translate(x + 60, y + 40);
          CommonsRenderer.prototype.sprite.call({ ...r, ctx: c }, i, 0, 160, 115, 115, atlas);
          c.scale(1.9, 1.9);
          CommonsRenderer.prototype.sprite.call({ ...r, ctx: c }, i, 0, 180, 60, 60, atlas);
          c.restore(); c.fillStyle = '#ffc247'; c.font = '12px sans-serif'; c.fillText(`${kind} ${i}`, x + 10, y + 20);
        }
      }, kind);
      await page.locator('#review-sheet').screenshot({ path: path.join(output, `${phase}-sprites-${kind}.png`) });
      await page.evaluate(() => document.getElementById('review-sheet').remove());
    }
    if (phase === 'after') {
      // Start outside each basin, then use real keyboard -> socket -> simulation movement.
      const approaches = [];
      for (const [index, name] of [[0, 'fountain'], [1, 'pond']]) {
        const shape = World.groundShape(World.scenery[index]);
        for (const [dx, dy, keys] of [[0,-1,['s']], [0,1,['w']], [-1,0,['d']], [1,0,['a']],
          [-1,-1,['d','s']], [1,-1,['a','s']], [-1,1,['d','w']], [1,1,['a','w']]]) {
          const length = Math.hypot(dx, dy), x = shape.x + dx / length * shape.rx * 1.30, y = shape.y + dy / length * shape.ry * 1.30;
          assert(World.walkable(x, y), `${name} approach starts clear`);
          Object.assign(player(), { x, y, scene: 'village' });
          await page.evaluate(() => { reviewRenderer.scale = 1.5; reviewRenderer.camera = null; document.getElementById('world').focus(); });
          await page.waitForTimeout(150);
          for (const key of keys) await page.keyboard.down(key);
          for (let tick = 0; tick < 8; tick++) {
            await page.waitForTimeout(100); assert(World.walkable(player().x, player().y), `${name} moving player stays outside ground`);
          }
          for (const key of keys) await page.keyboard.up(key);
          await page.waitForTimeout(150);
          assert(Math.hypot(player().x - x, player().y - y) > .02, `${name} keyboard approach moved`);
          approaches.push({ name, direction: [dx,dy], start: [x,y], stopped: [player().x,player().y] });
          if (dx === 0) await page.screenshot({ path: path.join(output, `after-${name}-${dy < 0 ? 'north' : 'south'}-approach.png`) });
        }
      }
      results.push({ authoritativeApproaches: approaches });
      // Diagnostic overlays exist only in this runner, never in the shipped UI.
      await page.evaluate(() => {
        const r = reviewRenderer, original = r.frame;
        r.frame = function(t) {
          original(t);
          if (!r.reviewDiagnostics) return;
          const c = r.ctx; c.save(); c.lineWidth = 1.5 / r.drawScale;
          for (const shape of CommonsWorld.obstacles) {
            c.strokeStyle = '#ff4d4f'; c.beginPath();
            if (shape.type === 'ellipse') c.ellipse(shape.x * 32, shape.y * 32, shape.rx * 32, shape.ry * 32, 0, 0, Math.PI * 2);
            else c.rect((shape.x + shape.left) * 32, (shape.y + shape.top) * 32, (shape.right - shape.left) * 32, (shape.bottom - shape.top) * 32);
            c.stroke();
          }
          for (const item of [...CommonsWorld.scenery, ...CommonsWorld.locations.filter(l => l.sprite < 6)]) {
            const size = item.width || (item.id === 'hall' ? 188 : 146), bottom = item.width ? 6 : 8;
            c.strokeStyle = '#19e3e3'; c.strokeRect(item.x * 32 - size / 2, item.y * 32 + bottom - size, size, size);
            c.fillStyle = '#ffc247'; c.fillRect(item.x * 32 - 2, item.y * 32 - 2, 4, 4);
          }
          c.restore();
        };
        r.reviewDiagnostics = true;
      });
      for (const [name,x,y] of [['pond',51,34.8],['fountain',32,29.5],['hall',32,18]]) {
        Object.assign(player(),{x,y}); await page.waitForTimeout(220);
        await page.screenshot({path:path.join(output,`after-${name}-geometry.png`)});
      }
      await page.evaluate(() => { reviewRenderer.reviewDiagnostics = false; });
      player().lantern = true; player().discoveries = ['stone-0','stone-1','stone-2'];
      await page.waitForTimeout(180); assert((await page.locator('#quest-guidance').textContent()).includes('Return to your cottage'));
      player().decorated = true; await page.waitForTimeout(180);
      assert((await page.locator('#quest-guidance').textContent()).includes('Your lantern is at home'));
      await page.screenshot({path:path.join(output,'after-completed-guidance.png')});
      results.push('Both lantern-made and decorated guidance match persisted progress');
      Object.assign(player(), { x: 50, y: 35 }); await page.waitForTimeout(180);
      const disabled = await page.locator('#interact').evaluate(button => ({ disabled: button.disabled, text: button.textContent, color: getComputedStyle(button).backgroundColor }));
      assert(disabled.disabled && disabled.text === 'Nothing in reach' && disabled.color === 'rgb(27, 32, 38)');
      results.push('Empty interaction has disabled semantics, explanatory text and Graphite background');
      // Same real session, resized/reloaded in independent DPR/touch contexts; takeover is intentional.
      const matrix = [];
      for (const [name, viewport, mobile] of [['desktop',{width:1440,height:1000},false], ['portrait',{width:390,height:844},true], ['landscape',{width:844,height:390},true]]) {
        for (const dpr of [1,2]) {
          const testContext = await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:dpr,storageState:await context.storageState()});
          await testContext.addInitScript(() => {
            Object.defineProperty(window,'CommonsRenderer',{configurable:true,set(Renderer){
              Object.defineProperty(window,'CommonsRenderer',{value:class extends Renderer{constructor(...args){super(...args);window.reviewRenderer=this;}}});
            }});
          });
          const testPage = await testContext.newPage(); testPage.on('pageerror',e=>errors.push(e.message));
          await testPage.goto(preview.url+'/commons'); await testPage.waitForFunction(()=>!document.getElementById('enter').disabled);
          await testPage.click('#enter'); await testPage.waitForFunction(()=>document.getElementById('cover').hidden);
          // join persists a cloned state; fetch the current fixture again after each takeover.
          Object.assign(preview.room.state.players[0], {x:51,y:34.8});
          for(const zoom of [.5,1,1.5]) for(const darkness of [0,.4]) for(const reducedMotion of [false,true]) {
            await testPage.emulateMedia({reducedMotion:reducedMotion?'reduce':'no-preference'});
            await testPage.evaluate(({zoom,darkness,reducedMotion})=>{
              reviewRenderer.scale=zoom;reviewRenderer.reducedMotion=reducedMotion;reviewRenderer.camera=null;
              const clock=CommonsWorld.clock;CommonsWorld.clock=now=>({...clock(now),darkness,phase:darkness?'Night':'Daylight',time:darkness?'22:00':'09:18'});
              document.getElementById('toast').classList.remove('visible');
            },{zoom,darkness,reducedMotion});
            await testPage.waitForTimeout(120);
            const check=await testPage.evaluate(()=>{const r=reviewRenderer,c=document.getElementById('world'),b=c.getBoundingClientRect();return {
              width:c.width,height:c.height,expectedWidth:Math.round(b.width*devicePixelRatio),expectedHeight:Math.round(b.height*devicePixelRatio),overflow:document.documentElement.scrollWidth>innerWidth,
              camera:[r.camera.x,r.camera.y], player:[r.state.self.x,r.state.self.y],scale:r.scale,
            };});
            assert.equal(check.width,check.expectedWidth);assert.equal(check.height,check.expectedHeight);assert(!check.overflow);
            matrix.push({name,dpr,zoom,darkness,reducedMotion,...check});
            if(dpr===2 && reducedMotion && (zoom===.5 || zoom===1.5)) await testPage.screenshot({path:path.join(output,`after-${name}-dpr${dpr}-zoom${zoom}-${darkness?'night':'day'}.png`)});
          }
          // All four map corners at every zoom; camera stays bounded or centers the whole map.
          for(const zoom of [.5,1,1.5]) for(const [x,y] of [[1,1],[63,1],[1,47],[63,47]]) {
            Object.assign(preview.room.state.players[0],World.repairPosition({x,y,scene:'village'})||{x,y});
            await testPage.evaluate(scale=>{reviewRenderer.scale=scale;reviewRenderer.camera=null;reviewRenderer.reducedMotion=true;},zoom);
            await testPage.waitForTimeout(120);
            assert(await testPage.evaluate(()=>{
              const r=reviewRenderer,W=CommonsWorld;
              return [[r.camera.x,W.WIDTH*32,r.width/r.scale],[r.camera.y,W.HEIGHT*32,r.height/r.scale]].every(([value,size,visible])=>
                visible>=size?Math.abs(value-size/2)<.01:value>=visible/2-.01&&value<=size-visible/2+.01);
            }));
          }
          await testContext.close();
        }
      }
      results.push({responsiveMatrix:matrix}, '72 camera edge/zoom/context cases bounded or centered');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, `${phase}-results.json`), JSON.stringify({ phase, environment: 'Synthetic HTTP/session/socket; in-memory repository; headless Chromium; no real Mongo or physical device', results, errors }, null, 2) + '\n');
    console.log(`${phase}: 9 matched views and both atlas sheets captured; ${results.length} result groups`);
  } finally { await browser.close(); await preview.stop(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
