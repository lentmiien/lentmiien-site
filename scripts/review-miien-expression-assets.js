// Deterministic review contact sheets. Uses only the final manifest and assets.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'documentation/assets/miien-expressions-v1');
async function review() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/i/miien/motion-v1.json'), 'utf8'));
  const faceTiles = [], mouthTiles = [];
  for (const [row, rig] of manifest.expressions.entries()) {
    const portraits = [];
    for (const [column, item] of [null, rig.blink, rig.mouths.small, rig.mouths.open].entries()) {
      const composite = await sharp(path.join(root, 'public' + rig.base.src))
        .composite(item ? [{ input: path.join(root, 'public' + item.src), left: item.x, top: item.y }] : [])
        .png().toBuffer();
      const portrait = await sharp(composite).flatten({ background: '#17191c' }).resize(384, 512).toBuffer();
      portraits.push({ input: portrait, left: column * 384, top: 0 });
      const face = await sharp(composite).flatten({ background: '#17191c' })
        .extract({ left: 256, top: 245, width: 264, height: 222 }).resize(396, 333).toBuffer();
      faceTiles.push({ input: face, left: column * 396, top: row * 333 });
      const mouth = await sharp(composite).flatten({ background: '#e8dfd2' })
        .extract({ left: 337, top: 393, width: 112, height: 76 }).resize(448, 304).toBuffer();
      mouthTiles.push({ input: mouth, left: column * 448, top: row * 304 });
    }
    await sharp({ create: { width: 1536, height: 512, channels: 3, background: '#17191c' } })
      .composite(portraits).webp({ quality: 90 }).toFile(path.join(output, rig.mood + '-poses.webp'));
  }
  await sharp({ create: { width: 1584, height: 1332, channels: 3, background: '#17191c' } })
    .composite(faceTiles).png().toFile(path.join(output, 'faces.png'));
  await sharp({ create: { width: 1792, height: 1216, channels: 3, background: '#e8dfd2' } })
    .composite(mouthTiles).png().toFile(path.join(output, 'mouths-light.png'));
}
if (require.main === module) review().catch(error => {
  require('../utils/logger').error('Miien expression review rendering failed', {
    category: 'chat5_miien_assets', metadata: { failure: error.code || 'processing_failed' },
  });
  process.exitCode = 1;
});
module.exports = { review };
