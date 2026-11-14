(function (root, factory) {
  const content = factory();
  if (typeof module === 'object' && module.exports) module.exports = content;
  else root.LumenwildContent = content;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BIOMES = [
    { name: 'Verdant Hollows', subtitle: 'Where the lanterns first took root', color: '#61d9a0', w: 29, h: 23, enemies: 6, tile: 0, layout: 'hedges', feature: 'grove', landmark: 'Root lantern', landmarkIcon: 6, clue: 'Light the three root lanterns in the realm marked on each stone.', kinds: [0, 0, 1], relics: ['First acorn', 'Firefly amber', 'The seedkeeper’s crown'] },
    { name: 'Moonwell Archive', subtitle: 'Even the stones remember the stars', color: '#79dce8', w: 31, h: 25, enemies: 7, tile: 4, layout: 'library', feature: 'mirrors', landmark: 'Memory lens', landmarkIcon: 8, clue: 'Wake the three lenses. Each returns a distant piece of the atlas.', kinds: [1, 0, 2], relics: ['Moonwater chalice', 'Moth-shaped key', 'Ink of the deep sky'] },
    { name: 'Glassbloom Conservatory', subtitle: 'A thousand flowers, waiting for dawn', color: '#e7a0d9', w: 33, h: 27, enemies: 7, tile: 8, layout: 'courtyards', feature: 'grove', landmark: 'Glass blossom', landmarkIcon: 14, clue: 'Bloom the three flowers to awaken the conservatory’s heart.', kinds: [0, 1, 2], relics: ['The first glassflower', 'The gardener’s mirror', 'A plan for tomorrow'] },
    { name: 'Tideweave Marsh', subtitle: 'Follow the bells across the water', color: '#68d8c8', w: 35, h: 27, enemies: 7, tile: 16, layout: 'canals', feature: 'ferries', landmark: 'Ferry bell', landmarkIcon: 44, clue: 'Ring all three ferry bells. Restored bells carry you to the next safe landing.', kinds: [3, 1, 3], relics: ['Tide-sung shell', 'The river’s first coin', 'A ship that never sank'] },
    { name: 'Saffron Orchard', subtitle: 'Autumn keeps its own kind of light', color: '#efb05e', w: 35, h: 29, enemies: 8, tile: 20, layout: 'groves', feature: 'grove', landmark: 'Harvest tree', landmarkIcon: 13, clue: 'Restore three harvest trees. Their roots open overgrown shortcuts.', kinds: [4, 0, 4], relics: ['The honey-amber apple', 'Copperleaf brooch', 'The patient shears'] },
    { name: 'Clockwork Cloister', subtitle: 'A garden measured in borrowed seconds', color: '#d7ba79', w: 37, h: 29, enemies: 8, tile: 24, layout: 'clockwork', feature: 'gears', landmark: 'Rootgear', landmarkIcon: 45, clue: 'Wind three rootgears to unlock permanent passages through the cloister.', kinds: [5, 2, 3], relics: ['The unwound hour', 'Clockwork butterfly', 'A sky held in brass'] },
    { name: 'Frostglass Grotto', subtitle: 'Nothing asleep is quite forgotten', color: '#a2dafa', w: 37, h: 31, enemies: 8, tile: 32, layout: 'caverns', feature: 'prisms', landmark: 'Thawing prism', landmarkIcon: 46, clue: 'Align three prisms with the proper realm to open the frozen paths.', kinds: [6, 1, 6], relics: ['The winter rose', 'A compass for snow', 'The silent feather'] },
    { name: 'Cinderroot Caldera', subtitle: 'Life begins again beneath the ash', color: '#ffa477', w: 39, h: 31, enemies: 9, tile: 36, layout: 'caldera', feature: 'vents', landmark: 'Cooling heart', landmarkIcon: 6, clue: 'Cool three hearts to quiet the warning vents. Echo shelters you from their heat.', kinds: [7, 2, 5], relics: ['The unhatched sunrise', 'A fire carried home', 'Cinderroot promise'] },
    { name: 'Astral Canopy', subtitle: 'Every distant light was once a seed', color: '#bab3ff', w: 39, h: 33, enemies: 9, tile: 40, layout: 'constellation', feature: 'stars', landmark: 'Star anchor', landmarkIcon: 47, clue: 'Wake star anchors I, II, III in order. They stitch shortcuts across the sky.', kinds: [8, 6, 8], relics: ['The wandering sphere', 'Dust from a new star', 'Crown of the far canopy'] },
  ];

  // The first nine identifiers are unchanged from the original release.
  const MEMORIES = [
    ['A light left on', 'The first keeper hung a lantern in the woods. Not to keep the dark out, but to give lost things somewhere to come home.'],
    ['The patient gardener', 'Every path was planted by someone who would never walk its full length. The garden remembers that kindness.'],
    ['Two sides of a leaf', 'Bloom is the garden as it lives. Echo is the garden as it dreams. Neither is the wrong side of the world.'],
    ['Moonwater', 'The archive has no ink. Its stories are kept in water, and read by the light of a patient moon.'],
    ['The small brave things', 'Before the keepers, the moths carried the light. Never mistake a small flame for a small courage.'],
    ['A map of returns', 'A good map tells you where to go. A beloved map tells you how to get home.'],
    ['The last glassblower', 'She made flowers that could hold the sunrise. When the sun disappeared, they kept its promise.'],
    ['Sleeping thorns', 'The sentinels are not cruel. They have simply forgotten what they were guarding. Let your lantern remind them.'],
    ['The folded garden', 'The world did not break. It folded itself around one last seed, and waited for someone gentle enough to unfold it.'],
    ['Beyond the roots', 'Pip found nine little marks beneath the first waygate. Three were leaves. The others were a shell, an apple, a gear, a snowflake, a coal, and a star.'],
    ['The unfinished path', 'The oldest map ended at the hedge. In the margin, another hand had written: this is where I stopped walking, not where the world ends.'],
    ['A keeper’s inheritance', 'There was no sword in the old keeper’s chest. Only spare wick, a packet of seeds, and enough tea for two.'],
    ['Borrowed names', 'Visitors once left a name with the archive and borrowed a story. Some returned to exchange them. Some discovered they had become the story.'],
    ['The missing volume', 'Shelf nine stood empty for a hundred years. Its label read: things we have not learned to ask. Pip left it empty a little longer.'],
    ['Letters to the tide', 'Every spring the librarians sent their unfinished sentences downstream. In autumn, replies arrived inside shells.'],
    ['A crack in the glass', 'One flower held a crack that no glassblower would repair. Through it, a real root had found the earth.'],
    ['A season kept safe', 'The conservatory could have preserved every summer forever. Its keeper chose to open the windows instead.'],
    ['Beyond the third gate', 'When the world-tree woke, its roots did not stop growing. Somewhere far away, six forgotten bells began to ring.'],
    ['The ferryman’s debt', 'The ferryman charged one story for each crossing. Children always travelled free; they were still gathering their fare.'],
    ['A home with no walls', 'The marsh folk built their houses on rafts. Home was not a place that stayed still. It was a place that came with you.'],
    ['Tideweave', 'At low tide the paths belong to feet. At high tide they belong to fish. The reeds remember both maps.'],
    ['The river coin', 'The first coin was not money. It was a promise that someone would return with a boat when the rain came.'],
    ['Three bells', 'One bell called the ferry. Another called the fog. Nobody admitted what the third bell called, but everyone kept it polished.'],
    ['Downstream stars', 'Pip watched stars float in the black water. The ferryman said they were the sky’s seeds, looking for somewhere to take root.'],
    ['The last harvest', 'The orchard’s last harvest filled one basket. Its keeper planted every apple and went hungry that winter.'],
    ['The copper leaves', 'The leaves turn copper so the trees can count the light they have kept. No two autumns add up the same.'],
    ['Someone else’s shade', 'A small sign beside the youngest tree read: for whoever needs to sit down next.'],
    ['The amber apple', 'It never spoiled, never ripened, and never tasted of anything. The orchard kept it as a reminder that lasting forever is not the same as living.'],
    ['A useful mistake', 'The maze began as a pruning mistake. The gardener liked where it led, and stopped apologising.'],
    ['What the roots share', 'The oldest tree fed the youngest through roots no one could see. Above ground, they appeared to stand alone.'],
    ['Borrowed seconds', 'The cloister’s clocks were built to lend time to tired gardeners. Nobody thought to ask who would wind them when the gardeners were gone.'],
    ['The brass butterfly', 'Its maker gave it no destination. A machine should be allowed to be curious too, she said.'],
    ['A little late', 'The great clock loses a minute every day. By evening, someone always needs that minute more than the clock does.'],
    ['A gentle mechanism', 'The rootgears were engineered to stop if a seed fell between their teeth. Their creator considered this the most important specification.'],
    ['The unwound hour', 'Inside the smallest watch was one hour that had never happened. Pip decided to save it for a friend.'],
    ['The cloister opens', 'As the last gear turned, the gates opened in both worlds. Beyond them grew a flower the machines had been protecting all along.'],
    ['Under the ice', 'The grotto is not silent. It is holding its breath so the seeds beneath the ice can sleep.'],
    ['The winter rose', 'A traveller asked why anyone would plant a rose here. The keeper answered: because spring should have something to find.'],
    ['A compass for snow', 'This compass points to warmth. Once, in a blizzard, its needle turned towards another traveller.'],
    ['Slow light', 'Light takes its time in the frostglass. A sunrise enters at one end and arrives at the other as a memory of summer.'],
    ['The owl’s gift', 'The owl left one feather beside the lantern. Pip tucked it into the journal, where the cold could not follow.'],
    ['The first drop', 'The thaw began with one drop of water. No one heard it. By morning, the entire cave was singing.'],
    ['The cinder nursery', 'The caldera’s ash carries every mineral a new forest needs. Destruction is not its only story.'],
    ['A fire carried home', 'The keeper crossed the mountain with a coal in a little black lantern. At home, one coal became a hundred hearths.'],
    ['The patient ember', 'Some seeds open only after fire. They wait for the moment everyone else calls the end.'],
    ['Cooling hearts', 'The stone hearts draw heat away from the roots. They were never built to put the fire out, only to make room for life beside it.'],
    ['The salamander’s path', 'The salamander leaves warm footprints in cold ash. Tiny green shoots follow a day behind.'],
    ['The unhatched sunrise', 'Pip held the egg against one ear. Inside it sounded like birds, morning rain, and a door opening.'],
    ['The far canopy', 'The highest branches have no leaves. Their seeds drift so far from the tree that we call them stars.'],
    ['The wandering sphere', 'The sphere contains no map. It remembers the places its owner has loved and gently turns towards them.'],
    ['Three anchors', 'The anchors hold no chains. A constellation stays together because each star remembers where the others should be.'],
    ['The moth’s lantern', 'In the far dark, the moths do not follow light. They carry it to places that have never seen any.'],
    ['A crown for nobody', 'The last keeper refused the crown. Leave it here, she said. A garden should not need a king.'],
    ['Room for another path', 'Pip reached the end of the oldest map and unfolded a blank page. The first mark was a little lantern. The second was a way home.'],
  ];

  BIOMES.forEach((biome, index) => {
    biome.memories = index < 3 ? [index * 3, index * 3 + 1, index * 3 + 2, 9 + index * 3, 10 + index * 3, 11 + index * 3] : Array.from({ length: 6 }, (_, i) => 18 + (index - 3) * 6 + i);
  });
  const RELICS = BIOMES.flatMap((biome, region) => biome.relics.map((name, i) => ({ id: region * 3 + i, name, region, icon: 16 + region * 3 + i })));
  const TRAILS = [
    { id: 'dawn', name: 'The First Light', subtitle: 'Follow the roots of the waking tree', route: [0, 1, 2], requires: null, icon: 1 },
    { id: 'frontier', name: 'The Amber Frontier', subtitle: 'Across tide, harvest, and turning gears', route: [3, 4, 5], requires: 'dawn', icon: 44 },
    { id: 'horizon', name: 'The Far Horizon', subtitle: 'Through frost and fire into the stars', route: [6, 7, 8], requires: 'frontier', icon: 47 },
    { id: 'pilgrimage', name: 'The Long Way Home', subtitle: 'A saved pilgrimage through all nine regions', route: [0, 3, 4, 1, 5, 6, 2, 7, 8], requires: 'horizon', icon: 42 },
  ];
  const ENEMIES = [
    { name: 'Thorn beetle', hp: 3, damage: 1, windup: .85, move: .85, rest: 1.05, range: 1, pattern: 'cross', hint: 'A close bite. Dodge sideways or guard the marked cross.' },
    { name: 'Moonwisp', hp: 4, damage: 1, windup: 1.15, move: 1, rest: 1.4, range: 4, pattern: 'target', hint: 'Aims at your current tile. Move before its circle closes.' },
    { name: 'Garden sentinel', hp: 6, damage: 2, windup: 1.25, move: 1.25, rest: 1.7, range: 1, pattern: 'ring', hint: 'A heavy slam around its body. Guard or dash clear.' },
    { name: 'Tideglass crab', hp: 5, damage: 1, windup: .95, move: 1, rest: 1.2, range: 2, pattern: 'line', hint: 'Snaps down a straight channel. Step out of its line.' },
    { name: 'Copperleaf mantis', hp: 4, damage: 2, windup: 1.05, move: .7, rest: 1.35, range: 3, pattern: 'line', hint: 'A long leaf-blade lunge. Its marked lane shows the entire reach.' },
    { name: 'Clockwork scarab', hp: 6, damage: 1, windup: 1.05, move: .85, rest: 1.2, range: 2, pattern: 'cross', hint: 'Fires along both axes. Diagonal ground is safer.' },
    { name: 'Frostglass owl', hp: 4, damage: 1, windup: 1.2, move: 1, rest: 1.4, range: 4, pattern: 'fan', hint: 'Throws a broad fan of frost. Retreat or guard it.' },
    { name: 'Ember salamander', hp: 6, damage: 2, windup: 1.15, move: .9, rest: 1.5, range: 3, pattern: 'line', hint: 'Breathes fire along its lane. Watch the ground, not its tail.' },
    { name: 'Astral moth', hp: 5, damage: 2, windup: 1.3, move: .85, rest: 1.4, range: 5, pattern: 'burst', hint: 'Marks your tile and its neighbours. Dash beyond the whole pattern.' },
  ];
  const BLESSINGS = [
    { id: 'radiance', name: 'Sunfire lantern', text: 'Your lantern sweep deals +1 damage.', icon: 6 },
    { id: 'reach', name: 'Long summer', text: 'Your sweep reaches one tile farther.', icon: 14 },
    { id: 'vitality', name: 'Wild heart', text: 'Gain two maximum hearts and heal fully.', icon: 1 },
    { id: 'drift', name: 'Mothstep', text: 'Dash one tile farther; recover it sooner.', icon: 15 },
    { id: 'harvest', name: 'Kindred roots', text: 'Defeating a creature restores one heart.', icon: 12 },
    { id: 'echo', name: 'Echo mantle', text: 'Shifting grants a longer protective shield.', icon: 4 },
    { id: 'sight', name: 'Stargazer', text: 'See farther; guiding threads last twice as long.', icon: 8 },
    { id: 'satchel', name: 'Pocket alchemy', text: 'Receive two medicines, seedbombs, and threads.', icon: 3 },
    { id: 'quick', name: 'Swift wick', text: 'Your sweep recovers 20% faster.', icon: 17 },
    { id: 'counter', name: 'River mirror', text: 'A successful guard deals two extra counter damage.', icon: 23 },
    { id: 'focus', name: 'Deep well', text: 'Gain two focus capacity and recharge arts faster.', icon: 32 },
    { id: 'roots', name: 'Gentle roots', text: 'Your equipped art also heals one heart.', icon: 39 },
    { id: 'alchemist', name: 'Garden alchemist', text: 'Tonics also refill focus; bombs deal two extra damage.', icon: 21 },
    { id: 'thorns', name: 'Briar coat', text: 'A creature that hurts you takes two damage.', icon: 29 },
    { id: 'patience', name: 'Winter patience', text: 'Enemy wind-ups last 20% longer.', icon: 34 },
    { id: 'finder', name: 'Wayfinder', text: 'Heartseeds and the regional relic are marked on your atlas.', icon: 40 },
  ];
  const UPGRADES = [
    { id: 'hearth', name: 'Keeper’s hearth', text: '+1 starting heart per level', icon: 10, costs: [18, 34, 52, 150, 260, 420] },
    { id: 'satchel', name: 'Herbalist’s satchel', text: '+1 starting tonic and seedbomb per level', icon: 2, costs: [15, 30, 45, 140, 250, 400] },
    { id: 'lens', name: 'Firefly observatory', text: '+1 sight radius per level', icon: 14, costs: [20, 36, 54, 180, 320] },
    { id: 'ward', name: 'Mirror workshop', text: 'Longer guard window with each level', icon: 23, costs: [55, 90, 150, 240, 380] },
    { id: 'focus', name: 'The deep well', text: '+1 focus capacity for equipped arts', icon: 32, costs: [60, 100, 170, 270, 430] },
  ];
  const ARTS = [
    { id: 'gust', name: 'Lantern gale', icon: 15, cost: 2, text: 'Daze nearby foes for 1.5 seconds and deal one damage.', requirement: 'Available to every keeper.' },
    { id: 'snare', name: 'Briar binding', icon: 39, cost: 3, text: 'Root and silence nearby foes for 3 seconds; deal two damage.', requirement: 'Discover 3 different regional relics.' },
    { id: 'lance', name: 'Astral lance', icon: 40, cost: 3, text: 'Strike every foe in a five-tile line for five damage.', requirement: 'Restore the Clockwork Cloister.' },
    { id: 'mend', name: 'Moonwell shelter', icon: 19, cost: 4, text: 'Restore four hearts and gain a 1.5-second shield.', requirement: 'Restore the Frostglass Grotto.' },
    { id: 'nova', name: 'Cinder blossom', icon: 37, cost: 4, text: 'Deal four damage and daze nearby foes in a large burst.', requirement: 'Restore the Caldera and discover 9 relics.' },
    { id: 'stars', name: 'The far lantern', icon: 42, cost: 5, text: 'Strike visible foes for four damage and gain a protective shield.', requirement: 'Finish The Far Horizon and discover 18 relics.' },
  ];
  return { BIOMES, MEMORIES, RELICS, TRAILS, ENEMIES, BLESSINGS, UPGRADES, ARTS };
}));
