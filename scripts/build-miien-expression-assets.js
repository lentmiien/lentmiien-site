// Offline packaging only: generated facial artwork on the immutable accepted
// foreground. No provider, application, database or speech startup.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'documentation/assets/miien-expressions-v1');
const width = 768, height = 1024;
const moods = ['happy', 'thoughtful', 'concerned', 'surprised'];
const mouthRegion = { x: 340, y: 395, width: 106, height: 70 };
const blinkRegion = { x: 258, y: 293, width: 260, height: 85 };
const mouthEllipse = [393, 430, 49, 31];
const eyeEllipses = [[315, 316, 56, 57], [459, 310, 56, 63]];
const blinkEllipses = [[315, 335, 56, 40], [459, 333, 56, 40]];
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const clamp = value => Math.max(0, Math.min(255, value));

// Match clean skin below the nose before replacing generated features. A
// constant illumination offset avoids amplifying old eye/lip detail into the
// new skin fill. Smooth ellipses cover both old and new feature boundaries.
function transfer(base, variant, ellipses) {
  const output = Buffer.from(base), offset = [0, 0, 0];
  let count = 0;
  for (let y = 398; y < 403; y++) for (let x = 363; x < 422; x++) {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) offset[c] += base[i + c] - variant[i + c];
    count++;
  }
  for (let c = 0; c < 3; c++) offset[c] /= count;
  for (const [cx, cy, rx, ry] of ellipses) {
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const t = Math.max(0, Math.min(1, (1 - r) / 0.12));
      const mask = t * t * (3 - 2 * t), i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) output[i + c] = Math.round(base[i + c] + mask * (clamp(variant[i + c] + offset[c]) - base[i + c]));
      // Preserve accepted foreground alpha, including partially opaque skin.
    }
  }
  return output;
}

function overlay(base, target, region) {
  const patch = Buffer.alloc(region.width * region.height * 4);
  const background = [23, 25, 28];
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const i = ((y + region.y) * width + x + region.x) * 4, p = (y * region.width + x) * 4;
    const a = base[i + 3] / 255, original = [], delta = [];
    let opacity = 0;
    for (let c = 0; c < 3; c++) {
      original[c] = a * base[i + c] + (1 - a) * background[c];
      delta[c] = a * (target[i + c] - base[i + c]);
      if (delta[c]) opacity = Math.max(opacity, delta[c] > 0 ? delta[c] / (255 - original[c]) : -delta[c] / original[c]);
    }
    const alpha = Math.min(255, Math.ceil(opacity * 255));
    if (!alpha) continue;
    patch[p + 3] = alpha;
    for (let c = 0; c < 3; c++) patch[p + c] = Math.round(clamp(original[c] + delta[c] * 255 / alpha));
  }
  return patch;
}
async function build() {
  const accepted = await sharp(path.join(root, 'public/i/miien/neutral-v1/character.webp')).ensureAlpha().raw().toBuffer();
  const manifestPath = path.join(root, 'public/i/miien/motion-v1.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const sourceProvenance = JSON.parse(await fs.readFile(path.join(sourceRoot, 'provenance.json'), 'utf8'));
  const rigs = [];
  for (const mood of moods) {
    const output = path.join(root, `public/i/miien/${mood}-v1`);
    await fs.mkdir(output, { recursive: true });
    const read = name => sharp(path.join(sourceRoot, mood, name + '.webp')).ensureAlpha()
      .extend({ left: 256, top: 245, right: 248, bottom: 557, background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer();
    const generatedBase = await read('character');
    const base = transfer(accepted, generatedBase, [...eyeEllipses, mouthEllipse]);
    const assets = {};
    for (const name of ['character', 'blink', 'mouth-small', 'mouth-open']) {
      const region = name === 'blink' ? blinkRegion : mouthRegion;
      let pixels = base;
      if (name !== 'character') {
        // Correct each variant against its own generated resting master first.
        // Transferring directly against the accepted-derived base can amplify
        // unrelated eye-boundary differences into bright eyelid highlights.
        const corrected = transfer(generatedBase, await read(name), name === 'blink' ? blinkEllipses : [mouthEllipse]);
        const target = Buffer.from(base);
        for (let i = 0; i < target.length; i += 4) for (let c = 0; c < 3; c++) {
          target[i + c] = clamp(base[i + c] + corrected[i + c] - generatedBase[i + c]);
        }
        pixels = overlay(base, target, region);
      }
      const bounds = name === 'character' ? { x: 0, y: 0, width, height } : region;
      const data = await sharp(pixels, { raw: { width: bounds.width, height: bounds.height, channels: 4 } }).webp({ lossless: true }).toBuffer();
      await fs.writeFile(path.join(output, name + '.webp'), data);
      assets[name] = { src: `/i/miien/${mood}-v1/${name}.webp`, ...bounds, sha256: digest(data) };
    }
    const rig = { version: 1, mood, reviewStatus: 'prototype', width, height,
      provenance: `/i/miien/${mood}-v1/provenance.json`, base: assets.character, blink: assets.blink,
      mouths: { small: assets['mouth-small'], open: assets['mouth-open'] } };
    rigs.push(rig);
    await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify({
      assetVersion: 'miien-2.5', status: 'human-review-pending', tool: sourceProvenance.tool,
      mood, canvas: { width, height }, sourceProvenance: 'documentation/assets/miien-expressions-v1/provenance.json',
      processing: 'Generated facial regions transferred onto accepted neutral foreground using clean-skin illumination correction and smooth elliptical masks. Original foreground alpha preserved. Blink/mouth patches use minimum source-over opacity compensated on Graphite #17191c. Sharp lossless WebP; no procedural lips/eyes.',
      assets: Object.values(assets),
    }, null, 2) + '\n');
  }
  manifest.assetVersion = 'miien-2.5';
  manifest.expressions = rigs;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
if (require.main === module) build().catch(error => {
  require('../utils/logger').error('Miien expression asset packaging failed', {
    category: 'chat5_miien_assets', metadata: { failure: error.code || 'processing_failed' },
  });
  process.exitCode = 1;
});
module.exports = { build, transfer, overlay, moods, mouthRegion, blinkRegion, mouthEllipse, eyeEllipses, blinkEllipses };
