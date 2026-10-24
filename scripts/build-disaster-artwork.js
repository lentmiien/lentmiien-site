// Offline original vector artwork. No providers, credentials, private media or app startup.
const fs = require('fs');
const path = require('path');
const { WEATHER, TYPHOON, artwork } = require('../utils/disasterArtwork');
const { INTENSITIES } = require('../utils/disasterLocalEvidence');
const root = path.join(__dirname, '..', 'public');
const ember = '#FF6A1F', amber = '#FFC247', ink = '#0E0F13', line = '#748498';
const wrap = (title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480" role="img"><title>${title}</title><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#243548"/><stop offset="1" stop-color="#141A24"/></linearGradient><linearGradient id="warm" x2="1" y2="1"><stop stop-color="${amber}"/><stop offset="1" stop-color="${ember}"/></linearGradient><radialGradient id="glow"><stop stop-color="${amber}" stop-opacity=".24"/><stop offset="1" stop-color="${amber}" stop-opacity="0"/></radialGradient><pattern id="grain" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".6" fill="#E8ECF2" opacity=".08"/></pattern></defs><rect width="720" height="480" fill="url(#sky)"/>${body}<rect width="720" height="480" fill="url(#grain)"/></svg>`;
const cloud = (x, y, scale = 1, opacity = 1) => `<path transform="translate(${x} ${y}) scale(${scale})" d="M0 38C-20 38-23 10 0 7C3-18 40-23 52-4C75-18 102-3 103 15C134 10 143 40 118 44H12Z" fill="#A9BAC9" opacity="${opacity}"/>`;
function house(x, y, scale, color = '#3A4553') {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M8 60H130V164H8Z" fill="${color}"/><path d="M-4 62L69 12L145 62Z" fill="#18232F" stroke="${line}" stroke-width="2"/><path d="M16 67H122M21 75H117M24 83H112" stroke="#596575" opacity=".35"/><rect x="22" y="90" width="29" height="35" rx="2" fill="${amber}" opacity=".8"/><path d="M36 90V125M22 107H51" stroke="#3A4553" stroke-width="3"/><rect x="83" y="90" width="28" height="35" rx="2" fill="${amber}" opacity=".5"/><path d="M97 90V125M83 107H111" stroke="#3A4553" stroke-width="3"/><rect x="57" y="112" width="21" height="52" rx="3" fill="#18232F"/><circle cx="73" cy="139" r="2" fill="${ember}"/><path d="M-5 166H144" stroke="#839092" stroke-width="3"/></g>`;
}
function neighbourhood() {
  return `<path d="M0 224Q110 116 252 216T720 177V480H0Z" fill="#293B41"/><path d="M0 280Q180 173 347 276T720 220V480H0Z" fill="#223039"/><path d="M0 370L720 330V480H0Z" fill="#141C25"/><path d="M0 435L720 391" stroke="#697581" stroke-width="2" opacity=".5"/><path d="M0 465L720 419" stroke="${amber}" stroke-width="2" stroke-dasharray="30 35" opacity=".35"/>${house(27, 220, .78)}${house(192, 203, 1.06, '#444D58')}${house(403, 212, .85)}${house(576, 211, .72)}<g stroke="#526266" stroke-width="5"><path d="M366 359V264M562 340V258"/></g><g fill="#355651"><ellipse cx="366" cy="266" rx="24" ry="35"/><ellipse cx="562" cy="258" rx="20" ry="29"/></g><path d="M150 391V225Q150 215 161 215H180" fill="none" stroke="#71808E" stroke-width="4"/><path d="M168 211H186L190 222H164Z" fill="${amber}"/><ellipse cx="178" cy="249" rx="63" ry="80" fill="url(#glow)"/><path d="M302 407L318 406M492 395L508 394" stroke="#C1C7D3" stroke-width="5" stroke-linecap="round"/>`;
}
function weatherScene(kind) {
  let sky = '';
  if (kind === 'clear-day') sky = `<circle cx="535" cy="101" r="95" fill="url(#glow)"/><circle cx="535" cy="101" r="34" fill="url(#warm)"/>`;
  if (kind === 'clear-night') sky = `<circle cx="539" cy="98" r="31" fill="#FFE3A1"/><circle cx="552" cy="86" r="29" fill="#243548"/>${[90, 190, 320, 460, 640].map((x, i) => `<circle cx="${x}" cy="${45 + i % 3 * 26}" r="2" fill="#E8ECF2"/>`).join('')}`;
  if (['cloudy', 'rain', 'snow', 'storm', 'fog'].includes(kind)) sky += cloud(95, 90, 1.8, .25) + cloud(396, 73, 1.7, .55) + cloud(252, 125, 1.2, .35);
  if (kind === 'storm') sky += `<path d="M506 116L482 161H508L492 199L542 147H515L531 116Z" fill="url(#warm)"/>`;
  let atmosphere = '';
  if (['rain', 'storm'].includes(kind)) atmosphere = Array.from({ length: 35 }, (_, i) => `<path d="M${25 + i * 19} ${180 + (i * 53) % 240}l-8 18" stroke="#95B9CF" stroke-width="2" opacity=".5"/>`).join('') + '<path d="M52 409H134M368 420H462M544 390H665" stroke="#637B91" stroke-width="3" stroke-linecap="round"/>';
  if (kind === 'snow') atmosphere = Array.from({ length: 45 }, (_, i) => `<circle cx="${16 + i * 16}" cy="${145 + (i * 47) % 290}" r="${i % 3 + 1}" fill="#E8ECF2" opacity=".8"/>`).join('');
  if (kind === 'fog') atmosphere = [175, 230, 299, 360].map((y, i) => `<path d="M${i % 2 * 70} ${y}H${650 + i % 2 * 70}" stroke="#A9BAC9" stroke-width="17" opacity=".13" stroke-linecap="round"/>`).join('');
  if (['unknown', 'stale'].includes(kind)) sky = `<circle cx="532" cy="101" r="41" fill="none" stroke="#9AA3B2" stroke-width="2" stroke-dasharray="5 8"/>${kind === 'stale' ? '<path d="M532 77V103L550 113" fill="none" stroke="#C1C7D3" stroke-width="3"/>' : '<path d="M521 87C520 71 551 73 546 89C544 96 533 96 533 107M533 117V121" fill="none" stroke="#C1C7D3" stroke-width="3"/>'}`;
  return wrap(`Asahi neighbourhood · ${kind}`, sky + neighbourhood() + atmosphere);
}
function quakeScene(level) {
  const n = INTENSITIES.indexOf(level);
  const swing = n <= 1 ? 0 : Math.min(24, n * 3);
  const furniture = n >= 7 ? -Math.min(65, (n - 6) * 22) : n >= 5 ? -4 : 0;
  const motion = n > 1 ? `<g fill="none" stroke="${amber}" stroke-width="2" opacity=".75"><path d="M287 113Q270 139 287 166M432 113Q449 139 432 166"/>${n >= 4 ? '<path d="M119 388l-18 6 18 6M581 388l18 6-18 6"/>' : ''}${n >= 6 ? '<path d="M85 390l-18 6 18 6M615 390l18 6-18 6"/>' : ''}</g>` : n === 1 ? '<path d="M350 327h10M365 327h5" stroke="#FFC247" stroke-width="1" opacity=".5"/>' : '';
  return wrap(`Local measured intensity ${level} · illustrative room`, `<path d="M50 38H670V368H50Z" fill="#252C36" stroke="#6B7687" stroke-width="2"/><path d="M50 368H670L720 480H0Z" fill="#343C45"/><path d="M50 368L0 480M220 368L190 480M480 368L510 480M670 368L720 480M24 425H695" stroke="#56606A" stroke-width="2"/><rect x="82" y="79" width="170" height="170" rx="5" fill="#1A2936" stroke="#788998" stroke-width="5"/><circle cx="207" cy="116" r="19" fill="${amber}" opacity=".7"/><path d="M83 212L139 160L199 207L248 183V249H83Z" fill="#3B5759"/><path d="M167 79V249M83 165H252" stroke="#788998" stroke-width="5"/><g transform="rotate(${swing} 360 38)"><path d="M360 38V126" stroke="#C1C7D3" stroke-width="3"/><path d="M327 127Q360 98 393 127L407 153H313Z" fill="url(#warm)"/><ellipse cx="360" cy="153" rx="47" ry="8" fill="#FFE2A0"/><ellipse cx="360" cy="207" rx="78" ry="58" fill="url(#glow)"/></g><g transform="rotate(${furniture} 568 367)"><rect x="510" y="135" width="100" height="232" rx="4" fill="#4B5660" stroke="#8A9298" stroke-width="2"/><path d="M520 204H600M520 275H600M520 342H600" stroke="#232C35" stroke-width="6"/>${[0, 1, 2].map((i) => `<path d="M${526 + i * 21} 150V199" stroke="${i === 1 ? ember : '#91A3AD'}" stroke-width="15" transform="rotate(${n >= 5 ? i * 7 : 0} 540 200)"/>`).join('')}<path d="M531 241h44M531 255h52" stroke="#A5B1B7" stroke-width="8"/><circle cx="557" cy="316" r="17" fill="#778E8C"/></g><ellipse cx="350" cy="397" rx="148" ry="40" fill="#17212B" opacity=".5"/><path d="M228 337H462V360H228Z" fill="#7D6C55"/><path d="M247 360L239 395M444 360L450 395" stroke="#B59A71" stroke-width="10"/><path d="M230 336H461" stroke="${amber}" stroke-width="2"/><g transform="translate(${n >= 5 ? 30 : 0} ${n >= 6 ? 65 : 0}) rotate(${n >= 5 ? 75 : 0} 398 329)"><path d="M385 309H411V332H385Z" fill="#C7D7D5"/><path d="M411 313Q426 311 423 321Q421 326 411 325" fill="none" stroke="#C7D7D5" stroke-width="4"/></g><path d="M123 349H180L170 380H133Z" fill="${ember}"/><path d="M151 350V296M151 320Q113 304 123 284Q152 284 151 320M151 333Q186 315 180 293Q153 298 151 333" fill="#6B9580" stroke="#6B9580" stroke-width="3"/>${motion}${level === 'unknown' ? '<circle cx="359" cy="270" r="30" fill="#20242A" stroke="#9AA3B2" stroke-dasharray="4 6"/><path d="M350 260Q350 247 365 251Q380 258 359 269V275M359 283V286" fill="none" stroke="#E8ECF2" stroke-width="3"/>' : ''}`);
}
function typhoonScene(kind) {
  const rank = TYPHOON.indexOf(kind);
  const color = rank === 5 ? '#FF4D4F' : rank >= 4 ? ember : amber;
  const vortex = `<g transform="translate(522 110)" fill="none" stroke="${color}" opacity="${kind === 'unknown' ? '.4' : '.85'}" stroke-width="5" stroke-linecap="round"><circle r="14"/><path d="M-12-10C-28-54 52-69 66-14M13 9C30 54-51 69-65 14M-3-15C15-46 64-20 52 9M3 15C-15 46-64 20-52-9"/></g>`;
  const winds = rank >= 2 ? `<g fill="none" stroke="#95B9CF" opacity=".6" stroke-width="3"><path d="M28 149Q120 123 182 149T328 148M4 172Q95 146 155 172T304 170M445 195Q530 170 605 192T735 192"/></g>` : '';
  const guide = kind === 'unknown' ? '' : `<path d="M375 243Q387 165 478 125" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 9" opacity=".6"/><circle cx="375" cy="243" r="6" fill="${color}"/>`;
  return wrap(`Typhoon local context · ${kind}`, cloud(77, 66, 1.7, .25) + (kind === 'unknown' ? '<circle cx="522" cy="110" r="40" fill="none" stroke="#9AA3B2" stroke-width="2" stroke-dasharray="5 8"/><path d="M511 98Q511 79 531 88Q550 100 522 112V119M522 128V132" fill="none" stroke="#C1C7D3" stroke-width="3"/>' : vortex) + neighbourhood() + guide + winds + (rank >= 3 ? `<g fill="${color}">${Array.from({ length: rank - 2 }, (_, i) => `<rect x="${337 + i * 25}" y="409" width="16" height="7" rx="3"/>`).join('')}</g>` : ''));
}
const assets = [];
for (const [group, keys, render] of [['weather', WEATHER, weatherScene], ['earthquake', ['unknown', ...INTENSITIES], quakeScene], ['typhoon', TYPHOON, typhoonScene]]) {
  for (const condition of keys) {
    const url = artwork(group, condition);
    fs.writeFileSync(path.join(root, url), render(condition));
    assets.push({ group, condition, url });
  }
}
fs.writeFileSync(path.join(root, 'i/disaster/v3/manifest.json'), JSON.stringify({ version: 3, assets }, null, 2) + '\n');
console.log(`Wrote ${assets.length} original SVG illustrations.`);
