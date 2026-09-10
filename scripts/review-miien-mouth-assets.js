// Offline art review only: no application/database/provider startup.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'documentation/assets/miien-mouth-cleanup-v2');
// Actual room gradient endpoints (--bg / --surface-3), plus a light stress case.
const backgrounds = ['#0e0f13', '#20242a', '#e8dfd2'];
const states = ['resting', 'old-small', 'small', 'old-open', 'open'];
async function composite(state, background) {
  const layers = [{ input: path.join(root, 'public/i/miien/neutral-v1/character.webp'), left: 0, top: 0 }];
  if (state !== 'resting') layers.push({ input: path.join(root, `public/i/miien/neutral-${state.startsWith('old-') ? 'v1' : 'v2'}/mouth-${state.replace('old-', '')}.webp`), left: 350, top: 409 });
  return sharp({ create: { width: 768, height: 1024, channels: 4, background } }).composite(layers).png().toBuffer();
}
async function review() {
  await fs.mkdir(out, { recursive: true });
  const crops = [], portraits = [], frames = [];
  for (let row = 0; row < backgrounds.length; row++) {
    for (let col = 0; col < states.length; col++) {
      const data = await composite(states[col], backgrounds[row]);
      const crop = await sharp(data).extract({ left: 342, top: 404, width: 104, height: 62 }).resize(312, 186, { kernel: 'nearest' }).toBuffer();
      crops.push({ input: crop, left: col * 312, top: row * 216 + 30 });
      const label = Buffer.from(`<svg width="312" height="30"><text x="8" y="22" fill="white" font-size="16">${states[col]} · ${backgrounds[row]}</text></svg>`);
      crops.push({ input: label, left: col * 312, top: row * 216 });
      if (!states[col].startsWith('old-')) {
        portraits.push({ input: await sharp(data).resize(384, 512).toBuffer(), left: ['resting', 'small', 'open'].indexOf(states[col]) * 384, top: row * 512 });
      }
      if (row === 0 && !states[col].startsWith('old-')) {
        frames.push(await sharp(data).extract({ left: 256, top: 288, width: 288, height: 256 }).raw().toBuffer());
      }
    }
  }
  await sharp({ create: { width: 1560, height: 648, channels: 4, background: '#17191c' } }).composite(crops).png().toFile(path.join(out, 'mouth-comparison.png'));
  await sharp({ create: { width: 1152, height: 1536, channels: 4, background: '#17191c' } }).composite(portraits).png().toFile(path.join(out, 'portrait-backgrounds.png'));
  const sequence = [0, 1, 2, 1, 0, 1, 2, 0];
  await sharp(Buffer.concat(sequence.map(n => frames[n])), { raw: { width: 288, height: 256 * sequence.length, channels: 4, pageHeight: 256 } })
    .webp({ lossless: true, loop: 0, delay: [500, 160, 160, 160, 240, 160, 160, 500] }).toFile(path.join(out, 'mouth-cycle.webp'));
}
if (require.main === module) review().catch(() => {
  require('../utils/logger').error('Miien mouth art review rendering failed', { category: 'chat5_miien_assets' });
  process.exitCode = 1;
});
module.exports = { review };
