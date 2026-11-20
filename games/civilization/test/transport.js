/* Transport (boat) flow tests — refinement #3:
   - Civ.boardableShips finds friendly transport ships with a free berth on
     adjacent water tiles (and refuses: other civs, occupied berths, units
     already aboard, naval/fly units)
   - the ⛴ Board action: board -> sail -> disembark across a strait
     (this is how a land unit reaches another landmass)
   - the passenger follows the ship while aboard and is lost if it sinks */
const fs = require('fs'); const path = require('path');
global.window = {};
for (const f of ['data.js','mapgen.js','game.js','ai.js'])
  (new Function(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8')))();
const Civ = global.window.Civ;

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAIL: ' + msg); };

Civ.newGame({ seed: 7, aiCount: 0, size: 16, difficulty: 'easy' });
const S = Civ.state, p = S.civs[0], enemy = S.civs[1];
for (const t of S.tiles) { t.terrain='ocean'; t.resource=null; t.road=false; }
for (const c of S.civs) { c.cities=[]; c.units=[]; c.explored={}; }

// island A (land): cols 3-4 ; water col 5-6 ; island B: col 7+
for (let y=0;y<S.H;y++) for (let x=0;x<S.W;x++) {
  if (x<=4) S.tiles[Civ.idx(x,y)].terrain='grassland';
  if (x>=7) S.tiles[Civ.idx(x,y)].terrain='grassland';
}
const T = Civ.UNIT_TYPES;
let uid = 500;
function unit(civ,type,x,y){ const u={id:++uid,civ,type,x,y,hp:100,mp:T[type].mp,moved:false}; civ.units.push(u); return u; }

const warrior = unit(p,'warrior',4,8);          // coast of island A
const ship    = unit(p,'transport',5,8);         // friendly transport on water next to warrior

// --- boardableShips ----------------------------------------------------
assert(Civ.boardableShips(warrior).length === 1, 'boardableShips finds the adjacent transport');
assert(Civ.boardableShips(warrior)[0] === ship, 'boardableShips returns the right ship');

// while aboard there is nothing to board
warrior.aboard = ship.id;
assert(Civ.boardableShips(warrior).length === 0, 'no boardable ships while already aboard');
warrior.aboard = null;

// occupied berth -> nothing to board
const other = unit(p,'warrior',4,7);
other.aboard = ship.id;
assert(Civ.boardableShips(warrior).length === 0, 'occupied berth offers no boarding');
other.aboard = null;

// enemy ship -> never boardable
const eship0 = unit(enemy,'transport',5,7);
assert(!Civ.boardableShips(warrior).some(s => s === eship0), 'enemy ship is never boardable');
enemy.units.splice(enemy.units.indexOf(eship0), 1);

// naval units have nothing to board
const sail = unit(p,'ship',5,6);
assert(Civ.boardableShips(sail).length === 0, 'naval units never board');
p.units.splice(p.units.indexOf(sail), 1);

// --- full flow: board -> sail -> disembark ------------------------------
// the reachable set must offer the ship tile to the human unit
let reach = Civ.reachable(warrior);
assert(reach.has('5,8'), 'reachable set includes the ship tile (boarding offered)');

assert(Civ.moveUnit(warrior,5,8), 'moveUnit onto the ship tile boards');
assert(warrior.aboard === ship.id, 'warrior is aboard');
assert(warrior.x === 5 && warrior.y === 8, 'aboard: warrior sits on the ship tile');

// sailing the ship carries the passenger
assert(Civ.moveUnit(ship,6,8), 'ship sails across the strait');
assert(warrior.x === 6 && warrior.y === 8, 'passenger followed the ship');

// disembark onto island B
assert(Civ.disembark(warrior), 'disembark succeeds on the far shore');
assert(warrior.aboard === null, 'aboard cleared after disembark');
const terr = S.tiles[Civ.idx(warrior.x,warrior.y)].terrain;
assert(terr === 'grassland', 'warrior landed on land, terrain=' + terr);

// --- passenger is lost if the ship sinks (real combat path) -------------
const warrior2 = unit(p,'warrior',6,8);
assert(Civ.board(warrior2, ship), 'second passenger boarded');
const eship = unit(enemy, 'war_galley', 6, 7);
let guard = 0;
while (p.units.indexOf(ship) !== -1 && guard++ < 5) Civ.doCombat(eship, ship);
assert(p.units.indexOf(ship) === -1, 'ship sunk by the enemy warship');
assert(p.units.indexOf(warrior2) === -1, 'passenger lost with the ship');

console.log('transport: OK (boardableShips + board -> sail -> disembark + sunk carrier drops passenger)');
