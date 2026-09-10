// Local correction of the existing generated mouth masters, not new artwork.
// All coordinates refer to the reviewed 768x1024 base canvas.
const REGION = { x: 350, y: 409, width: 86, height: 51 };
const REFERENCE_BACKGROUND = [23, 25, 28];
function mouthMask(x, y) {
  // Includes the entire resting lip line, especially its wider outer corners.
  const radius = Math.hypot((x - 392) / 37, (y - 433) / 19);
  const t = Math.max(0, Math.min(1, (1 - radius) / 0.18));
  return t * t * (3 - 2 * t);
}
function correctMouth(base, variant, width) {
  // Fit the illumination offset from clean skin above/below the lips. Retain
  // the base's spatial skin variation outside the localized mouth mask.
  const sample = (top) => {
    const sum = [0, 0, 0]; let count = 0;
    for (let y = top; y < top + 4; y++) for (let x = 360; x <= 428; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) sum[c] += base[i + c] - variant[i + c];
      count++;
    }
    return sum.map(value => value / count);
  };
  const upper = sample(412), lower = sample(452);
  const patch = Buffer.alloc(REGION.width * REGION.height * 4);
  for (let y = 0; y < REGION.height; y++) for (let x = 0; x < REGION.width; x++) {
    const gx = x + REGION.x, gy = y + REGION.y;
    const mask = mouthMask(gx, gy);
    if (!mask) continue;
    const i = (gy * width + gx) * 4, p = (y * REGION.width + x) * 4;
    const baseAlpha = base[i + 3] / 255;
    const original = [], delta = [];
    let opacity = 0;
    for (let c = 0; c < 3; c++) {
      const offset = upper[c] + (lower[c] - upper[c]) * (gy - 413.5) / 40;
      const target = Math.max(0, Math.min(255, variant[i + c] + offset));
      original[c] = baseAlpha * base[i + c] + (1 - baseAlpha) * REFERENCE_BACKGROUND[c];
      delta[c] = baseAlpha * mask * (target - base[i + c]);
      opacity = Math.max(opacity, delta[c] >= 0 ? delta[c] / (255 - original[c]) : -delta[c] / original[c]);
    }
    // Minimum source-over opacity that can reach the corrected color. This
    // avoids doubling base alpha across an opaque skin rectangle. Transparent
    // pixels remain exactly unchanged on every background. In the mouth itself
    // source-over cannot preserve base alpha; reference-background compensation
    // bounds the remaining background-dependent difference (verified in tests).
    const alpha = Math.min(255, Math.ceil(opacity * 255));
    if (!alpha) continue;
    patch[p + 3] = alpha;
    for (let c = 0; c < 3; c++) patch[p + c] = Math.round(Math.max(0, Math.min(255, original[c] + delta[c] * 255 / alpha)));
  }
  return patch;
}
module.exports = { correctMouth, mouthMask, REGION, REFERENCE_BACKGROUND };
