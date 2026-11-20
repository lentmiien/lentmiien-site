/* Deterministic test of the gold-gift mechanic:
   AI rivals that received gold gifts are strictly less likely to
   declare war on the player (Civ-1 style gift diplomacy).

   aiDiplomacy rolls:  Math.random() < chance
     chance = max(0.01, 0.08 - 0.02 * (gifts / 100))
   We stub Math.random with a fixed roll in the gap between two
   consecutive chances, so the outcome flips exactly as the gift
   total grows. Fully deterministic — no flakiness. */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['data.js', 'mapgen.js', 'game.js', 'ai.js']) {
  (new Function(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')))();
}
const Civ = global.window.Civ;

Civ.newGame({ seed: 12345, aiCount: 1, size: 24, difficulty: 'normal' });
const S = Civ.state;
const p = S.civs[0], ai = S.civs[1];
let tid = 100000;
function spawn(civ, type, x, y) {
  const T = Civ.UNIT_TYPES[type];
  const u = { id: tid++, civ, type, x, y, hp: 100, mp: T.mp, moved: false };
  civ.units.push(u); return u;
}

// --- arrange the prerequisites of aiDiplomacy ----------------------
S.turn = 20;                       // >= 12
p.cities.length && (p.cities[0].pop = 2);
// give the AI six warriors adjacent to the player's only city
const c0 = p.cities[0];
for (const u of ai.units.slice()) ai.units.splice(ai.units.indexOf(u), 1);
ai.units = Array.from({ length: 6 }, (_, i) => {
  return spawn(ai, 'warrior', c0.x + (i % 2 === 0 ? 1 : -1), c0.y);
});
// player: one warrior (combat target), enough gold
for (const u of p.units.slice()) p.units.splice(p.units.indexOf(u), 1);
const pw = spawn(p, 'warrior', c0.x, c0.y + 1);
p.gold = 1000;

// snapshots to restore between trials (aiTurn moves/damages units)
const aiSnap = ai.units.map(u => ({ ...u }));
const pSnap = p.units.map(u => ({ ...u }));

const realRandom = Math.random;
function reset() {
  ai.units = aiSnap.map(u => ({ ...u, civ: ai }));
  p.units = pSnap.map(u => ({ ...u, civ: p }));
  ai.atWar = {}; p.atWar = {};
  ai.declaredWar = false;
  S.turn = 20;
}
function trial(roll, giftGold) {
  reset();
  if (giftGold > 0) {
    ai.gifts = { [p.id]: giftGold };   // same bookkeeping the UI handler performs
  } else {
    ai.gifts = {};
  }
  const logBefore = S.log.length;
  Math.random = () => roll;
  try { Civ.ai.aiTurn(ai); } finally { Math.random = realRandom; }
  const declared = S.log.slice(logBefore).some(l => l.msg.includes('WAR!'));
  return declared;
}

const cases = [
  // roll, gifts (gold), expected war declaration
  [0.07,    0, true],   // chance 0.08 → 0.07 < 0.08 → WAR
  [0.07,  100, false],  // chance 0.06 → 0.07 > 0.06 → no war
  [0.05,  100, true],   // chance 0.06 → 0.05 < 0.06 → WAR
  [0.05,  200, false],  // chance 0.04 → 0.05 > 0.04 → no war
  [0.03,  300, true],   // chance 0.02 → 0.03 > 0.02 → no war? NO: 0.03 > 0.02 → false
];
// fix last case: roll 0.015 < 0.02 → war even with 3 gifts; and roll 0.03 → peace
cases[cases.length - 1] = [0.03, 300, false];
cases.push([0.015, 300, true]);   // even a very calmed rival (chance 0.02) still snaps at roll 0.015

let fail = 0;
for (const [roll, giftGold, expectWar] of cases) {
  const got = trial(roll, giftGold);
  const ok = got === expectWar;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  roll=' + roll + ' gifts=' + giftGold + 'g → ' +
    (got ? 'WAR' : 'peace') + ' (expected ' + (expectWar ? 'WAR' : 'peace') + ')');
}
if (fail) { console.error(fail + ' FAILURES'); process.exit(1); }
console.log('ALL PASS');
