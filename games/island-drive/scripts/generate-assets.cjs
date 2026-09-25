/* Reproducible original vector artwork. Run from anywhere with repository sharp installed. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const W = require('../js/world.js');
const { CARS } = require('../js/simulation.js');
const world = W.createWorld();
const out = path.join(__dirname, '../assets/images');
const paths = world.roads
  .map(
    (r) =>
      `<path d="M${r.points.map((p) => `${p.x},${p.z}`).join(' L')}" stroke-width="${r.width}"/>`
  )
  .join('');
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1300 -1300 2600 2600">${body}</svg>`;
const rand = W.random(900);
let fields = '';
for (let i = 0; i < 360; i++) {
  const x = rand() * 2100 - 1050;
  const z = rand() * 2100 - 1050;
  if (world.roadAt(x, z, true).edge < 70) continue;
  fields += `<path d="M${x},${z} l${40 + rand() * 110},15 l-15,${30 + rand() * 100} l-${50 + rand() * 90},-20 Z" fill="${['#91a775', '#9cab76', '#879f72', '#b0b580'][i % 4]}" opacity=".6"/>`;
}
const roadBase = `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#b9b399">${world.roads.map((r) => `<path d="M${r.points.map((p) => `${p.x},${p.z}`).join(' L')}" stroke-width="${r.width + 3}"/>`).join('')}</g><g stroke="#505c5b">${paths}</g></g>`;
let lines = '';
for (const r of world.roads) {
  let dist = 0;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1],
      b = r.points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(len / 5);
    for (let j = 0; j < n; j++) {
      dist += len / n;
      if (dist < 12) continue;
      dist = 0;
      const x = a.x + ((b.x - a.x) * j) / n,
        z = a.z + ((b.z - a.z) * j) / n;
      const intersection = world.segments.some(
        (s) => s.roadId !== world.roads.indexOf(r) && W.project(x, z, s.a, s.b).distance < 14
      );
      if (!intersection)
        lines += `<path d="M${x},${z} l${((b.x - a.x) / len) * 4},${((b.z - a.z) / len) * 4}"/>`;
    }
  }
}
const paving = world.obstacles
  .filter((o) => o.type === 'building')
  .map(
    (o) =>
      `<rect x="${o.x - o.w / 2 - 1}" y="${o.z - o.depth / 2 - 1}" width="${o.w + 2}" height="${o.depth + 2}" fill="#b8b49c"/>`
  )
  .join('');
const shadows = world.obstacles
  .map(
    (o) =>
      `<ellipse cx="${o.x}" cy="${o.z}" rx="${o.radius}" ry="${o.radius * 0.85}" fill="#243c35" opacity=".22"/>`
  )
  .join('');
const ground = svg(
  `<path fill="#9eaf7d" d="M-1300-1300H1300V1300H-1300Z"/>${fields}<path fill="#b9bba1" d="M-642 97H-158V465H-642Z"/>${paving}${shadows}${roadBase}<g stroke="#e8ddaf" stroke-width=".55" fill="none">${lines}</g>`
);
fs.writeFileSync(path.join(out, 'terrain.svg'), ground);
let island = [];
for (let i = 0; i < 180; i++) {
  const angle = (i / 180) * Math.PI * 2;
  const radius = 1060 + 65 * Math.sin(angle * 3 + 0.6) + 35 * Math.cos(angle * 5);
  island.push(`${Math.cos(angle) * radius},${(Math.sin(angle) * radius) / 1.05}`);
}
const map = svg(
  `<path fill="#214c58" d="M-1300-1300H1300V1300H-1300Z"/><path fill="#e0cf9f" stroke="#3e7078" stroke-width="28" d="M${island.join(' L')}Z"/><path fill="#819c76" d="M${island
    .map((p) =>
      p
        .split(',')
        .map(Number)
        .map((n) => n * 0.94)
        .join(',')
    )
    .join(
      ' L'
    )}Z"/><ellipse cx="340" cy="-290" rx="320" ry="270" fill="#748b71"/><ellipse cx="340" cy="-290" rx="190" ry="155" fill="#a0ab89"/>${roadBase}<g fill="#edbd63">${world.landmarks.map((p) => `<circle cx="${p.x}" cy="${p.z}" r="17"/>`).join('')}</g>`
);
fs.writeFileSync(path.join(out, 'island-map.svg'), map);
for (const [i, c] of CARS.entries()) {
  const color = '#' + c.color.toString(16).padStart(6, '0');
  const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 250"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#26373a"/><stop offset="1" stop-color="#171a20"/></linearGradient></defs><rect width="560" height="250" rx="16" fill="url(#b)"/><path d="M0 203L560 119V250H0Z" fill="#202b2d"/><path d="M0 235L560 151" stroke="#b0a37c" stroke-width="3" stroke-dasharray="25 20"/><ellipse cx="281" cy="191" rx="181" ry="26" fill="#0e0f13" opacity=".6"/><path d="M99 139L178 91L${i === 2 ? 300 : 286} ${i === 2 ? 74 : 52}L391 97L454 129L449 177L333 207L99 172Z" fill="${color}"/><path d="M182 94L${i === 2 ? 299 : 286} ${i === 2 ? 80 : 61}L377 101L273 132Z" fill="#36535b"/><path d="M190 99L274 137L274 169L131 143Z" fill="#91b5b5"/><path d="M286 137L389 107L443 133L337 165Z" fill="${color}"/><path d="M337 165L449 136L449 177L337 204Z" fill="#111b24" opacity=".24"/><path d="M288 139L384 112" stroke="#e8ecf2" stroke-width="3" opacity=".7"/><g fill="#111820" stroke="#303a40" stroke-width="5"><ellipse cx="162" cy="171" rx="28" ry="35"/><ellipse cx="376" cy="181" rx="28" ry="35"/></g><g fill="#a6aca8"><ellipse cx="162" cy="171" rx="13" ry="20"/><ellipse cx="376" cy="181" rx="13" ry="20"/></g><path d="M411 150L442 141V155L411 164Z" fill="#fff3ce"/><path d="M107 146L124 151V161L107 157Z" fill="#e95039"/><path d="M291 168L317 161" stroke="#e8ecf2" stroke-width="4"/>${i === 2 ? '<path d="M103 133L146 110L142 98L94 123Z" fill="#253239"/>' : ''}</svg>`;
  fs.writeFileSync(path.join(out, `${c.id}.svg`), art);
}
const hero = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#a9d7d9"/><stop offset="1" stop-color="#f4dfb0"/></linearGradient></defs><path fill="url(#s)" d="M0 0H1200V700H0Z"/><circle cx="917" cy="155" r="66" fill="#fff0bd"/><path fill="#669da2" d="M0 330H1200V700H0Z"/><path fill="#b4b693" d="M0 430L240 180L400 300L690 225L840 330L1040 365L1200 490V700H0Z"/><path fill="#78917b" d="M0 430L240 180L187 391L458 365L690 225L647 435L840 330L1030 413L1200 490V700H0Z"/><path fill="#e0ce9e" d="M0 620Q300 390 550 492T1200 465V700H0Z"/><path fill="#829979" d="M0 596Q300 366 550 468T1200 442V700H0Z"/><path d="M-70 690C220 415 400 681 606 502S753 449 760 401" fill="none" stroke="#c9bb95" stroke-width="65"/><path d="M-70 690C220 415 400 681 606 502S753 449 760 401" fill="none" stroke="#515f5d" stroke-width="54"/><path d="M-70 690C220 415 400 681 606 502S753 449 760 401" fill="none" stroke="#e8dbac" stroke-width="3" stroke-dasharray="18 19"/><g fill="#375b50">${[70, 160, 380, 800, 870, 930, 1030].map((x, i) => `<path d="M${x - 26} ${485 + (i % 3) * 25}l26-92 26 92Z"/>`).join('')}</g><path d="M1011 388L1018 280H1040L1047 388Z" fill="#f2e8d0"/><path d="M1018 312H1041V333H1016Z" fill="#d47753"/><path d="M1014 280H1044V267H1014Z" fill="#354b51"/><path d="M1009 266L1029 250L1049 266Z" fill="#cd704f"/></svg>`;
fs.writeFileSync(path.join(out, 'coast-poster.svg'), hero);
(async () => {
  await sharp(Buffer.from(ground)).resize(4096, 4096).png().toFile(path.join(out, 'terrain.png'));
  console.log('Generated terrain PNG, terrain/map/poster SVGs, and three car SVGs.');
})();
