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
test('independent face states preserve the rig across activities, and other moods fall back', async () => {
  const f = setup(); await f.adapter.setManifest(manifest);
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
  const loading = f.adapter.setManifest(manifest); await settle();
  if (action === 'mood') await f.adapter.show('concerned', 'idle');
  else if (action === 'dispose') f.adapter.dispose();
  else await jest.advanceTimersByTimeAsync(10000);
  resolve(); await loading; expect(f.rig()).toBeNull(); expect(f.still.hidden).toBe(false);
  if (action === 'mood') expect(f.still.src).toContain('concerned.webp');
  f.adapter.dispose();
});
