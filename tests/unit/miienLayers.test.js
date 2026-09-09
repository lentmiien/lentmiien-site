const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { create, validate } = require('../../public/js/miien_motion');
const manifest = require('../../public/i/miien/motion-v1.json');
let JSDOM, dom;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => { dom?.window.close(); jest.useRealTimers(); });
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function setup(decode = () => Promise.resolve()) {
  dom = new JSDOM('<main><img id="still"><p id="status"></p></main>', { pretendToBeVisual: true });
  const document = dom.window.document, still = document.querySelector('img'), status = document.querySelector('p');
  const query = { matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const connection = { saveData: false, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const adapter = create({ document, still, status, mediaQuery: query, connection, Image: class { decode() { return decode(this.src); } } });
  return { document, still, status, query, connection, adapter, rig: () => document.querySelector('.miien-rig') };
}
test('registered neutral assets are decodable, bounded, hashed and actually masked', async () => {
  expect(validate(manifest)).toBe(manifest);
  const rig = manifest.layered;
  let bytes = 0;
  for (const item of [rig.base, rig.blink, rig.mouths.small, rig.mouths.open]) {
    const data = fs.readFileSync('public' + item.src); bytes += data.length;
    expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(item.sha256);
    const metadata = await sharp(data).metadata(), stats = await sharp(data).stats();
    expect(metadata).toMatchObject({ width: item.width, height: item.height, hasAlpha: true });
    expect(stats.channels[3].min).toBe(0);
    expect(stats.channels[3].max).toBeGreaterThanOrEqual(item.src.includes('neutral-v2/mouth-') ? 200 : 254);
    expect(metadata.exif).toBeUndefined();
  }
  expect(bytes).toBeLessThan(1024 * 1024);
});
test.each([
  rig => { rig.mood = 'happy'; }, rig => { rig.width = 99999; }, rig => { rig.version = 2; },
  rig => { rig.mouths.open.src = 'https://tracker.invalid/image.webp'; },
  rig => { rig.blink.src = '/i/miien/../private.webp'; }, rig => { rig.provenance = '/private.json'; },
  rig => { rig.blink.x = -1; }, rig => { rig.blink.y = 1024; }, rig => { rig.blink.width = 0; },
  rig => { rig.base.height = 1000; }, rig => { rig.mouths.small.sha256 = 'fake'; }, rig => { rig.mouths = {}; },
])('invalid layer metadata fails closed without a request: %#', mutate => {
  const value = JSON.parse(JSON.stringify(manifest)); mutate(value.layered); expect(validate(value)).toBeNull();
});
test('legacy neutral-only manifests preserve the rig across activities, and other moods fall back', async () => {
  const f = setup(); await f.adapter.setManifest({ ...manifest, expressions: [] });
  const rig = f.rig(); expect(rig).not.toBeNull(); expect(f.still.hidden).toBe(true);
  f.adapter.mouth(2); expect([...rig.querySelectorAll('.miien-mouth')].every(i => i.hidden)).toBe(true);
  await f.adapter.show('neutral', 'speaking'); f.adapter.mouth(2);
  expect(f.rig()).toBe(rig); expect(rig.querySelectorAll('.miien-mouth')[1].hidden).toBe(false);
  await f.adapter.show('neutral', 'thinking');
  expect(f.rig()).toBe(rig); expect([...rig.querySelectorAll('.miien-mouth')].every(i => i.hidden)).toBe(true);
  await f.adapter.show('happy', 'speaking'); f.adapter.mouth(2);
  expect(f.rig()).toBeNull(); expect(f.still.hidden).toBe(false); expect(f.still.src).toContain('happy.webp');
  f.adapter.dispose();
});
test('motion off, reduced motion, save-data and suspension remove layers, including mouth patches', async () => {
  const f = setup(); await f.adapter.setManifest(manifest);
  await f.adapter.show('neutral', 'speaking'); f.adapter.mouth(1);
  await f.adapter.enable(false); expect(f.rig()).toBeNull(); expect(f.still.hidden).toBe(false);
  await f.adapter.enable(true); expect(f.rig()).not.toBeNull();
  f.query.matches = true; await f.query.addEventListener.mock.calls[0][1](); expect(f.rig()).toBeNull();
  f.query.matches = false; f.connection.saveData = true;
  await f.connection.addEventListener.mock.calls[0][1](); expect(f.rig()).toBeNull();
  f.connection.saveData = false; await f.adapter.suspend(true); expect(f.rig()).toBeNull();
  await f.adapter.suspend(false); expect(f.rig()).not.toBeNull();
  f.adapter.dispose(); expect(f.rig()).toBeNull();
  await f.adapter.show('neutral', 'speaking'); expect(f.rig()).toBeNull();
});
test('decode failures and subsequent DOM image errors expose the existing portrait', async () => {
  let broken = true;
  const f = setup(src => broken && src.includes('blink') ? Promise.reject(new Error('bad art')) : Promise.resolve());
  await f.adapter.setManifest(manifest); expect(f.rig()).toBeNull(); expect(f.status.textContent).toContain('portrait');
  broken = false; await f.adapter.show('neutral', 'idle');
  f.rig().querySelector('.miien-mouth').dispatchEvent(new dom.window.Event('error'));
  expect(f.rig()).toBeNull(); expect(f.still.hidden).toBe(false); f.adapter.dispose();
});
test.each(['mood', 'dispose', 'timeout'])('late layer decode cannot resurrect after %s', async action => {
  jest.useFakeTimers(); let resolve;
  const f = setup(src => src.includes('blink') ? new Promise(r => { resolve = r; }) : Promise.resolve());
  const loading = f.adapter.setManifest({ ...manifest, expressions: [] }); await settle();
  if (action === 'mood') await f.adapter.show('concerned', 'idle');
  else if (action === 'dispose') f.adapter.dispose();
  else await jest.advanceTimersByTimeAsync(10000);
  resolve(); await loading; expect(f.rig()).toBeNull(); expect(f.still.hidden).toBe(false);
  if (action === 'mood') expect(f.still.src).toContain('concerned.webp');
  f.adapter.dispose();
});

test.each(['happy', 'thoughtful', 'concerned', 'surprised'])('%s selects its own layers during speech and closes on activity change', async mood => {
  const f = setup(); await f.adapter.setManifest(manifest);
  await f.adapter.show('neutral', 'speaking'); f.adapter.mouth(2);
  await f.adapter.show(mood, 'speaking');
  const rig = f.rig();
  expect(rig.querySelector('.miien-base').src).toContain(`/${mood}-v1/`);
  expect(rig.parentElement.getAttribute('aria-label')).toBe(`Miien with a ${mood} expression`);
  expect(rig.querySelectorAll('.miien-mouth')[1].hidden).toBe(false);
  await f.adapter.show(mood, 'listening');
  expect(f.rig()).toBe(rig);
  expect([...rig.querySelectorAll('.miien-mouth')].every(i => i.hidden)).toBe(true);
  f.adapter.dispose();
});

test('only the selected expression loads; repeat selection reuses decoded images and history is bounded', async () => {
  const decode = jest.fn().mockResolvedValue(); const f = setup(decode);
  await f.adapter.setManifest(manifest);
  expect(decode).toHaveBeenCalledTimes(5);
  expect(decode.mock.calls.every(([src]) => src.includes('neutral'))).toBe(true);
  await f.adapter.show('happy'); await f.adapter.show('neutral');
  expect(decode).toHaveBeenCalledTimes(10);
  for (const mood of ['thoughtful', 'concerned', 'surprised', 'neutral']) await f.adapter.show(mood);
  expect(decode).toHaveBeenCalledTimes(30); // Neutral's older decoded set was evicted.
  f.adapter.dispose();
});

test('incoming layers swap atomically; obsolete errors and late decodes cannot replace the new mood', async () => {
  let resolve;
  const f = setup(src => src.includes('happy-v1/blink') ? new Promise(r => { resolve = r; }) : Promise.resolve());
  await f.adapter.setManifest(manifest);
  await f.adapter.show('neutral', 'speaking'); f.adapter.mouth(2);
  const previous = f.rig(), oldError = previous.querySelector('.miien-base').onerror;
  const loading = f.adapter.show('happy', 'speaking'); await settle();
  expect(f.rig()).toBe(previous); expect(f.still.hidden).toBe(true);
  f.adapter.mouth(1);
  expect([...previous.querySelectorAll('.miien-mouth')].every(i => i.hidden)).toBe(true);
  await f.adapter.show('surprised', 'speaking'); const current = f.rig();
  oldError(); resolve(); await loading;
  expect(f.rig()).toBe(current); expect(f.document.querySelectorAll('.miien-rig')).toHaveLength(1);
  expect(current.querySelector('.miien-base').src).toContain('surprised-v1');
  f.adapter.dispose();
});

test.each(['off', 'reduced', 'saveData', 'suspend', 'dispose', 'timeout'])('pending non-neutral rig cannot return after %s', async action => {
  jest.useFakeTimers(); let resolve;
  const f = setup(src => src.includes('happy-v1/blink') ? new Promise(r => { resolve = r; }) : Promise.resolve());
  await f.adapter.setManifest(manifest);
  const loading = f.adapter.show('happy', 'speaking'); await settle(); f.adapter.mouth(2);
  if (action === 'off') await f.adapter.enable(false);
  if (action === 'reduced') { f.query.matches = true; await f.query.addEventListener.mock.calls[0][1](); }
  if (action === 'saveData') { f.connection.saveData = true; await f.connection.addEventListener.mock.calls[0][1](); }
  if (action === 'suspend') await f.adapter.suspend(true);
  if (action === 'dispose') f.adapter.dispose();
  if (action === 'timeout') await jest.advanceTimersByTimeAsync(10000);
  resolve(); await loading;
  expect(f.rig()).toBeNull(); expect(f.still.hidden).toBe(false);
  f.adapter.dispose();
});

test('failed optional expression assets fall back and can retry with a new image', async () => {
  let broken = true;
  const decode = jest.fn(src => broken && src.includes('concerned-v1/mouth-open') ? Promise.reject(Error('missing')) : Promise.resolve());
  const f = setup(decode); await f.adapter.setManifest(manifest);
  await f.adapter.show('concerned', 'speaking');
  expect(f.rig()).toBeNull(); expect(f.still.src).toContain('concerned.webp');
  expect(f.status.textContent).toContain('layers unavailable');
  broken = false; await f.adapter.show('concerned', 'speaking');
  expect(f.rig()).not.toBeNull();
  expect(decode.mock.calls.filter(([src]) => src.includes('concerned-v1/mouth-open'))).toHaveLength(2);
  f.adapter.dispose();
});

test('a timed-out decode can retry without waiting for the abandoned image', async () => {
  jest.useFakeTimers(); let blocked = true, resolve;
  const f = setup(src => blocked && src.includes('happy-v1/blink') ? new Promise(r => { resolve = r; }) : Promise.resolve());
  await f.adapter.setManifest(manifest);
  const loading = f.adapter.show('happy'); await settle();
  await jest.advanceTimersByTimeAsync(10000);
  expect(f.rig()).toBeNull(); blocked = false;
  await f.adapter.show('happy'); const current = f.rig(); expect(current).not.toBeNull();
  resolve(); await loading; expect(f.rig()).toBe(current);
  f.adapter.dispose();
});

test.each([
  m => { m.expressions = {}; }, m => { m.expressions.push(m.expressions[0]); },
  m => { m.expressions[1].mood = 'happy'; }, m => { m.expressions[0].mood = 'neutral'; },
  m => { m.expressions[0].mood = 'angry'; }, m => { m.expressions[0].mouths.open.src = '//remote/image.webp'; },
  m => { m.expressions[0].blink.width = 10000; }, m => { m.expressions[0] = null; },
])('additional rig metadata fails closed: %#', mutate => {
  const value = JSON.parse(JSON.stringify(manifest)); mutate(value); expect(validate(value)).toBeNull();
});
