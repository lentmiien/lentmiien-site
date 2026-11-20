/* =====================================================================
 * data.js — game data: terrain, resources, units, buildings, tech tree
 *
 * Domains:
 *   - land  : cannot enter water; mountains impassable; terrain cost applies
 *   - naval : water only
 *   - air   : flies anywhere (incl. mountains / water), cost 1
 *   - costCap: a unit never pays more than this per tile (e.g. settlers
 *     cross any land terrain)
 *   - road  : built by settlers, cuts land movement cost to 1
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  Civ.ERAS = ['Ancient', 'Medieval', 'Industrial', 'Modern'];

  /* Maximum cities a single civilization may found (shared by player & AI).
     Kept high on purpose: the old hard cap of 8 silently stopped the game
     from producing more settlers once hit (see feedback #7). */
  Civ.MAX_CITIES = 20;
  // Soft cap on per-city science from buildings/techs/wonders
  // (base population science is uncapped). Keeps late-game
  // research from collapsing into a handful of turns.
  Civ.SCI_BONUS_CAP = 8;

  /* ------------------------------ Terrain --------------------------- */
  // cost = base movement cost, defend = defense bonus, 0 cost = impassable
  // (land cost 0 = mountains; water is handled by the naval/air domains)
  Civ.TERRAIN = {
    ocean:     { name: 'Ocean',     food: 0, prod: 0, land: false, cost: 0,  defend: 0,  desc: 'Deep sea. Only ships and planes can enter. Fish resources may spawn here.' },
    grassland: { name: 'Grassland', food: 2, prod: 1, land: true,  cost: 1,  defend: 0,  desc: 'Fertile land. +2 food. Cheap to cross (1 mp).' },
    plains:    { name: 'Plains',    food: 1, prod: 2, land: true,  cost: 1,  defend: 1,  desc: 'Open country. +1 food, +2 shields. Cheap to cross (1 mp).' },
    forest:    { name: 'Forest',    food: 1, prod: 1, land: true,  cost: 2,  defend: 2,  desc: 'Dense woods. +1 food, +1 shield. Slower to cross (2 mp) and a defensive position.' },
    hills:     { name: 'Hills',     food: 0, prod: 2, land: true,  cost: 2,  defend: 3,  desc: 'Rolling highlands. +2 shields. Slow (2 mp) but a strong defensive position.' },
    mountains: { name: 'Mountains', food: 0, prod: 0, land: true,  cost: 0,  defend: 50, desc: 'Impassable to all land & sea units — only planes can fly over. Very strong defense.' },
    desert:    { name: 'Desert',    food: 1, prod: 0, land: true,  cost: 2,  defend: 0,  desc: 'Arid wasteland. +1 food only. Slow to cross (2 mp).' },
    tundra:    { name: 'Tundra',    food: 1, prod: 0, land: true,  cost: 2,  defend: 0,  desc: 'Barren frozen ground. +1 food only. Slow to cross (2 mp).' },
  };

  Civ.TERRAIN_COLORS = {
    ocean:     '#2a5d8f',
    grassland: '#57963f',
    plains:    '#a3a84e',
    forest:    '#2f6b2f',
    hills:     '#8a7a46',
    mountains: '#8d8d93',
    desert:    '#d9c27a',
    tundra:    '#a8b8a0',
  };

  /* ----------------------------- Resources -------------------------- */
  Civ.RESOURCES = {
    wheat: { name: 'Wheat',  food: 2, prod: 0, gold: 0, on: ['grassland', 'plains', 'tundra'] },
    horse: { name: 'Horse',  food: 0, prod: 2, gold: 0, on: ['plains', 'grassland'] },
    iron:  { name: 'Iron',   food: 0, prod: 2, gold: 0, on: ['hills', 'plains'] },
    gold:  { name: 'Gold',   food: 0, prod: 0, gold: 2, on: ['grassland', 'plains', 'desert'] },
    sheep: { name: 'Sheep',  food: 1, prod: 1, gold: 0, on: ['grassland', 'plains'] },
    fish:  { name: 'Fish',   food: 2, prod: 0, gold: 0, on: ['ocean'] },
  };

  /* ------------------------------- Units ---------------------------- */
  // cost=production, mp=movement, atk/def, req=unlocking tech,
  // naval/fly=domain, costCap=never pay more than this per tile,
  // canRoad=may build roads, desc=tooltip
  Civ.UNIT_TYPES = {
    settler:    { name: 'Settler',       abbr: 'SET', cost: 30,  mp: 2, atk: 0,  def: 1,  req: null,            costCap: 2, canRoad: true, desc: 'Founds new cities. Can also build Roads (cheaper movement for land units). Crosses any land terrain.' },
    warrior:    { name: 'Warrior',       abbr: 'WRR', cost: 18,  mp: 2, atk: 3,  def: 2,  req: null,            desc: 'Basic infantry. Balanced, cheap, available from the start.' },
    spearman:   { name: 'Spearman',      abbr: 'SPE', cost: 22,  mp: 1, atk: 3,  def: 4,  req: null,            desc: 'Defensive infantry. Slower but tougher than the Warrior.' },
    archer:     { name: 'Archer',        abbr: 'ARC', cost: 28,  mp: 1, atk: 4,  def: 2,  req: 'archery',       desc: 'Ranged infantry. Good attack, weak defense.' },
    longbowman: { name: 'Longbowman',    abbr: 'LGB', cost: 42,  mp: 1, atk: 6,  def: 2,  req: 'archery',       desc: 'Powerful ranged infantry, a step above the Archer.' },
    chariot:    { name: 'Chariot',       abbr: 'CHR', cost: 45,  mp: 4, atk: 5,  def: 3,  req: 'thewheel',      desc: 'Fast wheeled skirmisher. High movement.' },
    horseman:   { name: 'Horseman',      abbr: 'HOR', cost: 42,  mp: 4, atk: 6,  def: 3,  req: 'horsebreeding', desc: 'Cavalry. Fast and hard-hitting.' },
    knight:     { name: 'Knight',        abbr: 'KNI', cost: 50,  mp: 4, atk: 7,  def: 4,  req: 'horsebreeding', desc: 'Armored heavy cavalry. Strong attack and defense.' },
    longswordsman:{ name: 'Longswordsman', abbr: 'LSW', cost: 36, mp: 2, atk: 5,  def: 6,  req: 'law',          desc: 'Elite infantry with heavy defensive capability.' },
    catapult:   { name: 'Catapult',      abbr: 'CTL', cost: 55,  mp: 1, atk: 8,  def: 2,  req: 'masonry',       desc: 'Siege engine. Devastating attack, very fragile.' },
    ship:       { name: 'Ship',          abbr: 'SHI', cost: 40,  mp: 3, atk: 3,  def: 4,  req: 'sailing',       naval: true, transport: true, desc: 'War galley of the ancient seas. Water only. Carries one land unit across the sea.' },
    transport:  { name: 'Transport Ship',abbr: 'TRA', cost: 48,  mp: 2, atk: 0,  def: 3,  req: 'sailing',       naval: true, transport: true, desc: 'Troop carrier. A land unit on the coast (including Settlers) boards from an adjacent water tile, rides to the other shore and disembarks. Carries one unit; the passenger dies with the ship. It cannot attack.' },
    war_galley: { name: 'War Galley',    abbr: 'GAL', cost: 60,  mp: 3, atk: 6,  def: 4,  req: 'astrolabe',     naval: true, transport: true, desc: 'Improved warship with stronger armament. Also carries one land unit.' },
    steamship:  { name: 'Steamship',     abbr: 'SSM', cost: 80,  mp: 4, atk: 5,  def: 5,  req: 'steam',         naval: true, desc: 'Steam-powered warship. Fast and tough.' },
    battleship: { name: 'Battleship',    abbr: 'BTS', cost: 110, mp: 3, atk: 10, def: 8,  req: 'steel',         naval: true, desc: 'The most powerful sea unit. Huge attack and defense.' },
    musketeer:  { name: 'Musketeer',     abbr: 'MUS', cost: 63,  mp: 2, atk: 8,  def: 4,  req: 'gunpowder',     desc: 'Gunpowder infantry. Replaces the archer.' },
    cannon:     { name: 'Cannon',        abbr: 'CAN', cost: 72,  mp: 1, atk: 9,  def: 4,  req: 'gunpowder',     desc: 'Field artillery. Heavy attack, slow.' },
    rifleman:   { name: 'Rifleman',      abbr: 'RIF', cost: 80,  mp: 2, atk: 8,  def: 5,  req: 'chemistry',     desc: 'Rifled infantry. Replaces the musketeer.' },
    gunship:    { name: 'Gunship',       abbr: 'GUN', cost: 95,  mp: 3, atk: 8,  def: 6,  req: 'ballistics',    naval: true, desc: 'Fast coastal warship. Strong attacker.' },
    plane:      { name: 'Plane',         abbr: 'PLA', cost: 135, mp: 6, atk: 9,  def: 5,  req: 'flight',        fly: true,   desc: 'Strategic bomber. Flies over any terrain, including mountains & sea.' },
    rocket:     { name: 'Rocket',        abbr: 'RKT', cost: 225, mp: 7, atk: 16, def: 3,  req: 'rocketry',      fly: true,   desc: 'Long-range strategic weapon. Massive attack, fragile.' },
    phalanx:    { name: 'Phalanx',       abbr: 'PHA', cost: 38,  mp: 1, atk: 5,  def: 5,  req: 'bronze',        desc: 'Shield-wall infantry. Solid attack and heavy defense.' },
    paladin:    { name: 'Paladin',       abbr: 'PAL', cost: 62,  mp: 3, atk: 8,  def: 6,  req: 'chivalry',      desc: 'Armored knight-errant. Fast, strong in attack and defense.' },
    carrack:    { name: 'Carrack',       abbr: 'CRK', cost: 70,  mp: 3, atk: 2,  def: 6,  req: 'navigation',    naval: true, transport: true, desc: 'Merchant-of-war carrack. Water only. Carries one land unit across the sea.' },
    engineer:   { name: 'Engineer',      abbr: 'ENG', cost: 60,  mp: 2, atk: 0,  def: 1,  req: 'locomotion',    canRoad: true, desc: 'Railroad engineer. Builds Roads (cheaper land movement). Cannot attack.' },
    mech:       { name: 'Mech',          abbr: 'MEC', cost: 160, mp: 4, atk: 12, def: 9,  req: 'robotics',      desc: 'Robotic combat unit. Heavy attack and defense.' },
    missile:    { name: 'Missile',       abbr: 'MIS', cost: 200, mp: 2, atk: 18, def: 2,  req: 'missiles',      desc: 'Guided missile battery. Strongest attack on the field, very fragile.' },
  };

  /* ----------------------------- Buildings -------------------------- */
  // cost, per-city yields (food/prod/sci/gold), def=city defense, heal,
  // req=unlocking tech, wonder=one per playthrough (first city to finish
  // claims it; its bonus applies to ALL of that civ's cities)
  Civ.BUILDINGS = {
    farm:        { name: 'Farm',          cost: 25,  food: 2, prod: 0, sci: 0,  gold: 0, def: 0, heal: 0,  req: null,        desc: '+2 food. Speeds up city growth.' },
    monument:    { name: 'Monument',      cost: 35,  food: 0, prod: 0, sci: 1,  gold: 0, def: 0, heal: 0,  req: null,        desc: '+1 science per turn.' },
    barracks:    { name: 'Barracks',      cost: 35,  food: 0, prod: 1, sci: 0,  gold: 0, def: 2, heal: 0,  req: null,        desc: '+1 shield, +2 defense for units defending this city.' },
    wall:        { name: 'Wall',          cost: 45,  food: 0, prod: 0, sci: 0,  gold: 0, def: 5, heal: 0,  req: null,        desc: '+5 defense for units defending this city.' },
    market:      { name: 'Market',        cost: 45,  food: 0, prod: 0, sci: 0,  gold: 2, def: 0, heal: 0,  req: 'currency',  desc: '+2 gold per turn from trade.' },
    temple:      { name: 'Temple',        cost: 55,  food: 0, prod: 0, sci: 1,  gold: 1, def: 0, heal: 0,  req: 'theology',  desc: '+1 science, +1 gold.' },
    library:     { name: 'Library',       cost: 60,  food: 0, prod: 0, sci: 2,  gold: 0, def: 0, heal: 0,  req: 'writing',   desc: '+2 science per turn.' },
    aqueduct:    { name: 'Aqueduct',      cost: 60,  food: 3, prod: 0, sci: 0,  gold: 0, def: 0, heal: 0,  req: 'masonry',   desc: '+3 food. Big boost to city growth.' },
    castle:      { name: 'Castle',        cost: 70,  food: 0, prod: 1, sci: 0,  gold: 0, def: 4, heal: 0,  req: 'law',       desc: '+1 shield, +4 defense for defenders.' },
    academy:     { name: 'Academy',       cost: 75,  food: 0, prod: 0, sci: 3,  gold: 0, def: 0, heal: 0,  req: 'philosophy',desc: '+3 science per turn.' },
    lighthouse:  { name: 'Lighthouse',    cost: 75,  food: 0, prod: 0, sci: 0,  gold: 2, def: 0, heal: 0,  req: 'astrolabe', desc: '+2 gold per turn from maritime trade.' },
    observatory: { name: 'Observatory',   cost: 95,  food: 1, prod: 0, sci: 3,  gold: 0, def: 0, heal: 0,  req: 'astronomy', desc: '+3 science, +1 food.' },
    university:  { name: 'University',    cost: 120, food: 0, prod: 0, sci: 4,  gold: 0, def: 0, heal: 0,  req: 'printing',  desc: '+4 science per turn.' },
    hospital:    { name: 'Hospital',      cost: 120, food: 0, prod: 0, sci: 0,  gold: 0, def: 0, heal: 20, req: 'medicine',  desc: 'Units in this city heal +20 HP per turn (faster recovery).' },
    factory:     { name: 'Factory',       cost: 135, food: 0, prod: 4, sci: 0,  gold: 0, def: 0, heal: 0,  req: 'steam',     desc: '+4 shields. Industrial production.' },
    radio_tower: { name: 'Radio Tower',   cost: 130, food: 0, prod: 0, sci: 2,  gold: 2, def: 0, heal: 0,  req: 'radio',     desc: '+2 science, +2 gold.' },
    steelmill:   { name: 'Steel Mill',    cost: 140, food: 0, prod: 5, sci: 0,  gold: 0, def: 0, heal: 0,  req: 'steel',     desc: '+5 shields. Heavy industrial output.' },
    powerplant:  { name: 'Power Plant',   cost: 165, food: 0, prod: 3, sci: 3,  gold: 0, def: 0, heal: 0,  req: 'electricity', desc: '+3 shields, +3 science.' },

    supermarket:  { name: 'Supermarket',  cost: 110, food: 1, prod: 0, sci: 0,  gold: 2, def: 0, heal: 0,  req: 'economics', desc: '+1 food, +2 gold. Mass retail trade.' },
    stock_exchange:{ name: 'Stock Exchange', cost: 150, food: 0, prod: 0, sci: 0,  gold: 3, def: 0, heal: 0, req: 'accounting', desc: '+3 gold. Global markets.' },
    hangar:      { name: 'Hangar',       cost: 140, food: 0, prod: 2, sci: 0,  gold: 1, def: 0, heal: 0,  req: 'flight',    desc: '+2 shields, +1 gold. Air-support infrastructure.' },
    research_lab:{ name: 'Research Lab', cost: 180, food: 0, prod: 0, sci: 4,  gold: 0, def: 0, heal: 0,  req: 'computers', desc: '+4 science. Modern research.' },

    /* ----------------------------- WONDERS -------------------------- */
    /* One per playthrough: the first city to finish one claims it. Its
       bonus then applies to ALL cities of that civilization. A rival
       (or the same civ) building it again after it is claimed gets
       nothing. */
    pyramid:     { name: 'Great Pyramid', cost: 350, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'masonry',   wonder: true, wonderBonus: { food: 2, prod: 2, gold: 0, def: 0, sci: 0 }, desc: 'WONDER (once per game): +2 food & +2 shields to every city of your empire.' },
    greatwall:   { name: 'Great Wall',    cost: 400, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'law',       wonder: true, wonderBonus: { food: 0, prod: 0, gold: 0, def: 5, sci: 0 }, desc: 'WONDER (once per game): +5 defense to every unit defending any of your cities.' },
    colossus:    { name: 'Colossus',      cost: 300, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'astrolabe', wonder: true, wonderBonus: { food: 0, prod: 0, gold: 3, def: 0, sci: 0 }, desc: 'WONDER (once per game): +3 gold to every city of your empire.' },
    hanging_gardens:{ name: 'Hanging Gardens', cost: 320, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'irrigation', wonder: true, wonderBonus: { food: 3, prod: 0, gold: 0, def: 0, sci: 0 }, desc: 'WONDER (once per game): +3 food to every city of your empire.' },
    moai:        { name: 'Moai',          cost: 300, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'masonry',   wonder: true, wonderBonus: { food: 0, prod: 3, gold: 0, def: 0, sci: 0 }, desc: 'WONDER (once per game): +3 shields to every city of your empire.' },
    great_lighthouse:{ name: 'Lighthouse of Alexandria', cost: 380, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'astrolabe', wonder: true, wonderBonus: { food: 0, prod: 0, gold: 2, def: 0, sci: 1 }, desc: 'WONDER (once per game): +2 gold & +1 science to every city of your empire.' },
    museum:      { name: 'National Museum', cost: 420, food: 0, prod: 0, sci: 0, gold: 0, def: 0, heal: 0, req: 'enlightenment', wonder: true, wonderBonus: { food: 0, prod: 0, gold: 1, def: 0, sci: 2 }, desc: 'WONDER (once per game): +2 science & +1 gold to every city of your empire.' },
  };

  /* ---------------------------- Tech tree --------------------------- */
  // bonus = global per-city yield bonus; unlockU / unlockB = unlocks
  // Costs: the Ancient era stays at its base value — the player tuned that
  // pace to feel good. Medieval/Industrial/Modern are scaled up below
  // (Civ.ERA_COST_SCALE) so late-game research stays a real investment even
  // with several science cities, instead of finishing in 1-2 turns.
  // Science bonuses per city are soft-capped (Civ.SCI_BONUS_CAP) so
  // stacking cities never collapses the tree.
  Civ.TECHS = [
    // --- Era 0 : Ancient ---
    { id: 'pottery',      name: 'Pottery',          era: 0, cost: 200,  req: [],                 bonus: { food: 2 },           desc: '+2 food to every city.' },
    { id: 'writing',      name: 'Writing',          era: 0, cost: 275,  req: [],                 bonus: { sci: 1 },            unlockB: ['library'], desc: '+1 science. Unlocks the Library and the Law tech.' },
    { id: 'husbandry',    name: 'Animal Husbandry', era: 0, cost: 200,  req: [],                 bonus: { prod: 1 },           desc: '+1 shield to every city.' },
    { id: 'mining',       name: 'Mining',           era: 0, cost: 275,  req: [],                 bonus: { prod: 1 },           desc: '+1 shield. Unlocks the Masonry tech.' },
    { id: 'archery',      name: 'Archery',          era: 0, cost: 375,  req: [],                 unlockU: ['archer', 'longbowman'], desc: 'Unlocks the Archer and Longbowman.' },
    { id: 'sailing',      name: 'Sailing',          era: 0, cost: 375,  req: [],                 unlockU: ['ship'], desc: 'Unlocks the Ship (first naval unit).' },
    { id: 'thewheel',     name: 'The Wheel',        era: 0, cost: 375,  req: ['husbandry'],      bonus: { prod: 1 }, unlockU: ['chariot'], desc: '+1 shield. Unlocks the Chariot.' },
    { id: 'masonry',      name: 'Masonry',          era: 0, cost: 475,  req: ['mining'],         bonus: { prod: 1 }, unlockB: ['aqueduct'], unlockU: ['catapult'], desc: '+1 shield. Unlocks the Aqueduct, Catapult, and the Great Pyramid wonder.' },
    { id: 'theology',     name: 'Theology',         era: 0, cost: 475,  req: [],                 unlockB: ['temple'], desc: 'Unlocks the Temple.' },
    { id: 'law',          name: 'Law',              era: 0, cost: 575,  req: ['writing'],        bonus: { sci: 1, gold: 1 }, unlockU: ['longswordsman'], unlockB: ['castle'], desc: '+1 science, +1 gold. Unlocks the Castle and Longswordsman, and the Great Wall wonder.' },
    { id: 'philosophy',   name: 'Philosophy',       era: 0, cost: 475,  req: ['writing'],        bonus: { sci: 2 }, unlockB: ['academy'], desc: '+2 science. Unlocks the Academy.' },
    { id: 'currency',     name: 'Currency',         era: 0, cost: 475,  req: ['writing'],        bonus: { gold: 2 }, unlockB: ['market'], desc: '+2 gold. Unlocks the Market.' },
    { id: 'mathematics',  name: 'Mathematics',      era: 0, cost: 675,  req: ['philosophy'],     bonus: { sci: 2 }, desc: '+2 science.' },
    { id: 'irrigation',   name: 'Irrigation',       era: 0, cost: 375,  req: ['pottery'],        bonus: { food: 1 }, desc: '+1 food to every city.' },
    { id: 'bronze',       name: 'Bronze Working',   era: 0, cost: 475,  req: ['mining'],         bonus: { prod: 1 }, unlockU: ['phalanx'], desc: '+1 shield. Unlocks the Phalanx.' },

    // --- Era 1 : Medieval ---
    { id: 'feudalism',    name: 'Feudalism',        era: 1, cost: 850,  req: ['theology'],       bonus: { food: 1, gold: 1 }, desc: '+1 food, +1 gold.' },
    { id: 'compass',      name: 'Compass',          era: 1, cost: 950,  req: ['sailing'],        bonus: { sci: 1 }, desc: '+1 science. Better navigation.' },
    { id: 'horsebreeding',name: 'Horse Breeding',   era: 1, cost: 950,  req: ['husbandry'],      unlockU: ['horseman', 'knight'], desc: 'Unlocks the Horseman and Knight.' },
    { id: 'guilds',       name: 'Guilds',           era: 1, cost: 950,  req: ['currency'],       bonus: { gold: 3 }, desc: '+3 gold.' },
    { id: 'machinery',    name: 'Machinery',        era: 1, cost: 1075,  req: ['mining'],         bonus: { prod: 2 }, desc: '+2 shields.' },
    { id: 'printing',     name: 'Printing',         era: 1, cost: 1200, req: ['theology'],       bonus: { sci: 2 }, unlockB: ['university'], desc: '+2 science. Unlocks the University.' },
    { id: 'gunpowder',    name: 'Gunpowder',        era: 1, cost: 1450, req: ['mathematics'],    unlockU: ['musketeer', 'cannon'], desc: 'Unlocks the Musketeer and Cannon.' },
    { id: 'astronomy',    name: 'Astronomy',        era: 1, cost: 1200, req: ['philosophy'],     bonus: { sci: 2 }, unlockB: ['observatory'], desc: '+2 science. Unlocks the Observatory.' },
    { id: 'astrolabe',    name: 'Astrolabe',        era: 1, cost: 1200, req: ['compass'],        bonus: { sci: 1, gold: 1 }, unlockU: ['war_galley'], unlockB: ['lighthouse'], desc: '+1 science, +1 gold. Unlocks the War Galley, Lighthouse, and the Colossus wonder.' },
    { id: 'chivalry',     name: 'Chivalry',         era: 1, cost: 1100, req: ['horsebreeding', 'law'], unlockU: ['paladin'], desc: 'Unlocks the Paladin.' },
    { id: 'banking',      name: 'Banking',          era: 1, cost: 1000, req: ['guilds'],         bonus: { gold: 2 }, desc: '+2 gold.' },
    { id: 'navigation',   name: 'Navigation',       era: 1, cost: 1300, req: ['astrolabe'],      bonus: { sci: 1 }, unlockU: ['carrack'], desc: '+1 science. Unlocks the Carrack (transport ship).' },

    // --- Era 2 : Industrial ---
    { id: 'medicine',     name: 'Medicine',         era: 2, cost: 1940, req: ['theology'],       unlockB: ['hospital'], desc: 'Faster unit healing. Unlocks the Hospital.' },
    { id: 'economics',    name: 'Economics',        era: 2, cost: 1940, req: ['guilds'],         bonus: { gold: 4 }, desc: '+4 gold.' },
    { id: 'chemistry',    name: 'Chemistry',        era: 2, cost: 2100, req: ['mathematics'],    unlockU: ['rifleman'], desc: 'Unlocks the Rifleman.' },
    { id: 'telegraph',    name: 'Telegraph',        era: 2, cost: 2250, req: ['electricity'],    bonus: { sci: 3 }, desc: '+3 science.' },
    { id: 'steam',        name: 'Steam Power',      era: 2, cost: 2400, req: ['machinery'],      bonus: { prod: 3 }, unlockB: ['factory'], unlockU: ['steamship'], desc: '+3 shields. Unlocks the Factory and the Steamship.' },
    { id: 'electricity',  name: 'Electricity',      era: 2, cost: 2565, req: ['chemistry'],      unlockB: ['powerplant'], desc: 'Unlocks the Power Plant.' },
    { id: 'steel',        name: 'Steel',            era: 2, cost: 2400, req: ['machinery'],      bonus: { prod: 2 }, unlockB: ['steelmill'], unlockU: ['battleship'], desc: '+2 shields. Unlocks the Steel Mill and the Battleship.' },
    { id: 'radio',        name: 'Radio',            era: 2, cost: 2690, req: ['telegraph'],      bonus: { sci: 2, gold: 1 }, unlockB: ['radio_tower'], desc: '+2 science, +1 gold. Unlocks the Radio Tower.' },
    { id: 'enlightenment',name: 'Enlightenment',    era: 2, cost: 2200, req: ['law', 'philosophy'], bonus: { sci: 2, gold: 1 }, desc: '+2 science, +1 gold.' },
    { id: 'locomotion',   name: 'Locomotion',       era: 2, cost: 2300, req: ['steam'],          bonus: { prod: 2 }, unlockU: ['engineer'], desc: '+2 shields. Unlocks the Engineer (also builds Roads).' },
    { id: 'botany',       name: 'Botany',           era: 2, cost: 2400, req: ['chemistry', 'medicine'], bonus: { food: 2 }, desc: '+2 food to every city.' },
    { id: 'accounting',   name: 'Accounting',       era: 2, cost: 2500, req: ['economics'],      bonus: { gold: 2 }, unlockB: ['stock_exchange'], desc: '+2 gold. Unlocks the Stock Exchange.' },

    // --- Era 3 : Modern ---
    { id: 'ballistics',   name: 'Ballistics',       era: 3, cost: 3225, req: ['gunpowder'],      unlockU: ['gunship'], desc: 'Unlocks the Gunship.' },
    { id: 'flight',       name: 'Flight',           era: 3, cost: 3600, req: ['electricity'],    unlockU: ['plane'], desc: 'Unlocks the Plane (air unit, flies over everything).' },
    { id: 'genetics',     name: 'Genetics',         era: 3, cost: 3975, req: ['medicine'],       bonus: { food: 3 }, desc: '+3 food to every city.' },
    { id: 'computers',    name: 'Computers',        era: 3, cost: 4315, req: ['telegraph'],      bonus: { sci: 5 }, desc: '+5 science.' },
    { id: 'rocketry',     name: 'Rocketry',         era: 3, cost: 4875, req: ['ballistics'],     unlockU: ['rocket'], desc: 'Unlocks the Rocket.' },
    { id: 'nuclear',      name: 'Nuclear Fission',  era: 3, cost: 5925, req: ['rocketry'],       bonus: { sci: 4 }, desc: 'The dawn of the atomic age. +4 science.' },
    { id: 'satellites',   name: 'Satellites',       era: 3, cost: 3800, req: ['computers', 'rocketry'], bonus: { sci: 2, gold: 1 }, desc: '+2 science, +1 gold.' },
    { id: 'robotics',     name: 'Robotics',         era: 3, cost: 4200, req: ['computers'],      bonus: { prod: 2 }, unlockU: ['mech'], desc: '+2 shields. Unlocks the Mech.' },
    { id: 'missiles',     name: 'Missiles',         era: 3, cost: 4600, req: ['nuclear'],        unlockU: ['missile'], desc: 'Unlocks the Missile (strongest attack).' },
  ];

  // Era cost scaling (refinement #4): Ancient ×1 (untouched — early pace
  // already feels good), Medieval ×1.25, Industrial ×1.75, Modern ×2.5,
  // rounded to the nearest 5. Tune here to change research pace.
  Civ.ERA_COST_SCALE = [1, 1.25, 1.75, 2.5];
  Civ.TECHS.forEach(function (t) {
    t.cost = Math.round((t.cost * (Civ.ERA_COST_SCALE[t.era] || 1)) / 5) * 5;
  });

  Civ.TECH_BY_ID = {};
  Civ.TECHS.forEach(function (t) { Civ.TECH_BY_ID[t.id] = t; });

  /* --------------------------- Names / colors ----------------------- */
  Civ.CIV_NAMES = ['Roma', 'Hellas', 'Macedonia', 'Carthage', 'Akkad', 'Vandals', 'Norse', 'Mongols'];
  Civ.CIV_COLORS = ['#e74c3c', '#3498db', '#e67e22', '#9b59b6', '#2ecc71', '#f1c40f', '#1abc9c', '#ec7063'];

  /* 24+ names; the engine adds numeric suffixes if the pool runs dry so a
     long game with many captured/founded cities never runs out. */
  Civ.CITY_NAMES = [
    'Avalon', 'Bastion', 'Camelot', 'Delphi', 'Ephesus', 'Fenrir', 'Gondor',
    'Helia', 'Ionia', 'Jorvik', 'Karnak', 'Lystra', 'Meroe', 'Nymea', 'Ophir',
    'Pylos', 'Quilon', 'Ravenna', 'Sardis', 'Thule', 'Uxkull', 'Vestnia',
    'Wakka', 'Xanadu', 'Zamora'
  ];

})(window.Civ);
