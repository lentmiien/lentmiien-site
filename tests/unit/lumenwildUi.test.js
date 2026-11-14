const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../../games/lumenwild/js/core');
const fixture = require('../fixtures/lumenwild/version-one.json');
const root = path.resolve(__dirname, '../../games/lumenwild');

// DOM interaction checks exercise shipped scripts and the actual renderer with
// a nonvisual Canvas context. This is not a substitute for browser layout QA.
async function mount(saved) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'https://lumenwild.test/lumenwild/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, timers = new Map(); let now = 0, serial = 0, raf = [];
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 1000, height: 600 });
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
    return (...args) => { args.filter(a => typeof a === 'number').forEach(a => { if (!Number.isFinite(a)) throw new Error(`Invalid Canvas coordinate: ${key}`); }); };
  } });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Image = class { set src(value) { this.path = value; Promise.resolve().then(() => { if (fs.existsSync(path.join(root, value))) this.onload?.(); else this.onerror?.(); }); } };
  w.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.requestAnimationFrame = fn => { raf.push(fn); return ++serial; };
  w.performance.now = () => now;
  if (saved) w.localStorage.setItem(C.SAVE_KEY, JSON.stringify(saved));
  for (const file of ['content.js', 'world.js', 'engine.js', 'core.js', 'render.js']) w.eval(fs.readFileSync(path.join(root, 'js', file), 'utf8'));
  let game = null;
  const create = w.Lumenwild.createExpedition, read = w.Lumenwild.readSave;
  w.Lumenwild.createExpedition = (...args) => { game = create(...args); return game; };
  w.Lumenwild.readSave = (...args) => { const data = read(...args); game = data.game; return data; };
  w.eval(fs.readFileSync(path.join(root, 'js/game.js'), 'utf8'));
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  const frame = seconds => {
    for (let i = 0; i < Math.ceil(seconds / .05); i += 1) {
      now += 50; const callbacks = raf; raf = []; callbacks.forEach(fn => fn(now));
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  };
  const click = selector => w.document.querySelector(selector).click();
  const key = code => w.dispatchEvent(new w.KeyboardEvent('keydown', { code, bubbles: true }));
  return { w, frame, click, key, get game() { return game; }, close() { timers.clear(); raf = []; dom.window.close(); } };
}

describe('Lumenwild expanded browser interface', () => {
  let ui;
  afterEach(() => ui?.close());

  test('fresh camp loads all artwork and exposes atlas chapters, 54 journal pages and 27 workshop levels', async () => {
    ui = await mount();
    expect(ui.w.document.querySelector('#loadStatus').textContent).toContain('Ready when you are');
    expect(ui.w.document.querySelector('#mainAction').disabled).toBe(false);
    ui.click('#journeysButton'); expect(ui.w.document.querySelectorAll('[data-region]')).toHaveLength(9);
    expect(ui.w.document.querySelector('[data-trail="frontier"]').disabled).toBe(true);
    ui.click('#closeDialog'); ui.click('#journalButton');
    expect(ui.w.document.querySelectorAll('.journal-entry')).toHaveLength(54); expect(ui.w.document.querySelectorAll('.relic-card')).toHaveLength(27);
    ui.click('#closeDialog'); ui.click('#workshopButton');
    expect(ui.w.document.querySelectorAll('[data-upgrade]')).toHaveLength(5); expect(ui.w.document.querySelectorAll('[data-art]')).toHaveLength(6);
    expect(ui.w.document.querySelector('[data-art="gust"]').disabled).toBe(false);
  });

  test('real-time damage continues while idle, ordinary attack does not interrupt, and all dialogs pause the simulation', async () => {
    ui = await mount(); ui.click('#mainAction'); ui.click('#dialogActions button');
    const game = ui.game, enemy = { ...game.map.enemies[0], x: 4, y: 3, hp: 3, kind: 0, rest: 0 };
    game.map.enemies = [enemy]; game.shield = 0;
    ui.frame(.1); ui.key('Space'); expect(enemy.hp).toBe(2); expect(enemy.windup).toBeGreaterThan(0);
    ui.key('KeyM'); const before = JSON.stringify(game.snapshot()); ui.frame(3);
    expect(JSON.stringify(game.snapshot())).toBe(before);
    ui.key('KeyM'); ui.frame(.9); expect(game.player.hp).toBe(6);
    ui.w.dispatchEvent(new ui.w.Event('blur')); const paused = game.elapsed; ui.frame(3); expect(game.elapsed).toBe(paused);
    expect(ui.w.document.querySelector('#dialogTitle').textContent).toBe('The garden can wait.');
  });

  test('v1 camp can select the new frontier, bank the old run, and open a new region with the correct HUD', async () => {
    ui = await mount(fixture.save); ui.click('#journeysButton');
    expect(ui.w.document.querySelector('[data-trail="frontier"]').disabled).toBe(false);
    ui.click('[data-trail="frontier"]'); ui.click('#mainAction');
    expect(ui.w.document.querySelector('#dialogTitle').textContent).toBe('Bring this expedition home?');
    ui.click('#dialogActions button'); ui.frame(.1);
    expect(ui.game.region).toBe(3); expect(ui.game.journey).toEqual([3, 4, 5]);
    expect(ui.w.document.querySelector('#regionName').textContent).toBe('Tideweave Marsh');
    ui.key('KeyR'); expect(ui.game.focus).toBeLessThan(2);
    ui.key('KeyG'); expect(ui.game.guardTime).toBeGreaterThan(0);
    expect(ui.w.document.querySelectorAll('.action-deck button')).toHaveLength(10);
  });

  test('workshop upgrades and art selection persist; ongoing journeys keep their original kit', async () => {
    const profile = C.profile({ light: 300, relics: [0, 1, 2] });
    const game = new C.Game({ seed: 3 });
    ui = await mount(JSON.parse(C.writeSave(profile, game)));
    ui.click('#workshopButton'); ui.click('[data-upgrade="hearth"]'); ui.click('[data-art="snare"]');
    const saved = JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY));
    expect(saved.profile.upgrades.hearth).toBe(1); expect(saved.profile.light).toBe(282); expect(saved.profile.selectedArt).toBe('snare');
    expect(saved.run.upgrades.hearth).toBe(0); expect(saved.run.art).toBe('gust');
  });

  test('arts explain insufficient focus capacity, and upgrading the well makes them equippable', async () => {
    const profile = C.profile({ light: 500 }); profile.regions[6].clears = 1;
    ui = await mount({ version: 2, profile, run: null }); ui.click('#workshopButton');
    const card = ui.w.document.querySelector('[data-art="mend"]');
    expect(card.disabled).toBe(true); expect(card.textContent).toContain('Needs 4 focus capacity');
    ui.click('[data-upgrade="focus"]'); expect(ui.w.document.querySelector('[data-art="mend"]').disabled).toBe(false);
    ui.click('[data-art="mend"]');
    expect(JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY)).profile.selectedArt).toBe('mend');
  });

  test('regional visits, early return, and chapter endings bank once without replaying the result', async () => {
    ui = await mount({ version: 2, profile: C.profile({ runs: 1 }), run: null });
    ui.click('#journeysButton'); ui.click('[data-region="0"]'); ui.click('#dialogActions button');
    expect(ui.game.trail).toBe('survey');
    ui.game.light = 12; ui.key('Escape');
    [...ui.w.document.querySelectorAll('#dialogActions button')].find(b => b.textContent.includes('Finish early')).click();
    ui.frame(1);
    const saved = JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY));
    expect(saved.profile.light).toBe(12); expect(saved.run).toBeNull(); expect(saved.profile.runs).toBe(2);
    ui.frame(1); expect(JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY)).profile.light).toBe(12);
  });

  test('renderer handles all nine maps, relics, landmarks, warnings and vents without invalid drawing coordinates', async () => {
    ui = await mount();
    const Renderer = ui.w.LumenwildRenderer;
    const render = new Renderer(ui.w.document.querySelector('#world'), ui.w.document.querySelector('#minimap'));
    try {
      await render.load(() => {});
      for (let region = 0; region < 9; region += 1) {
        const game = new C.Game({ seed: 193, trail: 'survey', region });
        game.seen = new Set(game.map.tiles.map((_, i) => i)); game.visible = new Set(game.seen);
        game.map.enemies[0].intent = [{ x: 3, y: 3 }]; game.map.enemies[0].windup = .2; game.map.enemies[0].windupTotal = 1;
        render.draw(game, 1, .05); render.drawMap(game, ui.w.document.querySelector('#minimap'), true);
        game.phase = 1; render.draw(game, 1.1, .05);
      }
    } finally { render.observer.disconnect(); }
  });
});
