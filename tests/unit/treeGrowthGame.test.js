const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const {
  Simulation, properties, ageFromTimeline, timelineFromAge, speedFromSlider, sliderFromSpeed,
  MAX_AGE, MIN_SPEED, MAX_SPEED, random, branchBirth, branchGrowth, GrowthFraming,
} = require('../../games/tree-growth/js/model');

const gameRoot = path.join(__dirname, '../../games/tree-growth');
const read = file => fs.readFileSync(path.join(gameRoot, file), 'utf8');

describe('Seed to Sky growth model', () => {
  test('starts as a paused seed and reaches an ancient giant through ordinary playback', () => {
    const sim = new Simulation();
    expect(sim.tree).toMatchObject({ age: 0, height: 0, diameter: 0, carbon: 0, stage: 'Seed' });
    sim.tick(.1);
    expect(sim.age).toBe(0);
    sim.toggle();
    sim.tick(.1);
    expect(sim.tree.stage).toBe('Seedling');
    sim.setSpeed(MAX_SPEED);
    for (let i = 0; i < 160; i++) sim.tick(.1);
    expect(sim.age).toBe(MAX_AGE);
    expect(sim.tree.stage).toBe('Ancient giant');
    expect(sim.tree.height).toBeGreaterThan(90);
    expect(sim.tree.diameter).toBeGreaterThan(9);
    expect(sim.playing).toBe(false);
    expect(sim.toggle()).toBe(false);
  });

  test('time is frame-rate independent within the bounded time step', () => {
    const simulate = fps => {
      const sim = new Simulation(); sim.toggle(); sim.setSpeed(17);
      for (let i = 0; i < fps * 10; i++) sim.tick(1 / fps);
      return sim.age;
    };
    expect(simulate(30)).toBeCloseTo(170, 8);
    expect(simulate(60)).toBeCloseTo(simulate(144), 8);
  });

  test('pause, live speed changes, seek, and reset preserve their intended behavior', () => {
    const sim = new Simulation();
    sim.toggle(); sim.tick(.1); sim.setSpeed(10); sim.tick(.1);
    expect(sim.age).toBeCloseTo(1.1);
    sim.toggle(); sim.tick(.1); expect(sim.age).toBeCloseTo(1.1);
    sim.setAge(500); expect(sim.tree.stage).toBe('Mature tree');
    sim.setSpeed(.1); sim.toggle(); sim.tick(.1);
    expect(sim.age).toBeCloseTo(500.01);
    sim.reset(); expect(sim.age).toBe(0); expect(sim.playing).toBe(false); expect(sim.speed).toBe(.1);
  });

  test('background tabs do not advance, and delayed or invalid frames cannot jump centuries', () => {
    const sim = new Simulation(); sim.toggle(); sim.setSpeed(MAX_SPEED);
    sim.tick(500, true); expect(sim.age).toBe(0);
    for (const value of [-1, NaN, Infinity, -Infinity, '100', null, {}]) sim.tick(value);
    expect(sim.age).toBe(0);
    sim.tick(500); expect(sim.age).toBe(20);
  });

  test('rejects nonnumeric inputs and clamps excessive numeric values before simulation work', () => {
    const sim = new Simulation(); sim.setAge(42); sim.setSpeed(3);
    for (const value of [NaN, Infinity, -Infinity, null, undefined, {}, [], '100', '<script>alert(1)</script>']) {
      sim.setAge(value); sim.setSpeed(value);
      expect(sim.age).toBe(42); expect(sim.speed).toBe(3);
      const tree = properties(value);
      expect(tree.age).toBe(0);
      Object.values(tree).filter(v => typeof v === 'number').forEach(v => expect(Number.isFinite(v)).toBe(true));
    }
    sim.setAge(-100); expect(sim.age).toBe(0);
    sim.setAge(1e300); expect(sim.age).toBe(MAX_AGE);
    sim.setSpeed(-100); expect(sim.speed).toBe(MIN_SPEED);
    sim.setSpeed(1e300); expect(sim.speed).toBe(MAX_SPEED);
  });

  test('height, trunk, and stored carbon grow continuously and stay physically bounded', () => {
    let previous = properties(0);
    for (let age = .1; age <= MAX_AGE; age += .7) {
      const tree = properties(age);
      expect(tree.height).toBeGreaterThanOrEqual(previous.height);
      expect(tree.diameter).toBeGreaterThanOrEqual(previous.diameter);
      expect(tree.carbon).toBeGreaterThanOrEqual(previous.carbon);
      expect(tree.height).toBeLessThanOrEqual(92);
      expect(tree.diameter).toBeLessThan(11);
      expect(tree.crownSpan).toBeLessThan(tree.height);
      expect(tree.growthRate).toBeGreaterThanOrEqual(0);
      previous = tree;
    }
    expect(properties(3000).growthRate).toBeLessThan(properties(50).growthRate);
    expect(properties(3000).crownBase).toBeGreaterThan(properties(5).crownBase);
  });

  test('timeline and continuous speed mappings round-trip at all life stages and endpoints', () => {
    for (const age of [0, .02, .1, 1, 5, 50, 500, 1200, 3000]) expect(ageFromTimeline(timelineFromAge(age))).toBeCloseTo(age, 8);
    for (const speed of [.1, .25, 1, 10, 50, 200]) expect(speedFromSlider(sliderFromSpeed(speed))).toBeCloseTo(speed, 8);
    expect(ageFromTimeline(-1)).toBe(0);
    expect(ageFromTimeline(100)).toBeCloseTo(MAX_AGE);
    expect(speedFromSlider(Infinity)).toBe(MIN_SPEED);
    expect(speedFromSlider(100)).toBe(MAX_SPEED);
  });

  test('old trees still add meaningful height and girth across the remaining lifetime', () => {
    const mature = properties(500), ancient = properties(1500), final = properties(MAX_AGE);
    expect(ancient.height).toBeGreaterThan(mature.height * 1.3);
    expect(final.height).toBeGreaterThan(ancient.height * 1.15);
    expect(final.diameter).toBeGreaterThan(ancient.diameter * 1.2);
  });

  test('new branches emerge throughout life from fixed points below the growing leader', () => {
    const births = Array.from({ length: 120 }, (_, i) => branchBirth(i, 120));
    for (const [from, to] of [[0, 5], [5, 50], [50, 500], [500, 1500], [1500, MAX_AGE]]) {
      expect(births.some(birth => birth.age > from && birth.age < to)).toBe(true);
    }
    births.forEach(birth => {
      expect(birth.height).toBeLessThan(properties(birth.age).height);
      const attachmentHeight = birth.height;
      expect(branchGrowth(birth, birth.age - .01)).toBe(0);
      expect(branchGrowth(birth, birth.age)).toBe(0);
      const shoot = branchGrowth(birth, birth.age + 1);
      expect(shoot).toBeGreaterThan(0);
      expect(shoot).toBeLessThan(branchGrowth(birth, birth.age + 20));
      expect(branchGrowth(birth, MAX_AGE)).toBeLessThanOrEqual(1);
      expect(birth.height).toBe(attachmentHeight);
    });
  });

  test('camera holds its position while the tree grows, and only reframes at its boundary', () => {
    const camera = new GrowthFraming();
    camera.update(properties(50).height);
    const before = { span: camera.span, focus: camera.focus };
    for (let age = 51; age <= 100; age++) camera.update(properties(age).height);
    expect({ span: camera.span, focus: camera.focus }).toEqual(before);
    camera.update(properties(300).height);
    expect(camera.span).toBeGreaterThan(before.span);
    const matureSpan = camera.span;
    camera.update(properties(5).height);
    expect(camera.span).toBeLessThan(matureSpan);
    camera.fit(0);
    expect(camera.span).toBeLessThan(.02);
    expect(camera.focus).toBeLessThan(.003);
  });

  test('locked framing survives growth and scrubbing until Fit releases it', () => {
    const camera = new GrowthFraming();
    camera.update(properties(500).height);
    camera.locked = true;
    const held = { span: camera.span, focus: camera.focus };
    for (const age of [3000, 0, 1500]) {
      camera.update(properties(age).height);
      expect({ span: camera.span, focus: camera.focus }).toEqual(held);
    }
    camera.fit(properties(3000).height);
    expect(camera.locked).toBe(false);
    expect(camera.span).toBeGreaterThan(properties(3000).height);
  });

  test('procedural randomness is reproducible and bounded', () => {
    const a = random(42), b = random(42), c = random(43);
    const aa = Array.from({ length: 200 }, a), bb = Array.from({ length: 200 }, b);
    expect(aa).toEqual(bb);
    expect(aa).not.toEqual(Array.from({ length: 200 }, c));
    aa.forEach(n => { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(1); });
  });

  test('the same model is available in the standalone browser without a build tool', () => {
    const context = { window: {} }; vm.runInNewContext(read('js/model.js'), context);
    const sim = new context.window.TreeGrowth.Simulation();
    sim.setAge(500);
    expect(sim.tree.height).toBeCloseTo(properties(500).height);
  });
});

describe('Seed to Sky public asset and rendering boundaries', () => {
  test('all executable and stylesheet entry points are relative local files with no inline code', () => {
    const html = read('index.html');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g)];
    expect(scripts).toHaveLength(2);
    for (const [, src] of scripts) { expect(src).not.toMatch(/^(https?:|\/|data:)/); expect(fs.existsSync(path.join(gameRoot, src))).toBe(true); }
    expect(html).not.toMatch(/\son\w+=|javascript:|<iframe/i);
    expect(html).toContain('css/color-theme.css');
    expect(read('css/color-theme.css')).toBe(fs.readFileSync(path.join(__dirname, '../../public/css/color-theme.css'), 'utf8'));
    for (const source of [read('js/app.js'), read('js/model.js'), read('js/renderer.mjs')]) {
      expect(source).not.toMatch(/innerHTML|document\.cookie|localStorage|sessionStorage|\beval\(|new Function|\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });

  test('the bundled renderer and license exactly match the existing repository dependency', () => {
    const { version } = require('../../node_modules/three/package.json');
    expect(read('vendor/README.md')).toContain(`three@${version}`);
    const records = read('vendor/SHA256SUMS').trim().split('\n');
    expect(records).toHaveLength(3);
    records.forEach(record => {
      const [hash, file] = record.split(/\s+/);
      const data = fs.readFileSync(path.join(gameRoot, 'vendor', file));
      expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(hash);
      const original = file === 'THREE-LICENSE.txt' ? 'LICENSE' : `build/${file}`;
      expect(data.equals(fs.readFileSync(path.join(__dirname, '../../node_modules/three', original)))).toBe(true);
    });
  });
});
