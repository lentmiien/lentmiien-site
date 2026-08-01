'use strict';

(function exposeStory(root) {
  const scenes = {
    prologue_intro: {
      id: 'prologue_intro',
      kind: 'cinematic',
      title: 'A basket for home',
      chapter: 'Prologue · Before the smoke',
      image: 'assets/images/environments/title-key-art.webp',
      imageAlt: 'Aren looks across the Hand-shaped continent beneath an eclipsed moon, with seven distant crystal circles and a gate between worlds.',
      steps: [
        {
          type: 'narration',
          text: 'On the eastern finger of Asterra, beyond the roads important people bothered to map, Willowmere was having an ordinary afternoon.',
          audio: 'narrator_intro_birchwood',
        },
        {
          type: 'narration',
          text: 'Aren Vale was nineteen and knew every path within a day of home. He worked wherever Willowmere needed an extra pair of hands—orchard, mill, leaking roof—and kept promising himself he would choose a life beyond the eastern finger after winter.',
        },
        {
          type: 'narration',
          text: 'Three weeks of rain had emptied the village pantry and filled Birchwood with mushrooms. Aren’s mother, Nessa, planned to stretch the last barley into supper for the neighbors repairing the storm fence. His father, Tomas, mended the old gathering basket and requested enough fox-ears to rescue his famously stubborn bread.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'neutral',
          text: 'Coppercaps, moonbells, fox-ears. Three baskets in one, and home before the stew gives up on me.',
          audio: 'aren_intro_mushrooms',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'relieved',
          text: 'Then, after supper, I tell Mum and Dad I might take the winter courier road. That is a perfectly ordinary amount of courage for one afternoon.',
        },
        {
          type: 'narration',
          text: 'Birchwood stood one quiet hour above Willowmere. Aren had gathered here since childhood, but he still checked the birch roots, the damp side of fallen logs, and every track crossing the path. Familiar did not mean empty.',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'Move with WASD or the arrow keys. Walk near a glowing amber marker, then press E, Enter, or Space to interact. On touch screens, use the directional pad and Interact button.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'objective', text: 'Gather coppercaps, moonbells, and fox-ears.' },
        ],
      },
    },

    mushroom_coppercap: {
      id: 'mushroom_coppercap',
      kind: 'dialogue',
      title: 'Coppercaps',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'neutral',
          text: 'Dry gills, clean stems. Dad taught me to cut them above the soil so the patch returns. He will still claim the basket did the difficult part.',
        },
        {
          type: 'narration',
          text: 'The coppercaps settle into the basket beside Tomas’s neat new willow binding.',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'All three mushroom kinds collected. Follow the southern trail home.',
          when: { counter: 'mushroomsGathered', gte: 2 },
        },
      ],
      onComplete: {
        effects: [
          { type: 'increment', key: 'mushroomsGathered', amount: 1 },
          { type: 'addItem', id: 'coppercaps', name: 'Coppercaps' },
          { type: 'objective', text: 'Return to Willowmere by the southern trail.', when: { counter: 'mushroomsGathered', gte: 3 } },
        ],
      },
    },

    mushroom_moonbell: {
      id: 'mushroom_moonbell',
      kind: 'dialogue',
      title: 'Moonbells',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'relieved',
          text: 'Moonbells. Mum dries the smallest ones with pepperleaf. Half a handful can make barley taste like we planned it that way.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'neutral',
          text: 'Mum will feed the fence crew first and pretend she forgot to save herself a bowl. I will save it for her this time.',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'All three mushroom kinds collected. Follow the southern trail home.',
          when: { counter: 'mushroomsGathered', gte: 2 },
        },
      ],
      onComplete: {
        effects: [
          { type: 'increment', key: 'mushroomsGathered', amount: 1 },
          { type: 'addItem', id: 'moonbells', name: 'Moonbells' },
          { type: 'objective', text: 'Return to Willowmere by the southern trail.', when: { counter: 'mushroomsGathered', gte: 3 } },
        ],
      },
    },

    mushroom_foxear: {
      id: 'mushroom_foxear',
      kind: 'dialogue',
      title: 'Fox-ears',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'relieved',
          text: 'Fox-ears. Dad gets his bread, Mum gets her full bowl, and I get to complain about chores while eating the result.',
        },
        {
          type: 'narration',
          text: 'The basket is heavier than when Aren climbed the ridge. Below the trees, Willowmere’s supper bell should ring before the light leaves the eastern fields.',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'All three mushroom kinds collected. Follow the southern trail home.',
          when: { counter: 'mushroomsGathered', gte: 2 },
        },
      ],
      onComplete: {
        effects: [
          { type: 'increment', key: 'mushroomsGathered', amount: 1 },
          { type: 'addItem', id: 'foxears', name: 'Fox-ear mushrooms' },
          { type: 'objective', text: 'Return to Willowmere by the southern trail.', when: { counter: 'mushroomsGathered', gte: 3 } },
        ],
      },
    },

    inspect_gate_stone: {
      id: 'inspect_gate_stone',
      kind: 'dialogue',
      title: 'A forgotten mark',
      steps: [
        {
          type: 'narration',
          text: 'Seven shallow cuts surround a worn circle. Moss fills six. The seventh is strangely warm.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'neutral',
          text: 'Not a mason’s mark. I have seen that circle on old royal coins.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'sawGateStone', value: true },
          { type: 'addClue', id: 'seven_mark', name: 'The seven-marked stone', description: 'A worn circle surrounded by seven cuts. One cut still held warmth.' },
        ],
      },
    },

    inspect_gate_stone_repeat: {
      id: 'inspect_gate_stone_repeat',
      kind: 'dialogue',
      title: 'The seven-marked stone',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          text: 'Seven marks around a circle. Whatever it meant, someone wanted it to last.',
        },
      ],
    },

    ridge_smoke: {
      id: 'ridge_smoke',
      kind: 'encounter',
      title: 'Smoke on the ridge',
      chapter: 'I · What the fire left',
      image: 'assets/images/scenes/willowmere-ruins.webp',
      imageAlt: 'Aren and Bram stand among Willowmere’s damaged homes while survivors carry lanterns through wet smoke.',
      steps: [
        {
          type: 'narration',
          text: 'Aren starts down the home trail rehearsing how casually he will mention the courier road. Through the birches, a dark column rises where chimney smoke should have thinned into evening.',
        },
        {
          type: 'narration',
          text: 'The first smell was not supper. Smoke climbed above Willowmere, black against the evening. Beneath it came the measured retreat of armored boots.',
          audio: 'narrator_smoke_willowmere',
        },
        {
          type: 'effect',
          effect: { type: 'checkpoint', label: 'Smoke on the ridge' },
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'surprised',
          text: 'That is the royal banner. Why are soldiers coming out of my village?',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'The blue shutter should be below that smoke. Mum and Dad should be waiting beside it.',
        },
        {
          type: 'narration',
          text: 'A dozen trained soldiers move below. Their commander is armored; Aren carries mushrooms and a tinder case. The river path offers cover. A cry for help comes from the ruined orchard.',
        },
        {
          type: 'choice',
          prompt: 'What does Aren do?',
          options: [
            {
              text: 'Charge the armored patrol alone',
              hint: 'Reckless — the danger is immediate and clearly unequal.',
              next: 'gameover_ridge',
            },
            {
              text: 'Stay low and reach the survivors',
              hint: 'Put the living ahead of an impossible fight.',
              effects: [
                { type: 'set', key: 'ridgeWarningSeen', value: true },
              ],
              next: 'ridge_survivors',
            },
            {
              text: 'Use the covered river path',
              hint: 'Observe before acting.',
              effects: [
                { type: 'set', key: 'ridgeWarningSeen', value: true },
                { type: 'set', key: 'riverApproachUsed', value: true },
              ],
              next: 'ridge_survivors',
            },
          ],
        },
      ],
    },

    gameover_ridge: {
      id: 'gameover_ridge',
      kind: 'gameover',
      title: 'A battle without a plan',
      steps: [
        {
          type: 'gameover',
          title: 'Courage was not armor',
          reason: 'Aren ran into a trained formation with no weapon, no route, and no way to protect anyone. Commander Holt struck him down before he reached the first shield.',
          lesson: 'The patrol’s numbers and armor were visible. Retry from the ridge and choose a route that preserves Aren’s chance to help.',
        },
      ],
    },

    ridge_survivors: {
      id: 'ridge_survivors',
      kind: 'cinematic',
      title: 'What the fire left',
      image: 'assets/images/scenes/willowmere-ruins.webp',
      imageAlt: 'Aren and Bram in ruined Willowmere as survivors tend one another beneath lantern light.',
      steps: [
        {
          type: 'narration',
          text: 'The crystal warden was gone. So were the soldiers. Willowmere remained only in pieces: a well, one lantern, names spoken softly, and people digging with bare hands.',
        },
        {
          type: 'narration',
          text: 'The Vales’ blue kitchen shutter hangs from one hinge. Tomas repaired that latch last week. Beside the broken doorstep, a neighbor has placed Nessa’s copper ladle and Tomas’s leather awl where Aren cannot fail to understand them.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'hurt',
          text: 'Mum. Dad. I came home. I was only— I was in the woods.',
          audio: 'aren_after_fire',
        },
        {
          type: 'narration',
          text: 'No answer came from the house. Someone did call from the ruined well, in a voice roughened by smoke.',
        },
        {
          type: 'narration',
          text: 'Aren sets the still-full mushroom basket beneath the last birch because his hands can no longer hold an ordinary errand. The familiar descent becomes a boundary: woods behind him, Willowmere below, and no ordinary evening left between them.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'willowmereDestroyed', value: true },
          { type: 'objective', text: 'Search the ruins and answer the voice by the well.' },
        ],
        travel: { mapId: 'willowmere', spawnId: 'ruins_entry' },
        checkpoint: 'Willowmere after the smoke',
      },
    },

    meet_bram: {
      id: 'meet_bram',
      kind: 'dialogue',
      title: 'The man by the well',
      steps: [
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Easy. The roof is leaning. Put your feet where I put mine.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Bram Alder. Mossreach, once. Help me lift this beam; questions after breathing.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'hurt',
          text: 'Aren Vale. I was looking for my parents. The neighbors left their tools by our door, so I suppose I am looking for something else now.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'The king’s army did this.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'They fought something at the stone circle. Won, if leaving a village dead counts as winning.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'You say that as if you have seen them do it before.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'Mossreach was the first circle. I followed the royal supply wagons afterward and learned what crystal work looks like. My wife Sella and our Piri were there. I know the road your anger is pointing down.',
        },
        {
          type: 'choice',
          prompt: 'How does Aren answer?',
          options: [
            {
              text: '“Then help me make the king pay.”',
              hint: 'Bram recognizes the revenge that once consumed him.',
              effects: [
                { type: 'increment', key: 'bramTrust', amount: -1 },
                { type: 'set', key: 'revengeLanguageUsed', value: true },
              ],
            },
            {
              text: '“Help me stop this happening again.”',
              hint: 'Frame the journey around preventing another Willowmere.',
              effects: [
                { type: 'increment', key: 'bramTrust', amount: 1 },
              ],
            },
          ],
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Wanting him to hurt will carry you through one night. It will not tell you whom to protect in the morning.',
          when: { flag: 'revengeLanguageUsed', equals: true },
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'Then we begin with the people still breathing. After that, we ask Rowan what she saw and stop the next fire before it starts.',
          when: { not: { flag: 'revengeLanguageUsed', equals: true } },
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'At dawn, I will walk with you. But if you start mistaking dying for justice, I will be irritatingly alive beside you.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'bramJoined', value: true },
          { type: 'objective', text: 'Visit Rowanstead Farm at the east edge of the ruins.' },
        ],
      },
    },

    bram_after_meeting: {
      id: 'bram_after_meeting',
      kind: 'dialogue',
      title: 'Bram',
      steps: [
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Rowan’s farm has a roof, water, and people who saw the soldiers arrive. In that order, those are all useful.',
        },
      ],
    },

    willowmere_memorial: {
      id: 'willowmere_memorial',
      kind: 'dialogue',
      title: 'Names in wet ash',
      steps: [
        {
          type: 'narration',
          text: 'Aren ties a pale ribbon beside the others. He does not make a promise to the dead. He makes one to himself: remember them as people, not fuel.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'memorialVisited', value: true },
          { type: 'increment', key: 'bramTrust', amount: 1 },
          { type: 'addClue', id: 'memorial_ribbon', name: 'Willowmere ribbon', description: 'A reminder that grief is a memory, not an order.' },
        ],
      },
    },

    willowmere_memorial_repeat: {
      id: 'willowmere_memorial_repeat',
      kind: 'dialogue',
      title: 'The memorial',
      steps: [
        {
          type: 'narration',
          text: 'The ribbons move together in the night wind.',
        },
      ],
    },

    inspect_royal_shield: {
      id: 'inspect_royal_shield',
      kind: 'dialogue',
      title: 'A discarded shield',
      steps: [
        {
          type: 'narration',
          text: 'The shield’s Ember tab is royal issue. Its inner rim is gouged by amber glass, and a chalk order reads only as rain-blurred strokes.',
        },
        {
          type: 'line',
          speaker: 'bram',
          text: 'They knew there was a fight. They did not clear the village first.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'royalEvidence', value: true },
          { type: 'addClue', id: 'royal_shield', name: 'Abandoned royal shield', description: 'Proof that the army entered Willowmere expecting resistance.' },
        ],
      },
    },

    inspect_royal_shield_repeat: {
      id: 'inspect_royal_shield_repeat',
      kind: 'dialogue',
      title: 'Royal shield',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          text: 'They were prepared for the warden. Not for the people beside it.',
        },
      ],
    },

    rowanstead_cael: {
      id: 'rowanstead_cael',
      kind: 'cinematic',
      title: 'The wounded stranger',
      chapter: 'II · Whom can you reach?',
      steps: [
        {
          type: 'narration',
          text: 'Rowanstead’s kitchen has become an infirmary: clean cloth on the table, six borrowed bedrolls, and a kettle working harder than anyone. Rowan puts a hot bowl before Aren. It is his first since the fire, and he cannot lift the spoon.',
        },
        {
          type: 'line',
          speaker: 'rowan',
          text: 'Sit anyway. Grief does not excuse you from having a body. I am Rowan, and this farm is where stubborn things come to remain alive.',
        },
        {
          type: 'line',
          speaker: 'rowan',
          text: 'This is Cael. I found him half-dead in my turnip trench two years ago. He has been waiting for somebody foolish enough to move faster than an army.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Two years in a bed, yet you know where the king marches next. Start with that.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'pained',
          text: 'Because I studied every crystal circle before the army found me. What guards those circles is also, in part, my responsibility.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'pained',
          text: 'The king recovered seven crystals from me. His forces have restored two circles. Five remain.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'Why did you have them?',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guarded',
          text: 'Because opening the old gate will harm more than the villages beside it. Stop the restorations. I cannot travel, but I can show you where the army must go.',
        },
        {
          type: 'choice',
          prompt: 'Cael is withholding something. How does Aren respond?',
          options: [
            {
              text: 'Press him: “Who sent you?”',
              hint: 'Challenge Cael’s omissions, even if it strains his trust.',
              effects: [
                { type: 'set', key: 'questionedCaelEarly', value: true },
                { type: 'increment', key: 'caelTrust', amount: -1 },
              ],
            },
            {
              text: 'Focus on the next village',
              hint: 'Prioritize the immediate warning and let Cael keep his secret for now.',
              effects: [
                { type: 'increment', key: 'caelTrust', amount: 1 },
              ],
            },
          ],
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guarded',
          text: 'Two fingers lie ahead. Greenwake is peaceful and does not know the army is coming. Ashfinger is already ringing its battle bell. You cannot arrive first at both.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Greenwake lies downriver along the reed finger. Ashfinger is north beyond the mill ridge. At a walk, choosing either road puts half a day between us and the other.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'Yesterday I was looking for supper. Now a stranger wants me to race an army across the Hand and decide who hears us first.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'The choice is unfair. The road is still under our feet. We choose with what we know, then we answer for how we walk it.',
        },
        {
          type: 'narration',
          text: 'The Hand is too large for one warning to reach every finger. Choosing a road means choosing where time will be lost.',
          audio: 'narrator_fingers',
        },
        {
          type: 'choice',
          prompt: 'Which finger comes first?',
          options: [
            {
              text: 'Warn Greenwake before the army arrives',
              hint: 'Save a peaceful village by giving it time to leave.',
              effects: [
                { type: 'set', key: 'firstFinger', value: 'greenwake' },
                { type: 'set', key: 'caelPartialTruth', value: true },
                { type: 'checkpoint', label: 'The fork between fingers' },
              ],
              next: 'depart_greenwake',
            },
            {
              text: 'Go to the active battle at Ashfinger',
              hint: 'Enter immediate danger to rescue people already trapped.',
              effects: [
                { type: 'set', key: 'firstFinger', value: 'ashfinger' },
                { type: 'set', key: 'caelPartialTruth', value: true },
                { type: 'checkpoint', label: 'The fork between fingers' },
              ],
              next: 'depart_ashfinger',
            },
          ],
        },
      ],
    },

    rowanstead_repeat: {
      id: 'rowanstead_repeat',
      kind: 'dialogue',
      title: 'Rowanstead Farm',
      steps: [
        {
          type: 'line',
          speaker: 'rowan',
          text: 'The kettle will remain offended until you return. Go.',
        },
      ],
    },

    depart_greenwake: {
      id: 'depart_greenwake',
      kind: 'transition',
      title: 'The reed road',
      steps: [
        {
          type: 'narration',
          text: 'Aren and Bram take the canal road toward Greenwake. Behind them, Cael watches from a borrowed bed, guarding a truth he still believes he can ration.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'The reed channels are still clear on the horizon. If we keep moving, Greenwake gets a choice Willowmere never had.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'Then let the road end with people walking away from danger, not us walking into it.',
        },
      ],
      onComplete: {
        travel: { mapId: 'greenwake', spawnId: 'west_bridge' },
        effects: [
          { type: 'objective', text: 'Find Greenwake’s evacuation leader and warn the village.' },
        ],
      },
    },

    depart_ashfinger: {
      id: 'depart_ashfinger',
      kind: 'transition',
      title: 'Toward the bell',
      steps: [
        {
          type: 'narration',
          text: 'They follow the battle bell into rain. The road becomes a canal, the canal becomes a flood, and the royal banner is already on the ridge.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Ashfinger is past that dark ridge. Once we cross it, the flood will hide every easy way back.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'We are going for the people beneath the bell. The banner can wait.',
        },
      ],
      onComplete: {
        travel: { mapId: 'ashfinger', spawnId: 'south_lane' },
        effects: [
          { type: 'objective', text: 'Reach Mira near Ashfinger’s flooded mill lane.' },
        ],
      },
    },

    inspect_sluice: {
      id: 'inspect_sluice',
      kind: 'dialogue',
      title: 'Old water, useful route',
      steps: [
        {
          type: 'narration',
          text: 'The old sluice joins Greenwake’s canals to Ashfinger’s mill channel. Its maintenance tunnel is narrow, dry, and absent from modern royal maps.',
        },
        {
          type: 'line',
          speaker: 'bram',
          text: 'A road soldiers ignore is still a road.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'sluiceRouteKnown', value: true },
          { type: 'addClue', id: 'sluice_route', name: 'The old sluice route', description: 'A hidden maintenance tunnel between Greenwake and Ashfinger.' },
        ],
      },
    },

    inspect_sluice_repeat: {
      id: 'inspect_sluice_repeat',
      kind: 'dialogue',
      title: 'The old sluice',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          text: 'Narrow, dry, and ignored. Better than a road watched by soldiers.',
        },
      ],
    },

    inspect_reed_bells: {
      id: 'inspect_reed_bells',
      kind: 'dialogue',
      title: 'Reed bells',
      steps: [
        {
          type: 'narration',
          text: 'Each bridge has a hollow reed bell. One pattern calls boats home. Another means fire. A rapid descending rhythm means leave everything.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'knowsReedAlarm', value: true },
          { type: 'addClue', id: 'reed_alarm', name: 'Greenwake evacuation bells', description: 'A descending bell rhythm tells every family to leave immediately.' },
        ],
      },
    },

    inspect_reed_bells_repeat: {
      id: 'inspect_reed_bells_repeat',
      kind: 'dialogue',
      title: 'Reed bells',
      steps: [
        {
          type: 'narration',
          text: 'The bells turn a whole village into one listening room.',
        },
      ],
    },

    warn_greenwake: {
      id: 'warn_greenwake',
      kind: 'encounter',
      title: 'The warning',
      steps: [
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Mira Fen. Healer most mornings, keeper of the evacuation ledger today. I do not move ninety people because two travelers arrive breathless. Names, evidence, danger—in that order.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'Aren Vale, from Willowmere. The royal army restored our circle yesterday. This shield came from the road they used to leave us burning.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'Bram Alder, from Mossreach. I have seen the same wagons, the same crystal braces, and the same hurry before.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'You smell like smoke, you have a royal shield strap, and Bram is not making a joke. I believe you. I have ninety people and six boats.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'The army is restoring the crystal circles. Willowmere was beside the last one. Nobody here stays near the next.',
        },
        {
          type: 'choice',
          prompt: 'How should Greenwake evacuate?',
          options: [
            {
              text: 'Open the old sluice and lead the boats',
              hint: 'Aren stays long enough to help every family move.',
              when: { flag: 'sluiceRouteKnown', equals: true },
              effects: [
                { type: 'set', key: 'savedVillage', value: 'greenwake' },
                { type: 'set', key: 'villagersSaved', value: true },
                { type: 'set', key: 'miraJoined', value: true },
                { type: 'set', key: 'greenwakeResolved', value: true },
                { type: 'increment', key: 'miraTrust', amount: 2 },
                { type: 'encounter', id: 'greenwake_evacuation', outcome: 'complete_evacuation' },
              ],
              next: 'greenwake_saved',
            },
            {
              text: 'Ring the evacuation bells and organize the north road',
              hint: 'Reliable, slower, and focused on civilians.',
              effects: [
                { type: 'set', key: 'savedVillage', value: 'greenwake' },
                { type: 'set', key: 'villagersSaved', value: true },
                { type: 'set', key: 'miraJoined', value: true },
                { type: 'set', key: 'greenwakeResolved', value: true },
                { type: 'increment', key: 'miraTrust', amount: 1 },
                { type: 'encounter', id: 'greenwake_evacuation', outcome: 'north_road' },
              ],
              next: 'greenwake_saved',
            },
            {
              text: 'Give Mira the warning and rush toward Ashfinger',
              hint: 'Greenwake can escape, but Mira must remain to lead it.',
              effects: [
                { type: 'set', key: 'savedVillage', value: 'greenwake' },
                { type: 'set', key: 'villagersSaved', value: true },
                { type: 'set', key: 'miraJoined', value: false },
                { type: 'set', key: 'greenwakeResolved', value: true },
                { type: 'encounter', id: 'greenwake_evacuation', outcome: 'mira_stays' },
              ],
              next: 'greenwake_saved',
            },
          ],
        },
      ],
    },

    mira_greenwake_repeat: {
      id: 'mira_greenwake_repeat',
      kind: 'dialogue',
      title: 'Mira',
      steps: [
        {
          type: 'line',
          speaker: 'mira',
          text: 'A warning is only useful once people start moving. We are moving.',
        },
      ],
    },

    greenwake_saved: {
      id: 'greenwake_saved',
      kind: 'transition',
      title: 'The cost of staying',
      steps: [
        {
          type: 'narration',
          text: 'By sundown, Greenwake is empty but alive. The party turns toward Ashfinger. Its battle bell stopped an hour ago.',
          when: { flag: 'miraJoined', equals: true },
        },
        {
          type: 'narration',
          text: 'Greenwake’s evacuation bells begin their descending call. As the first boats push away, Aren and Bram turn toward Ashfinger; reaching the other finger means trusting Mira to finish the work behind them.',
          when: { not: { flag: 'miraJoined', equals: true } },
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'The senior boatman has the ledger and six boats accounted for. I can come. If I stay here counting people already safe, I am only hiding from the next list.',
          when: { flag: 'miraJoined', equals: true },
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'determined',
          text: 'I stay until the last boat reaches high ground. Take the sluice path north, and tell Ashfinger that Greenwake heard you.',
          when: { not: { flag: 'miraJoined', equals: true } },
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'We chose people in front of us. That does not make the people beyond us matter less.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'Ashfinger is north across the river channels. We leave Greenwake alive, and we carry the lost hour with us.',
        },
      ],
      onComplete: {
        travel: { mapId: 'ashfinger', spawnId: 'late_lane' },
        effects: [
          { type: 'objective', text: 'Search the silent Ashfinger crystal site.' },
        ],
      },
    },

    greenwake_late: {
      id: 'greenwake_late',
      kind: 'cinematic',
      title: 'A bell too late',
      steps: [
        {
          type: 'narration',
          text: 'Ashfinger’s rescue cost the night. By the time they reach Greenwake, the bridges are broken and the reed bells lie in the water. Most villagers fled on their own. Some did not.',
        },
        {
          type: 'narration',
          text: 'Mira finds the evacuation ledger wedged beneath a bridge rail. The final page is a hurried list of boats, followed by three names without check marks.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'hurt',
          text: 'If we had chosen this road first, those names might be crossed out. Does saving Ashfinger make this the wrong choice?',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'worried',
          text: 'We saved people under our hands. Now we remember the people time took out of them.',
          when: { flag: 'miraJoined', equals: true },
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'No road let us save both. Do not invent one now just to punish yourself.',
          when: { not: { flag: 'miraJoined', equals: true } },
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'greenwakeResolved', value: true },
          { type: 'set', key: 'lostVillage', value: 'greenwake' },
          { type: 'encounter', id: 'greenwake_aftermath', outcome: 'arrived_late' },
        ],
        next: 'fingers_reckoning',
      },
    },

    greenwake_late_repeat: {
      id: 'greenwake_late_repeat',
      kind: 'dialogue',
      title: 'Silent water',
      steps: [
        {
          type: 'narration',
          text: 'One reed bell turns slowly beneath the canal surface.',
        },
      ],
    },

    inspect_ash_sluice: {
      id: 'inspect_ash_sluice',
      kind: 'dialogue',
      title: 'The mill sluice',
      steps: [
        {
          type: 'narration',
          text: 'Behind the waterwheel is an old maintenance gate. It connects to a tunnel under the royal line.',
        },
        {
          type: 'line',
          speaker: 'aren',
          text: 'If the upper lock opens, the channel becomes a road away from the soldiers.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'sluiceRouteKnown', value: true },
          { type: 'addClue', id: 'sluice_route', name: 'The old sluice route', description: 'A dry maintenance tunnel below the royal line.' },
        ],
      },
    },

    inspect_army_order: {
      id: 'inspect_army_order',
      kind: 'dialogue',
      title: 'A rain-soaked order',
      steps: [
        {
          type: 'narration',
          text: 'Most ink has run. Three phrases remain: “seat the crystal,” “civilian delay unacceptable,” and “Her Majesty has days.”',
        },
        {
          type: 'line',
          speaker: 'bram',
          text: 'There. A reason, perhaps. Not an excuse.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'heardElaraName', value: true },
          { type: 'increment', key: 'truthScore', amount: 1 },
          { type: 'addClue', id: 'army_order', name: 'Commander Holt’s damaged order', description: 'The restoration is urgent because “Her Majesty has days.”' },
        ],
      },
    },

    inspect_army_order_repeat: {
      id: 'inspect_army_order_repeat',
      kind: 'dialogue',
      title: 'The damaged order',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          text: '“Civilian delay unacceptable.” They wrote the cruelty down and called it a schedule.',
        },
      ],
    },

    ashfinger_encounter: {
      id: 'ashfinger_encounter',
      kind: 'encounter',
      title: 'The flood line',
      image: 'assets/images/scenes/ashfinger-rescue.webp',
      imageAlt: 'Mira directs civilians toward a sluice while Aren holds a rope and Bram braces a beam beneath a distant mineral warden.',
      steps: [
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Mira Fen—healer until the bridge fell, evacuation leader since. If Rowan sent you, save the introductions for dry ground.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'determined',
          text: 'The army has the north road. The warden has the ridge. I have twelve people trapped at the mill and no third direction.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'Twelve who can move, or twelve who need carrying?',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Seven can run. Two children, Old Fenrick, and two millers with crushed legs cannot. Now you understand why “retreat” is not a direction.',
        },
        {
          type: 'narration',
          text: 'Commander Holt’s formation is disciplined and heavily armored. The crystal warden towers behind it. The mill channel, rope line, and old sluice offer routes for rescue.',
        },
        {
          type: 'choice',
          prompt: 'Choose the rescue approach.',
          options: [
            {
              text: 'Open the hidden sluice beneath the royal line',
              hint: 'Uses knowledge found before the encounter.',
              when: { flag: 'sluiceRouteKnown', equals: true },
              next: 'ashfinger_sluice_rescue',
            },
            {
              text: 'Hold a rope across the flood and protect the crossing',
              hint: 'Exposed, but focused on the trapped villagers.',
              next: 'ashfinger_rope_rescue',
            },
            {
              text: 'Charge Commander Holt’s armored formation',
              hint: 'Reckless — Bram has warned that this is not a winnable duel.',
              next: 'gameover_ashfinger',
            },
          ],
        },
      ],
    },

    gameover_ashfinger: {
      id: 'gameover_ashfinger',
      kind: 'gameover',
      title: 'The wrong victory',
      steps: [
        {
          type: 'gameover',
          title: 'The flood kept rising',
          reason: 'Aren abandoned the evacuation route to attack a trained formation. Holt’s guards pinned him while the mill bridge failed behind him.',
          lesson: 'The encounter showed rescue routes and the formation’s strength. Retry and use the environment or protect the crossing.',
        },
      ],
    },

    ashfinger_sluice_rescue: {
      id: 'ashfinger_sluice_rescue',
      kind: 'cinematic',
      title: 'Below the battle',
      image: 'assets/images/scenes/ashfinger-rescue.webp',
      imageAlt: 'The Ashfinger rescue proceeds through rain and floodwater beneath a distant crystal warden.',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'We are not here to win their battle. We are here to get everyone out of it.',
          audio: 'aren_rescue_line',
        },
        {
          type: 'narration',
          text: 'The old gate opens. Civilians move beneath the royal line while the soldiers look toward the warden. Mira is last through, carrying the village ledger under one arm and a child under the other.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'warm',
          text: 'You found a third direction. I am coming with you until we find one for the whole Hand.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'First, hold still. Bram’s shoulder is bruised, your palms are split, and heroes get infections as efficiently as everyone else.',
        },
        {
          type: 'narration',
          text: 'The rescued column turns south at first light. Far beyond the rain, Greenwake’s reed bells should be answering the wind. No sound reaches the road.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'savedVillage', value: 'ashfinger' },
          { type: 'set', key: 'villagersSaved', value: true },
          { type: 'set', key: 'miraJoined', value: true },
          { type: 'set', key: 'ashfingerResolved', value: true },
          { type: 'increment', key: 'miraTrust', amount: 2 },
          { type: 'encounter', id: 'ashfinger_rescue', outcome: 'sluice_success' },
        ],
        travel: { mapId: 'greenwake', spawnId: 'late_arrival' },
        effectsAfterTravel: [
          { type: 'objective', text: 'See what remains at Greenwake.' },
        ],
      },
    },

    ashfinger_rope_rescue: {
      id: 'ashfinger_rope_rescue',
      kind: 'cinematic',
      title: 'Hold the line',
      image: 'assets/images/scenes/ashfinger-rescue.webp',
      imageAlt: 'Aren and Bram hold a rescue route through rain as Mira leads villagers away from a distant battle.',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'We are not here to win their battle. We are here to get everyone out of it.',
          audio: 'aren_rescue_line',
        },
        {
          type: 'narration',
          text: 'Bram braces the mill beam. Aren keeps the rope above the flood until his hands bleed. Eight people cross. Four are carried. Mira refuses to leave the last one behind.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'warm',
          text: 'I have spent all night telling people not to travel alone. It would be hypocritical to let you start now.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Give me those hands, Aren. You can decide the fate of the continent after I stop you bleeding on it.',
        },
        {
          type: 'narration',
          text: 'They leave Ashfinger with the survivors at dawn and take the southern flood road. The miles toward Greenwake are measured by the bells they cannot hear.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'savedVillage', value: 'ashfinger' },
          { type: 'set', key: 'villagersSaved', value: true },
          { type: 'set', key: 'miraJoined', value: true },
          { type: 'set', key: 'ashfingerResolved', value: true },
          { type: 'increment', key: 'miraTrust', amount: 1 },
          { type: 'encounter', id: 'ashfinger_rescue', outcome: 'rope_success' },
        ],
        travel: { mapId: 'greenwake', spawnId: 'late_arrival' },
        effectsAfterTravel: [
          { type: 'objective', text: 'See what remains at Greenwake.' },
        ],
      },
    },

    ashfinger_late: {
      id: 'ashfinger_late',
      kind: 'cinematic',
      title: 'After the bell',
      image: 'assets/images/scenes/ashfinger-rescue.webp',
      imageAlt: 'Ashfinger’s flooded lanes beneath a distant mineral warden and abandoned royal lines.',
      steps: [
        {
          type: 'narration',
          text: 'Ashfinger’s army and warden are gone. The mill channel carries roof shingles, a child’s red cup, and the last echo of the battle bell.',
        },
        {
          type: 'narration',
          text: 'Bram wades out to retrieve the cup. A name has been scratched into its base so it would always find the right kitchen. There is no kitchen left to ask.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'hurt',
          text: 'Greenwake is alive because we stayed. Ashfinger is gone because we could not be in two places.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'Tell me choosing Greenwake was not just another way to abandon someone.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'That is the shape of the truth. Do not sharpen it into a knife for yourself.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'ashfingerResolved', value: true },
          { type: 'set', key: 'lostVillage', value: 'ashfinger' },
          { type: 'encounter', id: 'ashfinger_aftermath', outcome: 'arrived_late' },
        ],
        next: 'fingers_reckoning',
      },
    },

    fingers_reckoning: {
      id: 'fingers_reckoning',
      kind: 'transition',
      title: 'Toward the thumb',
      steps: [
        {
          type: 'narration',
          text: 'One finger carries survivors. The other carries smoke. Ahead, the volcanic thumb has no village to evacuate—only a crystal circle, a royal army, and the first chance to face the king.',
        },
        {
          type: 'narration',
          text: 'They camp where the two river roads join. For one hour nobody asks Aren to choose anything. Bram turns a tiny wooden bird between his fingers while Mira rewinds the linen around Aren’s palms.',
          when: { flag: 'miraJoined', equals: true },
        },
        {
          type: 'narration',
          text: 'They camp where the two river roads join. For one hour nobody asks Aren to choose anything. Bram turns a tiny wooden bird between his fingers while the road dries beside the fire.',
          when: { not: { flag: 'miraJoined', equals: true } },
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'You touch that bird whenever somebody says Mossreach. Was it Piri’s?',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'Her first carving. The wings are uneven because she believed measuring was an insult to birds. I set out after Edric because I wanted him to carry Mossreach for one hour.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'I am still here because I do not want another parent learning which ordinary thing became the last.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'warm',
          text: 'And I am here because evacuation ledgers should end with totals, not question marks. When this is over, I want signal towers from finger to finger. One warning should not need heroes.',
          when: { flag: 'miraJoined', equals: true },
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'Before the fire, I was trying to decide whether I wanted to leave Willowmere. Now I would give anything to have it waiting while I made up my mind.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'determined',
          text: 'The river fingers are behind us. Cinder Thumb is west across the whole palm. If the king is moving there, we will see his supply road before we see his face.',
          when: { flag: 'miraJoined', equals: true },
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'Then we cross the Hand, sleep before the black stone, and meet him with clear eyes. Grief has hurried us far enough.',
        },
      ],
      onComplete: {
        checkpoint: 'After the two fingers',
        travel: { mapId: 'cinder_thumb', spawnId: 'basalt_shelf' },
        next: 'cinder_arrival',
      },
    },

    cinder_arrival: {
      id: 'cinder_arrival',
      kind: 'cinematic',
      title: 'Cinder Thumb',
      chapter: 'III · The king in the fire',
      image: 'assets/images/scenes/cinder-thumb.webp',
      imageAlt: 'Aren and Bram observe King Edric’s soldiers and a huge amber-cracked basalt warden across volcanic fissures.',
      steps: [
        {
          type: 'narration',
          text: 'Cinder Thumb has no houses to burn. The mountain burns by itself. Across its basalt causeway, King Edric’s engineers prepare the fifth restored circle.',
          audio: 'narrator_cinder_thumb',
        },
        {
          type: 'narration',
          text: 'It is the first time Aren has seen the king outside a coin: taller, older, and more exhausted than a symbol is allowed to look. Every soldier on the causeway watches him for permission to breathe.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Edric inspected flood walls in person once. People called that proof he listened. Desperation did not replace the man; it taught him which parts of himself to ignore.',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'Explore before approaching the causeway. Clues in the environment can unlock safer encounter choices.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'objective', text: 'Study the volcanic site and speak with Bram before confronting the king.' },
        ],
        checkpoint: 'Cinder Thumb arrival',
      },
    },

    bram_cinder_warning: {
      id: 'bram_cinder_warning',
      kind: 'dialogue',
      title: 'Measure the ground',
      steps: [
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'Edric has forty guards, a causeway one person wide, and a monster behind him. If revenge sees a fair duel here, revenge cannot count.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'Then we do not give it the numbers.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'bramCinderWarning', value: true },
        ],
      },
    },

    bram_cinder_repeat: {
      id: 'bram_cinder_repeat',
      kind: 'dialogue',
      title: 'Bram’s warning',
      steps: [
        {
          type: 'line',
          speaker: 'bram',
          text: 'Look for what the mountain does. It has been fighting itself longer than any king.',
        },
      ],
    },

    inspect_steam_vents: {
      id: 'inspect_steam_vents',
      kind: 'dialogue',
      title: 'The mountain breathes',
      steps: [
        {
          type: 'narration',
          text: 'The vents erupt in sequence: three short bursts, a pause, then one long plume beside the causeway. The warden turns toward every burst.',
        },
        {
          type: 'line',
          speaker: 'mira',
          text: 'It follows heat changes, not people.',
          when: { flag: 'miraJoined', equals: true },
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'ventPatternKnown', value: true },
          { type: 'addClue', id: 'vent_pattern', name: 'Cinder vent pattern', description: 'A predictable eruption can draw the basalt warden away from the causeway.' },
        ],
      },
    },

    inspect_steam_vents_repeat: {
      id: 'inspect_steam_vents_repeat',
      kind: 'dialogue',
      title: 'Steam vents',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          text: 'Three short. Pause. One long. The warden turns on the long one.',
        },
      ],
    },

    inspect_locket_clasp: {
      id: 'inspect_locket_clasp',
      kind: 'dialogue',
      title: 'A flower in the ash',
      steps: [
        {
          type: 'narration',
          text: 'A broken gold clasp holds one pale pressed petal. The royal seal on its back belongs to Queen Elara.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'The king brought this into a volcano. It matters enough to risk losing.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'heardElaraName', value: true },
          { type: 'increment', key: 'truthScore', amount: 1 },
          { type: 'addClue', id: 'moonflower_clasp', name: 'Queen Elara’s moonflower clasp', description: 'A broken royal clasp with a pressed pale petal.' },
        ],
      },
    },

    inspect_locket_clasp_repeat: {
      id: 'inspect_locket_clasp_repeat',
      kind: 'dialogue',
      title: 'Moonflower clasp',
      steps: [
        {
          type: 'line',
          speaker: 'bram',
          text: 'A thing can explain a man without forgiving him.',
        },
      ],
    },

    cinder_standoff: {
      id: 'cinder_standoff',
      kind: 'encounter',
      title: 'The king in the fire',
      image: 'assets/images/scenes/cinder-thumb.webp',
      imageAlt: 'Aren and Bram watch King Edric and royal soldiers across lava while a basalt warden towers behind them.',
      steps: [
        {
          type: 'line',
          speaker: 'edric',
          expression: 'commanding',
          text: 'Seat the crystal. We have already spent too many days on the dead.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'You spent them. They were not yours.',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'controlled',
          text: 'The gray ribbon. Willowmere. Nessa and Tomas Vale were on its casualty roll. I read every name.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'I am Aren. Their son. You knew their names before you called them a delay.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'angry',
          text: 'Names are not penance, Edric.',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'tender',
          text: 'No. They are my failure. I cannot add Elara to them while a cure waits behind a closed door.',
        },
        {
          type: 'narration',
          text: 'The guards close ranks. The warden turns toward the causeway. Steam gathers beneath the vents. Bram’s warning is clear: a direct charge ends here.',
        },
        {
          type: 'choice',
          prompt: 'How does the party survive the standoff?',
          options: [
            {
              text: 'Trigger the mapped heat vents',
              hint: 'Use the mountain to draw the warden away from everyone.',
              when: { flag: 'ventPatternKnown', equals: true },
              next: 'cinder_vent_escape',
            },
            {
              text: 'Shield Bram while he cuts the causeway winch',
              hint: 'A defensive setback buys time, but not the crystal.',
              next: 'cinder_protect_escape',
            },
            {
              text: 'Charge King Edric through forty guards',
              hint: 'Reckless — Bram just explained why the approach cannot succeed.',
              next: 'gameover_cinder',
            },
          ],
        },
      ],
    },

    gameover_cinder: {
      id: 'gameover_cinder',
      kind: 'gameover',
      title: 'Fire does not care',
      steps: [
        {
          type: 'gameover',
          title: 'The causeway closed',
          reason: 'Aren charged a one-person causeway held by forty guards. The formation never opened, and the warden’s heat reached him before Edric needed to draw his sword.',
          lesson: 'Bram named the numbers and the environment exposed safer options. Retry from Cinder Thumb and act on that information.',
        },
      ],
    },

    cinder_vent_escape: {
      id: 'cinder_vent_escape',
      kind: 'cinematic',
      title: 'The mountain answers',
      image: 'assets/images/scenes/cinder-thumb.webp',
      imageAlt: 'Steam vents divide Aren and Bram from Edric’s causeway while a basalt warden turns toward the heat.',
      steps: [
        {
          type: 'narration',
          text: 'Three short bursts. A pause. The long vent erupts beneath the ridge. The warden turns from the soldiers, and the royal line breaks just long enough for the party to withdraw.',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'furious',
          text: 'Elara has days, not seasons! Finish it and move for the palm!',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'A dying queen does not turn villages into kindling. I will hear the rest, but I will not excuse this.',
          audio: 'aren_cinder_refusal',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'heardElaraName', value: true },
          { type: 'set', key: 'cinderResolved', value: true },
          { type: 'increment', key: 'truthScore', amount: 1 },
          { type: 'encounter', id: 'cinder_standoff', outcome: 'vent_escape' },
        ],
        next: 'cinder_aftermath',
      },
    },

    cinder_protect_escape: {
      id: 'cinder_protect_escape',
      kind: 'cinematic',
      title: 'A cut rope',
      image: 'assets/images/scenes/cinder-thumb.webp',
      imageAlt: 'The volcanic causeway splits the party from Edric and a towering amber-cracked mineral warden.',
      steps: [
        {
          type: 'narration',
          text: 'Aren keeps the warden’s gaze while Bram cuts the winch. Half the causeway drops into lava. Edric’s engineers seat the crystal on the far side and retreat toward the palm.',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'furious',
          text: 'Elara has days, not seasons! Finish it and move for the palm!',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'A dying queen does not turn villages into kindling. I will hear the rest, but I will not excuse this.',
          audio: 'aren_cinder_refusal',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'heardElaraName', value: true },
          { type: 'set', key: 'cinderResolved', value: true },
          { type: 'increment', key: 'truthScore', amount: 1 },
          { type: 'set', key: 'bramShoulderBandaged', value: true },
          { type: 'encounter', id: 'cinder_standoff', outcome: 'winch_escape' },
        ],
        next: 'cinder_aftermath',
      },
    },

    cinder_aftermath: {
      id: 'cinder_aftermath',
      kind: 'transition',
      title: 'The road to the palm',
      steps: [
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'He said her name like a prayer and an order at once.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'I expected a monster. He knew my parents’ names. What happened to Queen Elara, and what cure does he believe waits beyond the gate?',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'A grieving man can do monstrous things without becoming a storybook monster. That is why we cannot wait for him to look like one.',
        },
        {
          type: 'narration',
          text: 'The fifth circle burns behind them. The sixth lies on the main island, beneath Crown City, where a prince, an archive, and an unfinished airship are waiting.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'The old quarry road reaches the central palm by morning. We find the prince, learn why Edric is doing this, and leave the city before his army comes home.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'A beautifully simple plan. Those are usually the ones with stairs under them.',
        },
      ],
      onComplete: {
        checkpoint: 'After Cinder Thumb',
        travel: { mapId: 'crown_city', spawnId: 'south_gate' },
        next: 'crown_arrival',
      },
    },

    crown_arrival: {
      id: 'crown_arrival',
      kind: 'cinematic',
      title: 'Under Crown City',
      chapter: 'IV · What the crown concealed',
      image: 'assets/images/scenes/starling-workshop.webp',
      imageAlt: 'Aren, Cael, Prince Lucen, and airship engineer Mara stand beneath the completed Starling in a secret workshop.',
      steps: [
        {
          type: 'narration',
          text: 'Crown City sleeps above sealed archives and forbidden workshops. Below, Prince Lucen has been collecting every truth his father ordered buried.',
          audio: 'narrator_crown_city',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'Explore the archive and workshop. Optional records add context and change epilogue details; Lucen and Mara are required.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'objective', text: 'Find Prince Lucen and Mara in the hidden city rooms.' },
        ],
      },
    },

    inspect_elara_journal: {
      id: 'inspect_elara_journal',
      kind: 'dialogue',
      title: 'Elara’s field journal',
      steps: [
        {
          type: 'narration',
          text: 'The queen’s botanical hand grows unsteady across the final pages. She records a Veyran moonleaf described in an older case of the same illness.',
        },
        {
          type: 'narration',
          text: 'Her last clear sentence reads: “No cure purchased with unwilling lives can make me well.”',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'He is doing this for her. He is also doing it against her.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'foundRoyalJournal', value: true },
          { type: 'increment', key: 'truthScore', amount: 2 },
          { type: 'addClue', id: 'elara_journal', name: 'Queen Elara’s journal', description: 'Moonleaf may cure her, but she explicitly rejects a cure purchased with unwilling lives.' },
        ],
      },
    },

    inspect_elara_journal_repeat: {
      id: 'inspect_elara_journal_repeat',
      kind: 'dialogue',
      title: 'Elara’s last clear line',
      steps: [
        {
          type: 'narration',
          text: '“No cure purchased with unwilling lives can make me well.”',
        },
      ],
    },

    inspect_gate_ledger: {
      id: 'inspect_gate_ledger',
      kind: 'dialogue',
      title: 'The gate-energy ledger',
      steps: [
        {
          type: 'narration',
          text: 'Seven circles once shared a gentle magical draw. With one crystal active, the gate could remain open—but that lone circle would drain its entire region to dust.',
        },
        {
          type: 'narration',
          text: 'Near a total lunar eclipse, all seven weakened crystals are required to reopen a closed gate. Removed crystals can then be destroyed.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'foundGateLedger', value: true },
          { type: 'increment', key: 'truthScore', amount: 2 },
          { type: 'addClue', id: 'gate_ledger', name: 'Gate-energy ledger', description: 'One crystal can sustain an open gate only by devastating its region. All seven are needed to reopen it during the eclipse.' },
        ],
      },
    },

    inspect_gate_ledger_repeat: {
      id: 'inspect_gate_ledger_repeat',
      kind: 'dialogue',
      title: 'Gate-energy ledger',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          text: 'Seven circles share the cost. One circle devours its home.',
        },
      ],
    },

    meet_lucen: {
      id: 'meet_lucen',
      kind: 'dialogue',
      title: 'The prince below the palace',
      steps: [
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'worried',
          text: 'I am Lucen Aurel. Before anything else: I copied the Willowmere orders before Father’s clerks destroyed them. I failed to stop those orders from becoming a fire.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'Then do not ask me to make your apology comfortable.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'resolved',
          text: 'I will not. I can only give you the records, the truth behind them, and whatever authority I still have to put between citizens and my father.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'worried',
          text: 'My mother is dying from silverroot fever. Every Asterra remedy failed. Father found one account of moonleaf curing it in the other world.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'grieving',
          text: 'Mother taught me botany by making me write the cost beside every remedy: soil, labor, risk, consent. Father remembered only the name of the leaf.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'resolved',
          text: 'He reached the gate the morning it closed. He decided Veyra had denied him deliberately. Grief became suspicion, then law, then an army.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'Willowmere was not a symptom of his grief.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'grieving',
          text: 'No. It was his decision. I am asking you to help me stop my father, not forgive him.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'lucenMet', value: true },
          { type: 'increment', key: 'truthScore', amount: 1 },
          { type: 'addClue', id: 'royal_motive', name: 'The king’s motive', description: 'Edric believes Veyra deliberately closed the gate to deny Elara a moonleaf cure.' },
          { type: 'objective', text: 'Find Mara in the lower workshop.' },
        ],
      },
    },

    lucen_repeat: {
      id: 'lucen_repeat',
      kind: 'dialogue',
      title: 'Lucen',
      steps: [
        {
          type: 'line',
          speaker: 'lucen',
          text: 'If I inherit anything worth keeping, it will be the duty to answer citizens plainly.',
        },
      ],
    },

    meet_mara: {
      id: 'meet_mara',
      kind: 'dialogue',
      title: 'Cinder and the Starling',
      image: 'assets/images/scenes/starling-workshop.webp',
      imageAlt: 'Mara stands beneath the compact wooden airship Starling in Crown City’s secret workshop.',
      steps: [
        {
          type: 'line',
          speaker: 'mara',
          expression: 'appraising',
          text: 'You are the mushroom collector who broke a royal timetable. Good. I am Mara. “Cinder” if something is on fire and you need me quickly.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'grinning',
          text: 'Above us is the Starling: first airship to fly farther than its inventor can throw a wrench. Edric wanted bomb rails. I gave him steering problems.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'appraising',
          text: 'Elara funded the first frame to carry medicine over winter roads. When Edric asked how many bombs it could carry, I hid the working engine beneath his palace and let him believe the prototype hated corners.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'worried',
          text: 'For the record, I helped hide it.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'grinning',
          text: 'For the accurate record, you apologized to every guard we passed and held the wrench backward. But yes, Your Helpful Highness assisted.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'surprised',
          text: 'Can it reach the ice island?',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'determined',
          text: 'Frostcrown? Yes. Landing is a separate philosophical dispute.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'maraMet', value: true },
          { type: 'addItem', id: 'starling', name: 'The airship Starling' },
          { type: 'objective', text: 'Meet Cael in the workshop’s central aisle.' },
        ],
      },
    },

    mara_repeat: {
      id: 'mara_repeat',
      kind: 'dialogue',
      title: 'Mara',
      steps: [
        {
          type: 'line',
          speaker: 'mara',
          text: 'The Starling flies. The ground merely keeps interrupting the proof.',
        },
      ],
    },

    cael_confession: {
      id: 'cael_confession',
      kind: 'encounter',
      title: 'The truth Cael rationed',
      image: 'assets/images/scenes/starling-workshop.webp',
      imageAlt: 'Cael offers a silver oath cylinder to Aren beneath the Starling while Mara and Lucen watch.',
      steps: [
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'My name is Cael Varin, knight of Veyra. My king sent me through the gate before it closed. I removed the seven Asterra crystals.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'It was a one-way oath. Once the final crystal left its circle, the gate closed behind me. I expected to die here after the eclipse, when the crystals were weak enough to destroy.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'angry',
          text: 'You put wardens beside villages and sent a grieving boy where you could not walk.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'I placed wardens at empty circles. Settlements grew near them later. That does not absolve me. Nor does believing our seer.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'I did not tell you direct lies. I made every answer too small to contain the choice I wanted from you. That was still deceit.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'Every village we crossed has been living inside one of your shortened answers.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'determined',
          text: 'Ilyan foresaw Veyra’s ruin if the gate remained. During tomorrow’s eclipse, remove the crystals from their circles and they can be shattered forever.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'determined',
          text: 'Seven active circles share a slow, recoverable draw. One crystal could sustain an open gate alone, but it would drain its whole region to dust. Near totality, reopening the closed gate requires all seven.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'resolved',
          text: 'Or restore the gate under terms neither king controls. Prophecy is a warning, not a treaty.',
        },
        {
          type: 'choice',
          prompt: 'Which mission will Aren carry to Frostcrown?',
          options: [
            {
              text: 'Help Cael seal the gate forever',
              hint: 'Prioritize preventing magical depletion and the foretold catastrophe. Ending 2 will no longer be available.',
              effects: [
                { type: 'set', key: 'allegiance', value: 'seal' },
                { type: 'set', key: 'caelConfessed', value: true },
                { type: 'increment', key: 'caelTrust', amount: 2 },
              ],
              next: 'cael_choice_seal',
            },
            {
              text: 'Keep the gate possible; continue independently',
              hint: 'Reject Cael’s unilateral choice and preserve the option to restore the worlds’ connection.',
              effects: [
                { type: 'set', key: 'allegiance', value: 'open' },
                { type: 'set', key: 'caelConfessed', value: true },
                { type: 'increment', key: 'caelTrust', amount: -1 },
              ],
              next: 'cael_choice_open',
            },
          ],
        },
      ],
    },

    cael_confession_repeat: {
      id: 'cael_confession_repeat',
      kind: 'dialogue',
      title: 'Cael’s oath',
      steps: [
        {
          type: 'line',
          speaker: 'cael',
          text: 'No more omissions. Ask, and I will answer.',
        },
      ],
    },

    cael_choice_seal: {
      id: 'cael_choice_seal',
      kind: 'dialogue',
      title: 'A mission to sever',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'I will help seal the gate. Not because you hid the choice well, Cael—because one starving circle could become another Willowmere.',
          audio: 'aren_cael_seal',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'Then I will earn the trust I asked you to spend.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'We help Aren make this choice. We do not turn Cael’s certainty into a new crown.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Then at Frostcrown we count the people, the land, and the door. All of them.',
          when: { flag: 'miraJoined', equals: true },
        },
      ],
      onComplete: {
        effects: [
          { type: 'objective', text: 'Release the Starling from its workshop cradle.' },
        ],
      },
    },

    cael_choice_open: {
      id: 'cael_choice_open',
      kind: 'dialogue',
      title: 'A mission to keep a door',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'You decided for two worlds and called it necessity. I will stop Edric, but I will not destroy the only door before both sides can speak.',
          audio: 'aren_cael_open',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'I disagree. I will still take you to Frostcrown. That is what honesty costs me now.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'A door is not innocent. Neither is sealing it before the people on both sides can answer. We carry the argument together.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'And if the argument forgets civilians, I will interrupt it loudly.',
          when: { flag: 'miraJoined', equals: true },
        },
      ],
      onComplete: {
        effects: [
          { type: 'objective', text: 'Release the Starling from its workshop cradle.' },
        ],
      },
    },

    workshop_escape: {
      id: 'workshop_escape',
      kind: 'encounter',
      title: 'Release the Starling',
      image: 'assets/images/scenes/starling-workshop.webp',
      imageAlt: 'The Starling hangs above Aren, Cael, Mara, and Prince Lucen in the secret workshop.',
      steps: [
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'resolved',
          text: 'I remain here. I can open the public archive, delay the north guard, and make these records impossible to bury before Father returns.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'appraising',
          text: 'You always did choose the most dangerous way to organize paper. Keep your head down, Lucen.',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'relieved',
          text: 'Land the Starling once before criticizing my methods.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'calculating',
          text: 'Guards at the north stair. The cradle has two releases. One drops us fast. The other preserves the palace records.',
        },
        {
          type: 'choice',
          prompt: 'What does the party protect during the escape?',
          options: [
            {
              text: 'Protect Mara while she performs a controlled release',
              hint: 'The Starling launches cleanly; some copied records are left behind.',
              effects: [
                { type: 'set', key: 'protectedMara', value: true },
                { type: 'increment', key: 'miraTrust', amount: 1 },
                { type: 'encounter', id: 'workshop_escape', outcome: 'controlled_release' },
              ],
              next: 'workshop_launch',
            },
            {
              text: 'Save Lucen’s evidence and use the emergency release',
              hint: 'The launch is rough, but the public record survives.',
              effects: [
                { type: 'set', key: 'savedPalaceRecords', value: true },
                { type: 'increment', key: 'truthScore', amount: 1 },
                { type: 'encounter', id: 'workshop_escape', outcome: 'records_saved' },
              ],
              next: 'workshop_launch',
            },
          ],
        },
      ],
    },

    starling_repeat: {
      id: 'starling_repeat',
      kind: 'dialogue',
      title: 'The Starling',
      steps: [
        {
          type: 'line',
          speaker: 'mara',
          text: 'All aboard before the palace develops a second opinion.',
        },
      ],
    },

    workshop_launch: {
      id: 'workshop_launch',
      kind: 'transition',
      title: 'The first true flight',
      image: 'assets/images/scenes/starling-workshop.webp',
      imageAlt: 'The compact wooden Starling fills Crown City’s vaulted workshop above the gathered party.',
      steps: [
        {
          type: 'narration',
          text: 'The Starling breaks its last chain and rises through the launch door. Crown City shrinks beneath a machine built to connect distances, carrying one argument about whether a distance should remain.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'grinning',
          text: 'There is the northern edge of the Hand. Past those fingertips, every light is either Edric’s ship or Frostcrown ice. I recommend hoping for ice.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'From here, the circles look harmless. Seven points of light. Distance is generous to terrible decisions.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'guarded',
          text: 'That lantern line below is the old Mossreach road. Piri hated the steep turn. From up here, I nearly missed it.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'Willowmere is somewhere behind the wing. I thought leaving it would feel like walking away. From up here, every road is still connected.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'workshopResolved', value: true },
        ],
        checkpoint: 'Aboard the Starling',
        travel: { mapId: 'frostcrown', spawnId: 'airship_ledge' },
        next: 'frostcrown_arrival',
      },
    },

    frostcrown_arrival: {
      id: 'frostcrown_arrival',
      kind: 'cinematic',
      title: 'The last circle',
      chapter: 'V · Seven circles, one choice',
      image: 'assets/images/scenes/frostcrown-choice.webp',
      imageAlt: 'Aren stands at the final crystal between Bram, Cael, and the defeated king beneath an eclipsed moon.',
      steps: [
        {
          type: 'narration',
          text: 'Frostcrown lies beyond the Hand, where black water cuts the snow and the eclipse makes old magic quiet. Edric’s ship reached it first. The Starling reached it in time.',
          audio: 'narrator_frostcrown',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'This is the final checkpoint. Inspect the anchor and the seven-grooved ring, then speak with Cael before entering the circle.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'The Hand is behind us now. Whatever happens in that circle, we do not lose sight of the people waiting across the water.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'calculating',
          text: 'The Starling has one landing left in her, possibly two if the second is downhill. I would prefer the future include a workshop in which to argue about that.',
        },
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Greenwake and Ashfinger are not behind us. They are the reason every grand answer here needs a smaller, human one.',
          when: { flag: 'miraJoined', equals: true },
        },
      ],
      onComplete: {
        effects: [
          { type: 'objective', text: 'Prepare at Frostcrown, then enter the final circle.' },
        ],
        checkpoint: 'Frostcrown arrival',
      },
    },

    inspect_anchor: {
      id: 'inspect_anchor',
      kind: 'dialogue',
      title: 'The Starling’s anchor',
      steps: [
        {
          type: 'line',
          speaker: 'mara',
          expression: 'calculating',
          text: 'One cut releases the balloon into the crosswind. Very dramatic. Also useful if forty guards need to look away at once.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'anchorRouteKnown', value: true },
          { type: 'addClue', id: 'starling_anchor', name: 'Starling anchor release', description: 'Cutting the anchor would pull every guard’s attention toward the drifting airship.' },
        ],
      },
    },

    inspect_anchor_repeat: {
      id: 'inspect_anchor_repeat',
      kind: 'dialogue',
      title: 'Anchor line',
      steps: [
        {
          type: 'line',
          speaker: 'mara',
          text: 'Cut once. Run immediately. Admire the aerodynamics later.',
        },
      ],
    },

    inspect_seven_grooves: {
      id: 'inspect_seven_grooves',
      kind: 'dialogue',
      title: 'Seven grooves',
      steps: [
        {
          type: 'narration',
          text: 'The final dais has seven channels. Six glow faintly from restored circles across Asterra. The empty seventh remains dark beneath the floating crystal.',
        },
        {
          type: 'line',
          speaker: 'aren',
          text: 'One choice here travels through every circle.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'studiedFinalGrooves', value: true },
          { type: 'increment', key: 'truthScore', amount: 1 },
          { type: 'addClue', id: 'seven_grooves', name: 'Frostcrown’s seven grooves', description: 'The final choice will propagate through all restored crystal circles.' },
        ],
      },
    },

    inspect_seven_grooves_repeat: {
      id: 'inspect_seven_grooves_repeat',
      kind: 'dialogue',
      title: 'The final ring',
      steps: [
        {
          type: 'narration',
          text: 'Six channels glow. The seventh waits.',
        },
      ],
    },

    cael_frost: {
      id: 'cael_frost',
      kind: 'dialogue',
      title: 'Before the circle',
      steps: [
        {
          type: 'line',
          speaker: 'cael',
          expression: 'determined',
          text: 'During totality, the crystal can be lifted by hand. Outside its circle it can be shattered. Inside, it opens the way to Veyra.',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'I asked you to carry my certainty. I will not do that again. Whatever you choose, choose it with the whole truth you found.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'protective',
          text: 'And choose something you can still call yours tomorrow.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'I came here wanting Edric to feel my grief. I leave wanting him unable to hand it to anyone else. That is the only revenge I trust now.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'Then we make an opening, reach the crystal, and choose for the living—not against the dead.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'caelFrostSpoken', value: true },
        ],
      },
    },

    cael_frost_repeat: {
      id: 'cael_frost_repeat',
      kind: 'dialogue',
      title: 'Cael',
      steps: [
        {
          type: 'line',
          speaker: 'cael',
          text: 'The eclipse is beginning. I am ready to follow, not command.',
        },
      ],
    },

    mira_frost: {
      id: 'mira_frost',
      kind: 'dialogue',
      title: 'Mira’s measure',
      steps: [
        {
          type: 'line',
          speaker: 'mira',
          expression: 'focused',
          text: 'Kings and seers keep counting worlds. I count who gets home. Try to make those numbers agree.',
        },
      ],
    },

    mira_frost_repeat: {
      id: 'mira_frost_repeat',
      kind: 'dialogue',
      title: 'Mira',
      steps: [
        {
          type: 'line',
          speaker: 'mira',
          text: 'No prophecy gets to make civilians invisible.',
        },
      ],
    },

    frostcrown_final: {
      id: 'frostcrown_final',
      kind: 'encounter',
      title: 'The eclipse choice',
      image: 'assets/images/scenes/frostcrown-choice.webp',
      imageAlt: 'The final weakened crystal floats over an empty socket between Aren, Cael, Bram, and King Edric beneath a total eclipse.',
      steps: [
        {
          type: 'line',
          speaker: 'edric',
          expression: 'commanding',
          text: 'Stand aside. I need no territory in Veyra. No tribute. One leaf, and I will close the gate myself.',
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'angry',
          text: 'You said the villages were delays. Now you ask them to trust your next promise.',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'defeated',
          text: 'Crown, command, judgment—I will surrender all of it when Elara breathes without pain. I ask only that you let me reach her cure.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'angry',
          text: 'You still offer tomorrow’s surrender as payment for authority you are taking tonight. The circles and the lives around them are not yours to promise.',
        },
        {
          type: 'narration',
          text: 'The royal formation closes around the dais. Edric is exhausted, but his guards remain disciplined. The Starling strains at anchor. The warden circles above, weak in the eclipse.',
        },
        {
          type: 'choice',
          prompt: 'How does Aren break the formation?',
          options: [
            {
              text: 'Ask what Queen Elara would choose',
              hint: 'Use the motive and Elara’s own words against Edric’s certainty.',
              when: { flag: 'heardElaraName', equals: true },
              next: 'frostcrown_truth',
            },
            {
              text: 'Cut the Starling’s anchor line',
              hint: 'Use the inspected release to draw the guards away.',
              when: { flag: 'anchorRouteKnown', equals: true },
              next: 'frostcrown_anchor',
            },
            {
              text: 'Protect Mara while Bram breaks the winch',
              hint: 'A defensive approach that preserves the party.',
              next: 'frostcrown_protect',
            },
            {
              text: 'Charge Edric and the royal formation',
              hint: 'Reckless — the guards remain an overwhelming force.',
              next: 'gameover_frostcrown',
            },
          ],
        },
      ],
    },

    gameover_frostcrown: {
      id: 'gameover_frostcrown',
      kind: 'gameover',
      title: 'The circle closes',
      steps: [
        {
          type: 'gameover',
          title: 'The final choice was never reached',
          reason: 'Aren attacked the full royal formation alone. The guards contained him while Edric seated the seventh crystal and crossed before the party could act.',
          lesson: 'The encounter presented a motive, an anchor route, and a protective approach. Retry from Frostcrown and create an opening before confronting the king.',
        },
      ],
    },

    frostcrown_truth: {
      id: 'frostcrown_truth',
      kind: 'cinematic',
      title: 'What Elara chose',
      image: 'assets/images/scenes/frostcrown-choice.webp',
      imageAlt: 'Aren reaches toward the final crystal while King Edric kneels with Queen Elara’s flower locket.',
      steps: [
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'Elara wrote that no cure bought with unwilling lives could make her well. Are you saving her, or silencing the last person who could tell you to stop?',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'defeated',
          text: 'She knew. She asked Lucen to burn the book. I told myself fever had made her cruel to hope.',
        },
        {
          type: 'narration',
          text: 'Edric’s command falters. Lucen’s copied journal passes from guard to guard. The formation opens—not in surrender, but in doubt.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'motiveKnown', value: true },
          { type: 'set', key: 'finalApproach', value: 'truth' },
          { type: 'encounter', id: 'frostcrown_formation', outcome: 'truth_breaks_command' },
        ],
        next: 'frostcrown_decision',
      },
    },

    frostcrown_anchor: {
      id: 'frostcrown_anchor',
      kind: 'cinematic',
      title: 'The airship in the wind',
      image: 'assets/images/scenes/frostcrown-choice.webp',
      imageAlt: 'The Starling pulls at its anchor beyond the Frostcrown crystal circle.',
      steps: [
        {
          type: 'narration',
          text: 'The anchor parts. The Starling leaps sideways into the crosswind, every guard turning toward the only airship in Asterra. Mara catches the emergency line; Bram drops the winch across the causeway.',
        },
        {
          type: 'line',
          speaker: 'mara',
          expression: 'grinning',
          text: 'Landing remains a philosophical dispute!',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'finalApproach', value: 'anchor' },
          { type: 'encounter', id: 'frostcrown_formation', outcome: 'anchor_distraction' },
        ],
        next: 'frostcrown_decision',
      },
    },

    frostcrown_protect: {
      id: 'frostcrown_protect',
      kind: 'cinematic',
      title: 'Hold, then move',
      image: 'assets/images/scenes/frostcrown-choice.webp',
      imageAlt: 'Bram and Cael stand with Aren at the final Frostcrown crystal circle.',
      steps: [
        {
          type: 'narration',
          text: 'Aren shields Mara while Bram breaks the ice-bound winch. Cael holds the narrow step without drawing a blade. The royal line cannot advance without crushing its own engineers, and hesitation becomes an opening.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'set', key: 'finalApproach', value: 'protect' },
          { type: 'encounter', id: 'frostcrown_formation', outcome: 'protective_hold' },
        ],
        next: 'frostcrown_decision',
      },
    },

    frostcrown_decision: {
      id: 'frostcrown_decision',
      kind: 'encounter',
      title: 'One reachable crystal',
      image: 'assets/images/scenes/frostcrown-choice.webp',
      imageAlt: 'The weakened final crystal hangs within Aren’s reach as Edric, Cael, and Bram wait beneath the eclipse.',
      steps: [
        {
          type: 'narration',
          text: 'The ice-moth warden dissolves into amber light. Edric falls to one knee. The final crystal hangs within Aren’s reach, quiet enough to lift or break.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'No more choices made for people who never got a voice. This one is mine, and I know who it will cost.',
          audio: 'aren_frostcrown_choice',
        },
        {
          type: 'choice',
          prompt: 'Choose the fate of the gate.',
          options: [
            {
              text: 'Remove and shatter the seven crystals',
              hint: 'Seal Asterra and Veyra forever. Edric will die here, and Elara cannot receive moonleaf.',
              when: { flag: 'allegiance', equals: 'seal' },
              effects: [
                { type: 'set', key: 'finalResolved', value: true },
                { type: 'set', key: 'endingTrajectory', value: 'severed_dawn' },
              ],
              next: 'ending_severed_dawn',
            },
            {
              text: 'Defeat Edric here, then restore the final crystal',
              hint: 'Open the gate under Lucen’s future rule. Edric and Elara will not survive the delay.',
              when: { flag: 'allegiance', equals: 'open' },
              effects: [
                { type: 'set', key: 'finalResolved', value: true },
                { type: 'set', key: 'endingTrajectory', value: 'crown_of_ash' },
              ],
              next: 'ending_crown_of_ash',
            },
            {
              text: 'Let Edric cross, follow him, and demand Veyra’s answer',
              hint: 'Pursue the king into the other world, where mercy and a negotiated cure remain possible.',
              effects: [
                { type: 'set', key: 'finalResolved', value: true },
                { type: 'set', key: 'endingTrajectory', value: 'open_sky' },
              ],
              next: 'ending_open_sky',
            },
          ],
        },
      ],
    },

    ending_severed_dawn: {
      id: 'ending_severed_dawn',
      kind: 'ending',
      title: 'The Severed Dawn',
      image: 'assets/images/scenes/ending-severed-dawn.webp',
      imageAlt: 'Aren and Cael stand beside seven inert crystal fragments while snow settles before a dark gate.',
      steps: [
        {
          type: 'narration',
          text: 'Aren lifts the crystal from its circle. Cael wraps it in indigo cloth. During the last minute of totality, seven weakened crystals break like winter glass.',
        },
        {
          type: 'narration',
          text: 'Edric dies on Frostcrown reaching for a door that no longer exists. Elara dies three days later. Across Asterra, the circles cool, and no single region will ever be drained to keep the gate alive.',
          audio: 'narrator_ending_severed',
        },
        {
          type: 'line',
          speaker: 'cael',
          expression: 'guilty',
          text: 'We are safe from the prophecy. I wish safety did not sound so much like silence.',
        },
        {
          type: 'narration',
          text: 'Cael remains in Asterra to dismantle the empty circles and document every shortened answer he once gave. Lucen inherits a country without the cure his father promised and begins rebuilding it without promising that grief can be made fair.',
        },
        {
          type: 'narration',
          text: 'In spring, Aren and Bram return to Willowmere. They plant birch saplings around the memorial and build the first roof for whoever comes home. Aren keeps Tomas’s basket by the door, repaired once more.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'worried',
          text: 'We closed the only road to a world we never knew. We will spend the life it bought making sure certainty does not become another excuse.',
        },
        {
          type: 'ending',
          endingId: 'severed_dawn',
        },
      ],
    },

    ending_crown_of_ash: {
      id: 'ending_crown_of_ash',
      kind: 'ending',
      title: 'A Crown of Ash and Peace',
      image: 'assets/images/scenes/ending-crown-of-ash.webp',
      imageAlt: 'Prince Lucen lays down the royal sword before citizens as Aren watches and the restored gate glows beyond.',
      steps: [
        {
          type: 'narration',
          text: 'Edric dies in Asterra before the final crystal is seated. Aren completes the circle—not for the king, but because a door may still be more than the worst person who tried to use it.',
        },
        {
          type: 'narration',
          text: 'The gate opens too late for Elara. Lucen takes a repaired crown and lays down his father’s sword before the citizens of both saved and lost villages. His first treaty is with Veyra; his second places the gate under civilian stewardship.',
          audio: 'narrator_ending_crown',
        },
        {
          type: 'line',
          speaker: 'lucen',
          expression: 'resolved',
          text: 'Peace is not what follows a good king. It is what keeps one frightened king from owning every answer.',
        },
        {
          type: 'narration',
          text: 'At Elara’s funeral, Lucen reads the names of the dead from Mossreach, Willowmere, and Greenwake before he speaks either parent’s name. The preserved orders are opened beside her journals so motive and cost cannot be separated again.',
          when: { flag: 'lostVillage', equals: 'greenwake' },
        },
        {
          type: 'narration',
          text: 'At Elara’s funeral, Lucen reads the names of the dead from Mossreach, Willowmere, and Ashfinger before he speaks either parent’s name. The preserved orders are opened beside her journals so motive and cost cannot be separated again.',
          when: { flag: 'lostVillage', equals: 'ashfinger' },
        },
        {
          type: 'narration',
          text: 'Aren refuses a palace title. He accepts a civilian seat at the gate instead, on the condition that every circle has the power to close its own channel before magic begins to take more than the land can restore.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'An open door is not peace by itself. It is only a place where we can finally meet and answer one another.',
        },
        {
          type: 'ending',
          endingId: 'crown_of_ash',
        },
      ],
    },

    ending_open_sky: {
      id: 'ending_open_sky',
      kind: 'ending',
      title: 'The Open Sky',
      image: 'assets/images/scenes/ending-open-sky.webp',
      imageAlt: 'A healthy Queen Elara, Aren, Prince Lucen, and uncrowned Edric stand near an open portal beneath Veyra’s cyan leaves.',
      steps: [
        {
          type: 'narration',
          text: 'Edric crosses. Aren follows. Veyra is not an army waiting in triumph, but a moonlit garden crowded with healers, frightened guards, and people who know Cael’s name. The king finally learns that the gate was closed to prevent a foretold catastrophe—not to deny a cure.',
        },
        {
          type: 'narration',
          text: 'Edric draws his sword when Veyra refuses to hand medicine to an invading king. Aren does not answer with a duel. Cael names the oath, Bram blocks the narrow garden stair, and Veyran guards close every path except the one back toward his son. Edric lowers the blade first.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'You do not get forgiveness as the price of stopping. You get a chance to stop, step down, and carry what you did while Elara still has a chance to live.',
        },
        {
          type: 'line',
          speaker: 'edric',
          expression: 'defeated',
          text: 'The crown, the command, every claim beyond my own name. Take them. Give me the leaf, and I will spend whatever remains answering for the road here.',
        },
        {
          type: 'narration',
          text: 'Edric signs his abdication before Veyran healers release the moonleaf. Days later in Crown City, Elara wakes to find him uncrowned beside her bed and Lucen holding the public copy of her journal.',
        },
        {
          type: 'line',
          speaker: 'elara',
          expression: 'firm',
          text: 'A cure is not a pardon, Edric. It is time in which to answer. Do not waste what so many others were denied.',
        },
        {
          type: 'narration',
          text: 'Veyra gives moonleaf under one condition: Edric abdicates. Elara survives. Lucen becomes king. The gate remains open beneath a two-world council, and the seven circles share their gentle cost again.',
          audio: 'narrator_ending_open',
        },
        {
          type: 'narration',
          text: 'The next mushroom season, Aren climbs into Birchwood with a repaired basket and a courier’s map folded in his pocket. He returns before dusk—not because the Hand ends at Willowmere, but because home is now a place he can leave and choose again.',
        },
        {
          type: 'ending',
          endingId: 'open_sky',
        },
      ],
    },
  };

  const endings = {
    severed_dawn: {
      id: 'severed_dawn',
      number: 1,
      title: 'The Severed Dawn',
      subtitle: 'Safety, at the price of a door',
      image: 'assets/images/scenes/ending-severed-dawn.webp',
      imageAlt: 'Aren and Cael beside seven inert crystal fragments and a permanently dark gate.',
      summary: 'Aren helped Cael shatter the crystals. The worlds are permanently separated; Edric and Elara die, but no circle can drain its region again.',
      consequence: 'The gate is sealed forever.',
      color: '#9ec4d4',
    },
    crown_of_ash: {
      id: 'crown_of_ash',
      number: 2,
      title: 'A Crown of Ash and Peace',
      subtitle: 'An open door after two losses',
      image: 'assets/images/scenes/ending-crown-of-ash.webp',
      imageAlt: 'Prince Lucen lays down his father’s sword before citizens while the restored gate glows.',
      summary: 'Edric died before crossing. Elara could not be saved, but Lucen restored the gate, made peace with Veyra, and placed it under civilian control.',
      consequence: 'The gate opens under a new crown.',
      color: '#ffc247',
    },
    open_sky: {
      id: 'open_sky',
      number: 3,
      title: 'The Open Sky',
      subtitle: 'Mercy with conditions',
      image: 'assets/images/scenes/ending-open-sky.webp',
      imageAlt: 'Aren stands with a recovered Queen Elara, Prince Lucen, and an uncrowned Edric near Veyra’s open gate.',
      summary: 'Aren pursued Edric into Veyra, defeated and spared him, secured moonleaf through abdication, and helped build a two-world accord.',
      consequence: 'Elara lives, Lucen reigns, and the gate remains open.',
      color: '#6fe5ef',
    },
  };

  const library = Object.freeze({
    characters: Object.freeze([
      {
        id: 'aren',
        characterId: 'aren',
        epithet: 'The ordinary traveler',
        home: 'Willowmere, eastern Asterra',
        summary: 'Aren is a nineteen-year-old village hand who knows the paths around Willowmere better than he knows what he wants from the rest of his life.',
        journey: 'A mushroom errand leaves him outside Willowmere when the royal army destroys it. His first instinct is revenge; his harder journey is learning to make choices for the living without pretending grief has stopped speaking.',
        keepsake: 'He carries his father’s repaired mushroom basket, his mother’s habit of feeding everyone else first, and a pale memorial ribbon tied at his wrist.',
      },
      {
        id: 'vale_parents',
        name: 'Nessa & Tomas Vale',
        role: 'Willowmere neighbors and Aren’s parents',
        pronouns: 'she/her & he/him',
        ageLabel: 'Adults',
        accent: '#b8c9a2',
        epithet: 'The home inside the errand',
        home: 'Willowmere, eastern Asterra',
        summary: 'Nessa and Tomas never ask their son to become a hero. On the last ordinary afternoon, they ask him to gather mushrooms for a shared village supper.',
        journey: 'Nessa organizes meals and always serves herself last. Tomas repairs tools, teaches Aren to leave a mushroom patch able to grow again, and bakes bread everyone lovingly insults. Their deaths make Willowmere personal before it becomes political.',
        keepsake: 'A copper ladle, a leather awl, and one newly mended willow binding remain. Aren’s clearest inheritance is their habit of repairing what can still be saved.',
      },
      {
        id: 'bram',
        characterId: 'bram',
        epithet: 'The man who stayed alive',
        home: 'Mossreach, formerly the northern mills',
        summary: 'Bram is a woodcutter and former militia fighter whose wife, Sella, and daughter, Piri, died during the first crystal restoration.',
        journey: 'He recognizes his own anger in Aren and becomes the companion willing to stand between the young man and a meaningless death. Bram wants Edric stopped, but refuses to let revenge decide whom the party leaves behind.',
        keepsake: 'Piri’s first wooden bird hangs at his neck. Its uneven wings remind him that people should be remembered for how they lived, not used as reasons to harm someone else.',
      },
      {
        id: 'cael',
        characterId: 'cael',
        epithet: 'The knight with shortened answers',
        home: 'Veyra, beyond the old gate',
        summary: 'Sir Cael Varin crossed from Veyra on a one-way mission to remove Asterra’s seven crystals and prevent the catastrophe foretold by his world’s seer.',
        journey: 'Wounded before he can destroy the crystals, Cael uses careful omissions to send Aren after them. He eventually admits that an answer can avoid being a lie and still be deceit, then yields the final choice he once tried to control.',
        keepsake: 'His silver oath cylinder records the mission that stranded him. Indigo cloth at his belt was meant to wrap the weakened crystals during the eclipse.',
      },
      {
        id: 'mira',
        characterId: 'mira',
        epithet: 'Keeper of the living count',
        home: 'Greenwake, the reed finger',
        summary: 'Mira is a young healer who becomes an evacuation leader because somebody has to turn warnings into boats, bandages, names, and routes.',
        journey: 'Whether met in Greenwake or under Ashfinger’s battle bell, she insists that decisions made for worlds and kingdoms must still account for individual people. When she travels with Aren, protecting civilians becomes the party’s measure of success; when she stays, she builds that principle into Greenwake.',
        keepsake: 'Her evacuation ledger is practical, battered, and precious. A check mark means a person reached safety; an empty space is never treated as an acceptable abstraction.',
      },
      {
        id: 'mara',
        characterId: 'mara',
        epithet: 'Builder of shorter distances',
        home: 'The hidden Crown City workshop',
        summary: 'Mara “Cinder” Vell is the restless engineer behind the Starling, Asterra’s first airship capable of crossing the sea to Frostcrown.',
        journey: 'Queen Elara funded the craft to carry medicine over winter roads. When Edric demanded bomb rails, Mara hid the working engine beneath his palace and joined Lucen’s effort to make invention serve connection instead of conquest.',
        keepsake: 'Amber goggles, a folding brass spanner, and the conviction that landing is a separate philosophical dispute from flying.',
      },
      {
        id: 'edric',
        characterId: 'edric',
        epithet: 'The king who made grief a command',
        home: 'Crown City, central Asterra',
        summary: 'Edric was once a conscientious king. When Queen Elara’s illness resisted every known cure, he let love harden into certainty that Veyra had closed the gate to deny her medicine.',
        journey: 'He restores the circles at any civilian cost and calls destroyed communities delays, even while memorizing their casualty rolls. His devotion explains the road to Frostcrown; it never excuses the people he knowingly placed beneath it.',
        keepsake: 'A glass locket holds Elara’s pressed moonflower. He closes one hand around it whenever the person he loves becomes indistinguishable from the orders he gives.',
      },
      {
        id: 'elara',
        characterId: 'elara',
        epithet: 'The conscience used as an excuse',
        home: 'Crown City, central Asterra',
        summary: 'Queen Elara is a natural philosopher and public servant weakened by silverroot fever but never made passive by it.',
        journey: 'Her botanical journal identifies Veyran moonleaf as a possible cure and explicitly rejects any remedy purchased with unwilling lives. Edric suppresses that choice while claiming to act for her, making her own words vital at Frostcrown.',
        keepsake: 'Her field journals record the cost beside every remedy: soil, labor, risk, and consent. In the most hopeful ending, survival gives her time to demand accountability rather than erase it.',
      },
      {
        id: 'lucen',
        characterId: 'lucen',
        epithet: 'The prince beneath the palace',
        home: 'Crown City, central Asterra',
        summary: 'Prince Lucen is Edric and Elara’s son, a careful archivist who chooses resistance after private appeals fail to slow his father.',
        journey: 'He copies the Willowmere orders before they can be destroyed, opens forbidden records, and helps conceal the Starling. Lucen does not ask Aren to make royal apologies comfortable; he offers evidence and accepts the duty to answer plainly.',
        keepsake: 'His copied ledgers preserve both motive and cost. If he becomes king, he treats public records and civilian authority as safeguards against another frightened ruler owning every answer.',
      },
      {
        id: 'rowan',
        characterId: 'rowan',
        epithet: 'Keeper of the stubborn farm',
        home: 'Rowanstead Farm, outside Willowmere',
        summary: 'Rowan is the elderly farmer who finds Cael dying in a turnip trench and spends two years keeping him alive without pretending to believe all of his answers.',
        journey: 'After Willowmere burns, her kitchen becomes an infirmary and her farm the first place where Aren can sit, eat, and hear how large the crystal race has become. She offers shelter without surrendering her judgment.',
        keepsake: 'A perpetually offended kettle and a practical rule: grief does not excuse anyone from having a body that needs food, rest, and care.',
      },
      {
        id: 'holt',
        characterId: 'holt',
        epithet: 'The timetable in armor',
        home: 'The royal field camps',
        summary: 'Commander Holt directs the disciplined royal formations that escort the crystals, suppress witnesses, and keep Edric’s restoration moving.',
        journey: 'Holt is not a secret final villain. He is the more ordinary danger of a capable officer who turns “civilian delay unacceptable” into procedure and lets a king’s desperation become everybody else’s emergency.',
        keepsake: 'His rain-damaged orders remain as evidence after the campaign: cruelty written as a schedule is still a choice somebody made.',
      },
    ]),
    locations: Object.freeze([
      {
        id: 'asterra_hand',
        name: 'Asterra and the Hand',
        region: 'The first world',
        image: 'assets/images/environments/hand-world-map.webp',
        imageAlt: 'A painted chart of Asterra’s hand-shaped island-continent and Frostcrown Isle.',
        summary: 'Asterra’s settled continent resembles an open hand: four long fingers, a volcanic thumb, and a broad central palm linked by roads and waterways.',
        story: 'Seven crystal circles are distributed across this landscape. The journey makes their distance tangible—warnings cannot reach every finger at once, and a decision at Frostcrown can still change soil far across the Hand.',
        memory: 'The map begins as geography and becomes a record of choices: one route carries survivors, another smoke, and every line eventually points beyond the northern sea.',
      },
      {
        id: 'birchwood',
        mapId: 'birchwood',
        image: 'assets/images/environments/title-key-art.webp',
        imageAlt: 'Aren stands in a forested landscape beneath an eclipsed sky.',
        summary: 'A damp birch forest one quiet hour above Willowmere, rich with coppercaps, moonbells, and fox-ear mushrooms after the rain.',
        story: 'Birchwood teaches Aren—and the player—to look closely before acting. The last ordinary errand begins here, beside a weathered seven-marked stone whose importance nobody in Willowmere remembers.',
        memory: 'At the end of the longest route, Aren returns in mushroom season with a courier’s map in his pocket and home waiting below by choice.',
      },
      {
        id: 'willowmere',
        mapId: 'willowmere',
        image: 'assets/images/scenes/willowmere-ruins.webp',
        imageAlt: 'Willowmere’s damaged homes and survivors beneath lantern light.',
        summary: 'A small farming village on the eastern finger, built close to an ancient crystal circle long after its purpose was forgotten.',
        story: 'The royal army defeats the circle’s warden without evacuating the village. Willowmere’s destruction takes Aren’s parents and ends the ordinary future he had postponed choosing.',
        memory: 'A pale ribbon memorial and a full mushroom basket beneath the last birch keep Willowmere from becoming only the place where the plot began.',
      },
      {
        id: 'mossreach',
        name: 'Mossreach',
        region: 'Northern mill country',
        knownOnly: true,
        image: 'assets/images/environments/hand-world-map.webp',
        imageAlt: 'A painted chart of the Hand, including the northern mill country where Mossreach once stood.',
        summary: 'A mill settlement destroyed during the first royal attempt to return a crystal, years before the army reaches Willowmere.',
        story: 'Mossreach is not an exploration map, but its absence travels with Bram. The disaster killed Sella and Piri, taught the army how to fight a crystal warden, and showed Edric that a village could be entered into the cost of a timetable.',
        memory: 'Piri’s uneven wooden bird and Bram’s knowledge of royal supply roads keep Mossreach present. It is the earlier warning Asterra failed to hear.',
      },
      {
        id: 'rowanstead',
        name: 'Rowanstead Farm',
        region: 'Eastern edge of Willowmere',
        image: 'assets/images/scenes/willowmere-ruins.webp',
        imageAlt: 'Lanterns burn near the surviving edge of Willowmere, where Rowanstead Farm shelters the wounded.',
        summary: 'A stubborn farm beyond Willowmere’s ruined lanes whose roof, well, kitchen, and keeper survive the attack.',
        story: 'Rowan hides the wounded Cael here for two years. After the fire, the farmhouse becomes an improvised ward and the place where Aren first learns that his village is one point in a race across seven circles.',
        memory: 'A hot bowl left untouched marks the moment the adventure becomes larger than Aren can absorb, while Rowan insists that bodies still need care inside world-sized grief.',
      },
      {
        id: 'greenwake',
        mapId: 'greenwake',
        image: 'assets/images/environments/hand-world-map.webp',
        imageAlt: 'A painted chart showing the long river fingers of the Hand where Greenwake’s wetlands lie.',
        summary: 'A canal village among reed channels, low bridges, evacuation bells, and old maintenance routes on the southeastern finger.',
        story: 'Greenwake represents what a warning can accomplish if it arrives in time. Its boats and bells turn knowledge into movement, but staying long enough to save it costs precious hours elsewhere.',
        memory: 'Mira’s ledger and the descending reed-bell rhythm reduce no one to a nameless crowd: every family must be counted onto high ground.',
      },
      {
        id: 'ashfinger',
        mapId: 'ashfinger',
        image: 'assets/images/scenes/ashfinger-rescue.webp',
        imageAlt: 'A rescue through Ashfinger’s flooded mill lane beneath a distant crystal warden.',
        summary: 'A rain-dark mill valley where floodwater, a royal formation, and a towering crystal warden leave civilians with no obvious way out.',
        story: 'Ashfinger is the clearest statement of the game’s encounters: victory is not defeating an army but finding a third direction for trapped people. The sluice and rope routes reward attention and protection.',
        memory: 'A child’s red cup and a stopped battle bell give weight to arriving late; bandaged hands give weight to arriving in time.',
      },
      {
        id: 'cinder_thumb',
        mapId: 'cinder_thumb',
        image: 'assets/images/scenes/cinder-thumb.webp',
        imageAlt: 'A volcanic causeway, royal soldiers, and an amber-cracked basalt warden at Cinder Thumb.',
        summary: 'A village-less volcanic reach of basalt shelves, lava fissures, steam vents, and the fifth restored crystal circle.',
        story: 'The lack of civilians makes Cinder Thumb the first place Aren can confront Edric directly. Studying how the mountain breathes creates an escape where a charge through forty guards cannot.',
        memory: 'Here the king stops being a distant emblem. He knows Nessa and Tomas by name, forcing Aren to face a man whose human grief produces inhuman decisions.',
      },
      {
        id: 'crown_city',
        mapId: 'crown_city',
        image: 'assets/images/scenes/starling-workshop.webp',
        imageAlt: 'The Starling airship above the hidden workshop beneath Crown City.',
        summary: 'Asterra’s capital rises over sealed archives, a forbidden workshop, the sixth circle, and a resistance hidden beneath its own palace.',
        story: 'Lucen’s records reveal Edric’s motive and Elara’s refusal. Mara’s workshop supplies the only route to Frostcrown, while Cael’s confession turns buried history into the game’s central moral choice.',
        memory: 'The Starling was designed to carry medicine over winter roads. Its launch reclaims that purpose from the bomb rails Edric requested.',
      },
      {
        id: 'frostcrown',
        mapId: 'frostcrown',
        image: 'assets/images/scenes/frostcrown-choice.webp',
        imageAlt: 'The final crystal circle on Frostcrown Isle beneath a total lunar eclipse.',
        summary: 'A remote ice island beyond the Hand’s northern fingers, separated by black water and reachable only by airship during the story.',
        story: 'The seventh crystal is quiet enough to lift during totality. Every earlier warning, clue, rescue, omission, and relationship converges here before Aren chooses whether the gate is shattered, restored, or crossed.',
        memory: 'Frostcrown is not an arena for a stronger hero. It is a place where truth, protection, and an anchor line can open the formation that force cannot.',
      },
      {
        id: 'veyra',
        name: 'Veyra',
        region: 'The second world',
        image: 'assets/images/scenes/ending-open-sky.webp',
        imageAlt: 'A luminous Veyran garden with cyan leaves beside the open gate.',
        summary: 'The world beyond the gate is known in Asterra through fragments: moonleaf medicine, Cael’s oath, an old prophecy, and centuries of unanswered assumptions.',
        story: 'Veyra is reached directly in The Open Sky ending, where it proves neither enemy kingdom nor effortless cure. Its people offer moonleaf under terms that end Edric’s rule and begin shared stewardship of the gate.',
        memory: 'A moonlit healing garden replaces the imagined battlefield. The first lasting connection between worlds begins with conditions, records, and the refusal to confuse mercy with pardon.',
      },
    ]),
  });

  const story = Object.freeze({
    meta: {
      id: 'the-great-adventure',
      title: 'The great adventure',
      subtitle: 'Seven crystals between worlds',
      language: 'en',
      intendedMinutes: '20–30',
      version: 1,
      dimensions: {
        d1: 'Asterra',
        d2: 'Veyra',
      },
      continent: 'the Hand',
      crystalCount: 7,
    },
    initialScene: 'prologue_intro',
    scenes,
    endings,
    library,
    encounters: [
      'ridge_smoke',
      'ashfinger_encounter',
      'cinder_standoff',
      'workshop_escape',
      'frostcrown_final',
    ],
    gameOverScenes: [
      'gameover_ridge',
      'gameover_ashfinger',
      'gameover_cinder',
      'gameover_frostcrown',
    ],
    materialChoices: [
      'rowanstead_cael',
      'warn_greenwake',
      'ashfinger_encounter',
      'cael_confession',
      'frostcrown_decision',
    ],
    assets: {
      initial: [
        'assets/images/environments/title-key-art.webp',
        'assets/images/environments/title-thumbnail.webp',
        'assets/images/portraits/aren.webp',
      ],
      deferred: [
        'assets/images/environments/hand-world-map.webp',
        'assets/images/portraits/bram.webp',
        'assets/images/portraits/cael.webp',
        'assets/images/portraits/mira.webp',
        'assets/images/portraits/mara.webp',
        'assets/images/portraits/edric.webp',
        'assets/images/portraits/elara.webp',
        'assets/images/portraits/lucen.webp',
        'assets/images/scenes/willowmere-ruins.webp',
        'assets/images/scenes/ashfinger-rescue.webp',
        'assets/images/scenes/cinder-thumb.webp',
        'assets/images/scenes/starling-workshop.webp',
        'assets/images/scenes/frostcrown-choice.webp',
        'assets/images/scenes/ending-severed-dawn.webp',
        'assets/images/scenes/ending-crown-of-ash.webp',
        'assets/images/scenes/ending-open-sky.webp',
      ],
    },
  });

  root.GAME_STORY = story;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = story;
  }
}(typeof window !== 'undefined' ? window : globalThis));
