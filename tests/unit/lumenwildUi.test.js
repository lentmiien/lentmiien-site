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
  for (const file of ['content.js', 'world-v2.js', 'world.js', 'engine.js', 'guardians.js', 'core.js', 'render.js']) w.eval(fs.readFileSync(path.join(root, 'js', file), 'utf8'));
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

  test('fresh camp loads all artwork and exposes atlas chapters, 126 journal pages and 27 workshop levels', async () => {
    ui = await mount();
    expect(ui.w.document.querySelector('#loadStatus').textContent).toContain('Ready when you are');
    expect(ui.w.document.querySelector('#mainAction').disabled).toBe(false);
    ui.click('#journeysButton'); expect(ui.w.document.querySelectorAll('[data-region]')).toHaveLength(21);
    expect(ui.w.document.querySelector('[data-trail="frontier"]').disabled).toBe(true);
    ui.click('#closeDialog'); ui.click('#journalButton');
    expect(ui.w.document.querySelectorAll('.journal-entry')).toHaveLength(126); expect(ui.w.document.querySelectorAll('.relic-card')).toHaveLength(63);
    ui.click('#closeDialog'); ui.click('#workshopButton');
    expect(ui.w.document.querySelectorAll('[data-upgrade]')).toHaveLength(5); expect(ui.w.document.querySelectorAll('[data-art]')).toHaveLength(12);
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

  test('renderer handles all twenty-one maps, relics, landmarks, warnings and vents without invalid drawing coordinates', async () => {
    ui = await mount();
    const Renderer = ui.w.LumenwildRenderer;
    const render = new Renderer(ui.w.document.querySelector('#world'), ui.w.document.querySelector('#minimap'));
    try {
      await render.load(() => {});
      for (let region = 0; region < C.BIOMES.length; region += 1) {
        const game = new C.Game({ seed: 193, trail: 'survey', region });
        game.seen = new Set(game.map.tiles.map((_, i) => i)); game.visible = new Set(game.seen);
        game.map.enemies[0].intent = [{ x: 3, y: 3 }]; game.map.enemies[0].windup = .2; game.map.enemies[0].windupTotal = 1;
        render.draw(game, 1, .05); render.drawMap(game, ui.w.document.querySelector('#minimap'), true);
        game.phase = 1; render.draw(game, 1.1, .05);
      }
    } finally { render.observer.disconnect(); }
  });

  test('an unlocked trial opens its introduction, runs the boss HUD, pauses exactly, and allows a safe retreat', async () => {
    const profile = C.profile({ runs: 1, guardians: { bellkeeper: 1 } });
    ui = await mount(JSON.parse(C.writeSave(profile, null)));
    ui.click('#journeysButton'); expect(ui.w.document.querySelector('[data-guardian="bellkeeper"]').disabled).toBe(false);
    expect(ui.w.document.querySelector('[data-guardian="tempest"]').disabled).toBe(true);
    ui.click('[data-guardian="bellkeeper"]');
    const options = [...ui.w.document.querySelectorAll('#dialogActions button')];
    expect(options[2].disabled).toBe(true); options[0].click();
    expect(ui.game.trail).toBe('trial');
    Object.assign(ui.game.player, ui.game.map.arena.entry);
    ui.key('KeyE'); expect(ui.w.document.querySelector('#dialogTitle').textContent).toBe('The Bellkeeper');
    ui.click('#dialogActions button'); ui.frame(1.6);
    expect(ui.game.boss.state).toBe('active'); expect(ui.w.document.querySelector('#guardianHud').hidden).toBe(false);
    expect(ui.w.document.querySelector('#guardianPattern').textContent).toContain('Tolling lanes');
    ui.key('Escape'); const saved = JSON.stringify(ui.game.snapshot()); ui.frame(2);
    expect(JSON.stringify(ui.game.snapshot())).toBe(saved);
    [...ui.w.document.querySelectorAll('#dialogActions button')].find(b => b.textContent.includes('Leave the arena')).click();
    expect(ui.game.boss.state).toBe('sleeping'); expect(ui.w.document.querySelector('#guardianHud').hidden).toBe(true);
  });

  test('the wayfarer opens real purchase controls and an unaffordable purchase is disabled', async () => {
    ui = await mount({ version: 3, profile: C.profile({ runs: 1 }), run: null }); ui.click('#mainAction');
    const trader = ui.game.map.entities.find(e => e.type === 'trader'); Object.assign(ui.game.player, { x: trader.x, y: trader.y });
    ui.key('KeyE'); expect(ui.w.document.querySelector('#dialogTitle').textContent).toBe('A little help along the path.');
    expect(ui.w.document.querySelector('#dialogActions button').disabled).toBe(true);
    ui.click('#closeDialog'); ui.game.light = 8; ui.key('KeyE');
    [...ui.w.document.querySelectorAll('#dialogActions button')].find(b => b.textContent.startsWith('Trail supplies')).click();
    expect(ui.game.inventory.bomb).toBe(4); expect(ui.game.light).toBe(0); expect(trader.done).toBe(true);
  });

  test('guardian gifts and the firefly charm persist as a chosen loadout without changing an active run', async () => {
    const profile = C.profile({ runs: 1, rescues: 3, guardians: { bellkeeper: 1, tempest: 1, dawnhart: 1 } });
    const game = new C.Game({ seed: 3 });
    ui = await mount(JSON.parse(C.writeSave(profile, game))); ui.click('#workshopButton');
    expect(ui.w.document.querySelectorAll('[data-charm]')).toHaveLength(8);
    ui.click('[data-charm="feather"]'); ui.click('[data-art="tide"]');
    const stored = JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY));
    expect(stored.profile.selectedCharm).toBe('feather'); expect(stored.profile.selectedArt).toBe('tide');
    expect(stored.run.charm).toBe('none'); expect(stored.run.art).toBe('gust');
    ui.click('[data-charm="firefly"]'); ui.click('[data-art="dawn"]');
    expect(JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY)).profile.selectedArt).toBe('dawn');
    ui.click('[data-charm="none"]');
    expect(JSON.parse(ui.w.localStorage.getItem(C.SAVE_KEY)).profile.selectedArt).toBe('gust');
    expect(ui.w.document.querySelector('[data-art="dawn"]').disabled).toBe(true);
  });

  test('new chapters, realm vaults, and wishbed progress are exposed through the shipped interface', async () => {
    const profile = C.profile({ runs: 1, trails: { aurora: 1 }, vaults: [15] });
    ui = await mount(JSON.parse(C.writeSave(profile, null))); ui.click('#journeysButton');
    expect(ui.w.document.querySelector('[data-trail="seasons"]').disabled).toBe(false);
    expect(ui.w.document.querySelector('[data-trail="unwritten"]').disabled).toBe(true);
    expect(ui.w.document.querySelector('.vault-progress').textContent).toContain('1 / 6');
    ui.click('[data-region="15"]'); ui.click('#dialogActions button');
    const game = ui.game; game.map.enemies.forEach(e => { e.hp = 0; });
    const bed = game.map.entities.find(e => e.type === 'wishbed'); game.light = 4; game.player.x = bed.x; game.player.y = bed.y;
    ui.key('KeyE'); expect(bed.progress).toBe(0); expect(ui.w.document.querySelector('#regionQuest').textContent).toContain('Wishbed 0/24');
    for (const key of game.map.entities.filter(e => e.type === 'vaultkey')) { game.player.x = key.x; game.player.y = key.y; game.phase = key.phase; game.collect(); }
    const vault = game.map.entities.find(e => e.type === 'vault'); game.player.x = vault.x; game.player.y = vault.y;
    ui.key('KeyE'); expect(vault.done).toBe(true); expect(ui.w.document.querySelector('#regionQuest').textContent).toContain('Vault opened');
  });

  test('a new guardian shows the second strike and realm preview, then the recovery window', async () => {
    const profile = C.profile({ runs: 1, guardians: { resonantwarden: 1 } });
    ui = await mount(JSON.parse(C.writeSave(profile, null))); ui.click('#journeysButton'); ui.click('[data-guardian="resonantwarden"]'); ui.click('[data-trial-tier="1"]');
    const game = ui.game; Object.assign(game.player, game.map.arena.entry); ui.key('KeyE');
    expect(ui.w.document.querySelector('#dialogBody').textContent).toContain('Wait for both strikes');
    ui.click('#dialogActions button'); ui.frame(1.6);
    expect(ui.w.document.querySelector('#guardianPattern').textContent).toContain('1/2');
    expect(ui.w.document.querySelector('#guardianSequence').textContent).toContain('dotted 2');
    ui.frame(game.boss.timer + .05); expect(ui.w.document.querySelector('#guardianPattern').textContent).toContain('2/2');
    ui.frame(game.boss.timer + .05); expect(ui.w.document.querySelector('#guardianPattern').textContent).toContain('Open heart');
  });
});
