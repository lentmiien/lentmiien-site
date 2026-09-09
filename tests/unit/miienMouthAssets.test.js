const fs = require('fs/promises');
const sharp = require('sharp');
const crypto = require('crypto');
const { correctMouth, mouthMask, REGION } = require('../../scripts/miien-mouth-correction');
const manifest = require('../../public/i/miien/motion-v1.json');
let base;
beforeAll(async () => { base = await sharp('public' + manifest.layered.base.src).raw().toBuffer(); });
test('approved character, blink and all still portraits keep their checkpoint hashes/paths', () => {
  expect(manifest.assetVersion).toBe('miien-2.5');
  expect(manifest.layered.base).toMatchObject({ src: '/i/miien/neutral-v1/character.webp', sha256: '6c84d93a90366088748df1b0e78b17c7ed22ec82c5958e2fa21cca255cfc34ac' });
  expect(manifest.layered.blink).toMatchObject({ src: '/i/miien/neutral-v1/blink.webp', sha256: 'f9901ab469c087bc8d91349edcf33c640dc10e8f25ff767446e4061341509fb1' });
  expect(manifest.stills.map(item => item.sha256)).toEqual([
    'a96d921b3afea4022ffab1c3b2292b35ac6c62db78367f2f1c980997936d9978',
    '6f7a06334755a2fa00f18953b59a7b4eb41b9aa93205f3a8ec08ba80256819e4',
    '9cba193a5a0c47e71b5d663e652fd45f8a7f3a5cd70cb2bc8ae1b9e235afa6c1',
    'fb43fa1ec98302f923b3be36522627d231996b03453d45ba71f480525e6a34cd',
    'c272f483daeefa41bc1cc5679103c14b48e004ace9dc777af9f3242d315d6a0b',
  ]);
});
test.each(['small', 'open'])('mouth %s reproducibly packages corrected existing art at a new hashed URL', async name => {
  const item = manifest.layered.mouths[name];
  expect(item).toMatchObject({ ...REGION, src: `/i/miien/neutral-v2/mouth-${name}.webp` });
  const variant = await sharp(`documentation/assets/miien-neutral-v1/mouth-${name}.webp`).resize(768, 1024).ensureAlpha().raw().toBuffer();
  const rebuilt = await sharp(correctMouth(base, variant, 768), { raw: { width: 86, height: 51, channels: 4 } }).webp({ lossless: true }).toBuffer();
  expect(rebuilt.equals(await fs.readFile('public' + item.src))).toBe(true);
  expect(crypto.createHash('sha256').update(rebuilt).digest('hex')).toBe(item.sha256);
});
test.each(['small', 'open'])('mouth %s preserves outside skin, has a soft color seam and bounds partial-alpha error', async name => {
  const patch = await sharp('public' + manifest.layered.mouths[name].src).raw().toBuffer();
  let outside = 0, soft = 0, maxSeam = 0, maxBackgroundError = 0;
  const backgrounds = [[0, 0, 0], [14, 15, 19], [23, 25, 28], [32, 36, 42], [48, 52, 59], [232, 223, 210], [255, 255, 255]];
  for (let y = 0; y < 51; y++) for (let x = 0; x < 86; x++) {
    const i = ((y + 409) * 768 + x + 350) * 4, p = (y * 86 + x) * 4;
    const alpha = patch[p + 3] / 255, baseAlpha = base[i + 3] / 255;
    const mask = mouthMask(x + 350, y + 409);
    if (!mask) { expect(alpha).toBe(0); outside++; }
    if (patch[p + 3] > 0 && patch[p + 3] < 128) soft++;
    for (const bg of backgrounds) for (let c = 0; c < 3; c++) {
      const before = base[i + c] * baseAlpha + bg[c] * (1 - baseAlpha);
      const after = patch[p + c] * alpha + before * (1 - alpha);
      if (!mask) expect(after).toBe(before);
      if (mask < 0.15) maxSeam = Math.max(maxSeam, Math.abs(after - before));
      // Extra opacity in source-over is unavoidable inside changed mouth pixels;
      // compare its background response to preserving the base's original alpha.
      maxBackgroundError = Math.max(maxBackgroundError, Math.abs(alpha * (1 - baseAlpha) * (bg[c] - [23, 25, 28][c])));
    }
  }
  expect(outside).toBeGreaterThan(2000); expect(soft).toBeGreaterThan(1500);
  expect(maxSeam).toBeLessThan(1); expect(maxBackgroundError).toBeLessThan(5);
  // Wider resting lip endpoints must be erased, not left beside the open oval.
  for (const [x, y] of [[367, 430], [419, 429]]) {
    const i = (y * 768 + x) * 4, p = ((y - 409) * 86 + x - 350) * 4;
    const a = patch[p + 3] / 255, ab = base[i + 3] / 255;
    const red = patch[p] * a + (base[i] * ab + 23 * (1 - ab)) * (1 - a);
    expect(red).toBeGreaterThan(210);
  }
});
test('review animation contains the intended cycle frames and timing', async () => {
  const metadata = await sharp('documentation/assets/miien-mouth-cleanup-v2/mouth-cycle.webp', { animated: true }).metadata();
  expect(metadata).toMatchObject({ width: 288, pageHeight: 256, pages: 8, loop: 0, delay: [500, 160, 160, 160, 240, 160, 160, 500] });
});
