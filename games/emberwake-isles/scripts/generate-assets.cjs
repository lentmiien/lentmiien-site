/* Reproducible original pixel atlas, inventory illustrations and cartographic cover. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const D = require('../js/data.js');
const out = path.join(__dirname, '../assets');
fs.mkdirSync(path.join(out, 'icons'), {
  recursive: true
});
function crc(b) {
  let c = 0xffffffff;
  for (const n of b) {
    c ^= n;
    for (let j = 0; j < 8; j++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  t.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc(Buffer.concat([t, data])), data.length + 8);
  return b;
}
const size = 128,
  raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const id = Math.floor(y / 16) * 8 + Math.floor(x / 16),
    b = D.blocks[id] || D.blocks[1],
    px = x % 16,
    py = y % 16;
  const hex = b.color || '#000000',
    rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  let n = (x * 1537 + y * 317 + id * 17 ^ (x + y) * 191) % 19 - 9;
  if (/plank|wood|log|bench|shelf|chest/.test(b.key)) n += py % 5 === 0 ? -32 : px % 8 === 0 ? 10 : 0;
  if (/brick|cobble|tile|marble|sandstone/i.test(b.key)) n += py % 8 === 0 || (px + Math.floor(py / 8) % 2 * 8) % 16 === 0 ? -34 : 0;
  if (/Ore/.test(b.key) && (px * 3 + py * 7) % 17 < 5) n += b.key === 'coalOre' ? -45 : 45;
  if (b.key === 'glass') n += px === 0 || py === 0 || px === 15 || py === 15 ? 30 : -6;
  const k = y * (size * 4 + 1) + 1 + x * 4;
  for (let i = 0; i < 3; i++) raw[k + i] = Math.max(0, Math.min(255, rgb[i] + n));
  raw[k + 3] = 255;
}
const ih = Buffer.alloc(13);
ih.writeUInt32BE(size);
ih.writeUInt32BE(size, 4);
ih[8] = 8;
ih[9] = 6;
fs.writeFileSync(path.join(out, 'atlas.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
for (const item of Object.values(D.items)) {
  const color = item.color;
  const shape = item.tool ? `<path d="M27 51L41 19" stroke="#b89363" stroke-width="7"/><path d="M16 23Q30 7 52 26L47 31Q33 20 18 31Z" fill="${color}"/>` : item.food ? `<path d="M13 26Q32 14 51 26L45 45Q32 55 19 45Z" fill="${color}"/><path d="M28 22Q25 11 36 8" fill="none" stroke="#96b579" stroke-width="4"/>` : item.boat ? `<path d="M8 39L54 39L46 52H19Z" fill="${color}"/><path d="M30 10V39M33 12L48 33H33Z" stroke="#ede3c7" fill="#ede3c7" stroke-width="3"/>` : `<path d="M32 9L54 21V45L32 57L10 45V21Z" fill="${color}"/><path d="M10 21L32 33L54 21M32 33V57" fill="none" stroke="#171a20" stroke-opacity=".4" stroke-width="2"/><path d="M10 21L32 9L54 21L32 33Z" fill="#fff" opacity=".16"/>`;
  fs.writeFileSync(path.join(out, 'icons', item.key + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${item.name.replace(/&/g, '&amp;')}</title>${shape}</svg>`);
}
let art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><defs><radialGradient id="o"><stop stop-color="#397a83"/><stop offset="1" stop-color="#122c39"/></radialGradient><pattern id="p" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M5 24q9-6 18 0" fill="none" stroke="#e5d8b2" opacity=".1"/></pattern></defs><rect width="1000" height="800" fill="url(#o)"/><rect width="1000" height="800" fill="url(#p)"/><circle cx="500" cy="395" r="350" fill="none" stroke="#daba78" stroke-dasharray="2 8" opacity=".35"/>';
for (const [j, i] of D.islands.entries()) {
  const x = 500 + i.x * .92,
    y = 390 + i.z * .8;
  art += `<g transform="translate(${x} ${y})"><ellipse cy="16" rx="${i.rx * .98}" ry="${i.rz * .72}" fill="#73b5a5" opacity=".35"/><path d="M-75 20L-59-25L-15-50L43-40L79-2L61 37L4 55L-56 45Z" fill="#dbcba3"/><path d="M-65 13L-46-22L-12-41L37-30L66-2L51 31L2 44L-47 35Z" fill="${i.color}"/><path d="M-15 18L12-38L47 18Z" fill="#394854" opacity=".35"/><path d="M-15 7L12-49L47 7Z" fill="${j === 3 ? '#dfebdf' : j === 4 ? '#756280' : '#8db484'}"/><circle cx="-32" cy="21" r="4" fill="#ffc247"/></g>`;
}
art += '<path d="M275 470Q210 270 350 210T635 250T715 440T510 620" fill="none" stroke="#f4d79a" opacity=".6" stroke-dasharray="5 8"/><g transform="translate(815 645)" fill="none" stroke="#e4c789"><circle r="44"/><path d="M0-65V65M-65 0H65M0-40L10 0L0 40L-10 0Z"/></g><text x="815" y="565" text-anchor="middle" fill="#e4c789" font-family="serif" font-size="20">N</text></svg>';
fs.writeFileSync(path.join(out, 'chart.svg'), art);
console.log(`Generated atlas, chart and ${Object.keys(D.items).length} icons.`);
