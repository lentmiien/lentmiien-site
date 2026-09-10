const fs = require('fs/promises');
const crypto = require('crypto');
const sharp = require('sharp');
const manifest = require('../../public/i/miien/motion-v1.json');
const provenance = require('../../documentation/assets/miien-expressions-v1/provenance.json');
const { moods, eyeEllipses, mouthEllipse } = require('../../scripts/build-miien-expression-assets');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
let neutral;
beforeAll(async () => { neutral = await sharp('public' + manifest.layered.base.src).raw().toBuffer(); });
test('every existing non-neutral mood has exactly one complete generated source set and rig', () => {
  expect(manifest.expressions.map(rig => rig.mood)).toEqual(manifest.stills.filter(s => s.mood !== 'neutral').map(s => s.mood));
  expect(provenance.sources).toHaveLength(16);
  for (const mood of moods) expect(provenance.sources.filter(s => s.mood === mood).map(s => s.name).sort())
    .toEqual(['blink', 'character', 'mouth-open', 'mouth-small']);
  expect(manifest.clips).toEqual([]);
  expect(JSON.stringify(manifest).length).toBeLessThan(32768);
});
test.each(moods)('%s sources and runtime layers decode with exact dimensions and hashes within budget', async mood => {
  const rig = manifest.expressions.find(r => r.mood === mood);
  let bytes = 0;
  for (const item of [rig.base, rig.blink, rig.mouths.small, rig.mouths.open]) {
    const data = await fs.readFile('public' + item.src); bytes += data.length;
    expect(hash(data)).toBe(item.sha256);
    const meta = await sharp(data).metadata();
    expect(meta).toMatchObject({ width: item.width, height: item.height, hasAlpha: true });
    expect(meta.exif).toBeUndefined();
    const stats = await sharp(data).stats(); expect(stats.channels[3].min).toBe(0);
    expect(stats.channels[3].max).toBeGreaterThan(150);
  }
  expect(bytes).toBeLessThan(1024 * 1024);
  const record = JSON.parse(await fs.readFile('public' + rig.provenance, 'utf8'));
  expect(record.assets).toEqual([rig.base, rig.blink, rig.mouths.small, rig.mouths.open]);
  for (const item of provenance.sources.filter(s => s.mood === mood)) {
    const data = await fs.readFile('documentation/assets/miien-expressions-v1/' + item.file);
    expect(hash(data)).toBe(item.sha256);
    expect(await sharp(data).metadata()).toMatchObject({ width: 264, height: 222 });
    expect(item.generatedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(item.prompt).toContain('Miien');
  }
});
test.each(moods)('%s keeps the accepted alpha, silhouette, clothing and non-feature pixels exactly', async mood => {
  const rig = manifest.expressions.find(r => r.mood === mood);
  const base = await sharp('public' + rig.base.src).raw().toBuffer();
  let alphaChanges = 0, outsideChanges = 0, featureChanges = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 768; x++) {
    const i = (y * 768 + x) * 4;
    if (base[i + 3] !== neutral[i + 3]) alphaChanges++;
    const inside = [...eyeEllipses, mouthEllipse].some(([cx, cy, rx, ry]) => Math.hypot((x - cx) / rx, (y - cy) / ry) < 1);
    for (let c = 0; c < 3; c++) if (base[i + c] !== neutral[i + c]) {
      if (inside) featureChanges++; else outsideChanges++;
    }
  }
  expect(alphaChanges).toBe(0); expect(outsideChanges).toBe(0); expect(featureChanges).toBeGreaterThan(5000);
});
test.each(moods)('%s replacements have transparent boundaries and bounded source-over error on dark/light backgrounds', async mood => {
  const rig = manifest.expressions.find(r => r.mood === mood);
  const base = await sharp('public' + rig.base.src).raw().toBuffer();
  for (const item of [rig.blink, rig.mouths.small, rig.mouths.open]) {
    const patch = await sharp('public' + item.src).raw().toBuffer();
    let edgeAlpha = 0, softPixels = 0, maxBackgroundError = 0;
    for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
      const p = (y * item.width + x) * 4, i = ((y + item.y) * 768 + x + item.x) * 4;
      const alpha = patch[p + 3] / 255;
      if (x === 0 || y === 0 || x === item.width - 1 || y === item.height - 1) edgeAlpha += patch[p + 3];
      if (alpha > 0 && alpha < 0.5) softPixels++;
      for (const bg of [[0, 0, 0], [14, 15, 19], [32, 36, 42], [232, 223, 210], [255, 255, 255]]) {
        for (let c = 0; c < 3; c++) maxBackgroundError = Math.max(maxBackgroundError, Math.abs(alpha * (1 - base[i + 3] / 255) * (bg[c] - [23, 25, 28][c])));
      }
    }
    expect(edgeAlpha).toBe(0); expect(softPixels).toBeGreaterThan(200);
    expect(maxBackgroundError).toBeLessThan(8);
  }
});

test.each(moods)('%s speaking shapes erase resting lip pixels where generated art calls for skin', async mood => {
  const rig = manifest.expressions.find(r => r.mood === mood);
  const read = name => sharp(`documentation/assets/miien-expressions-v1/${mood}/${name}.webp`).ensureAlpha().raw().toBuffer();
  const resting = await read('character');
  for (const [name, item] of Object.entries(rig.mouths)) {
    const variant = await read('mouth-' + name);
    const displayed = await sharp('public' + rig.base.src)
      .composite([{ input: 'public' + item.src, left: item.x, top: item.y }]).png().toBuffer();
    const pixels = await sharp(displayed).flatten({ background: '#17191c' }).raw().toBuffer();
    let erased = 0, ghosts = 0;
    for (let y = 410; y < 450; y++) for (let x = 357; x < 430; x++) {
      const p = ((y - 245) * 264 + x - 256) * 4;
      if (resting[p] < 180 && variant[p] > 225 && variant[p + 1] > 150) {
        erased++;
        if (pixels[(y * 768 + x) * 3] < 210) ghosts++;
      }
    }
    expect(erased).toBeGreaterThan(0); expect(ghosts).toBe(0);
  }
});
