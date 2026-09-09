// Deterministic packaging of reviewed generated artwork; never calls a provider.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'documentation/assets/miien-neutral-v1');
const output = path.join(root, 'public/i/miien/neutral-v1');
const width = 768, height = 1024;
const regions = {
  blink: { x: 264, y: 298, width: 248, height: 80 },
  'mouth-small': { x: 350, y: 409, width: 86, height: 51 },
  'mouth-open': { x: 350, y: 409, width: 86, height: 51 },
};
async function build() {
  await fs.mkdir(output, { recursive: true });
  const assets = {};
  for (const name of ['character', ...Object.keys(regions)]) {
    let pixels = await sharp(path.join(source, name + '.webp')).resize(width, height).ensureAlpha().raw().toBuffer();
    const region = regions[name];
    if (region) {
      // Feather only the replacement boundary. All visible facial artwork comes
      // from the generated variant; no procedural eyes or lips are drawn.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let alpha;
        if (name === 'blink') {
          const left = Math.hypot((x - 315) / 53, (y - 336) / 35);
          const right = Math.hypot((x - 459) / 54, (y - 333) / 36);
          alpha = Math.max(0, Math.min(1, (1 - Math.min(left, right)) / 0.15));
        } else {
          alpha = Math.max(0, Math.min(1, Math.min(x - region.x, region.x + region.width - 1 - x,
            y - region.y, region.y + region.height - 1 - y) / 8));
        }
        pixels[(y * width + x) * 4 + 3] = Math.round(255 * alpha);
      }
    }
    let pipeline = sharp(pixels, { raw: { width, height, channels: 4 } });
    if (region) pipeline = pipeline.extract({ left: region.x, top: region.y, width: region.width, height: region.height });
    const data = await pipeline.webp({ lossless: true }).toBuffer();
    await fs.writeFile(path.join(output, name + '.webp'), data);
    assets[name] = { src: `/i/miien/neutral-v1/${name}.webp`, ...(region || { x: 0, y: 0, width, height }),
      sha256: crypto.createHash('sha256').update(data).digest('hex') };
  }
  const manifestPath = path.join(root, 'public/i/miien/motion-v1.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.assetVersion = 'miien-2.3';
  manifest.layered = { version: 1, mood: 'neutral', reviewStatus: 'prototype', width, height,
    provenance: '/i/miien/neutral-v1/provenance.json', base: assets.character, blink: assets.blink,
    mouths: { small: assets['mouth-small'], open: assets['mouth-open'] } };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const provenance = JSON.parse(await fs.readFile(path.join(source, 'provenance.json'), 'utf8'));
  await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify({
    assetVersion: manifest.assetVersion, status: 'prototype-human-review-pending', tool: provenance.tool,
    referenceSha256: provenance.referenceSha256, sourceCanvas: { width: 1086, height: 1448 }, canvas: { width, height },
    processing: 'Sharp lossless WebP; separate alpha character; feathered generated eye/mouth interior crops; fixed CSS theme background.',
    limitations: provenance.limitations, assets: Object.values(assets),
  }, null, 2) + '\n');
}
if (require.main === module) build().catch(error => {
  require('../utils/logger').error('Miien neutral asset packaging failed', {
    category: 'chat5_miien_assets', metadata: { failure: error.code || 'processing_failed' },
  });
  process.exitCode = 1;
});
module.exports = { build };
