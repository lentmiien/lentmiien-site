'use strict';

(function exposeStory(root) {
  const scenes = {
    prologue_intro: {
      id: 'prologue_intro',
      kind: 'cinematic',
      title: 'An ordinary afternoon',
      chapter: 'I · An ordinary day',
      image: 'assets/images/environments/title-key-art.webp',
      imageAlt: 'Aren looks across the Hand-shaped continent beneath an eclipsed moon, with seven distant crystal circles and a gate between worlds.',
      steps: [
        {
          type: 'narration',
          text: 'On the eastern finger of Asterra, beyond the roads important people bothered to map, Willowmere was having an ordinary afternoon.',
          audio: 'narrator_intro_birchwood',
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
          text: 'Dry gills, clean stems. Mum will pretend she expected me to find these.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'increment', key: 'mushroomsGathered', amount: 1 },
          { type: 'addItem', id: 'coppercaps', name: 'Coppercaps' },
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
          text: 'Moonbells. Peppery, if Bram from the mill is wrong about everything except mushrooms.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'increment', key: 'mushroomsGathered', amount: 1 },
          { type: 'addItem', id: 'moonbells', name: 'Moonbells' },
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
          text: 'That is three. If I hurry, I can still complain about chores while eating the result.',
        },
        {
          type: 'line',
          speaker: 'system',
          text: 'All three mushroom kinds collected. Follow the southern trail home.',
        },
      ],
      onComplete: {
        effects: [
          { type: 'increment', key: 'mushroomsGathered', amount: 1 },
          { type: 'addItem', id: 'foxears', name: 'Fox-ear mushrooms' },
          { type: 'objective', text: 'Return to Willowmere by the southern trail.' },
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
          speaker: 'bram',
          expression: 'grieving',
          text: 'Mossreach was the first circle. My wife Sella and our Piri were there. I know the road your anger is pointing down.',
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
          expression: 'protective',
          text: 'I will walk with you. But if you start mistaking dying for justice, I will be irritatingly alive beside you.',
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
          type: 'line',
          speaker: 'rowan',
          text: 'This is Cael. I found him half-dead in my turnip trench two years ago. He has been waiting for somebody foolish enough to move faster than an army.',
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
        },
        {
          type: 'line',
          speaker: 'bram',
          expression: 'grieving',
          text: 'We chose people in front of us. That does not make the people beyond us matter less.',
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
          expression: 'determined',
          text: 'The army has the north road. The warden has the ridge. I have twelve people trapped at the mill and no third direction.',
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
          type: 'line',
          speaker: 'aren',
          expression: 'hurt',
          text: 'Greenwake is alive because we stayed. Ashfinger is gone because we could not be in two places.',
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
          type: 'narration',
          text: 'The fifth circle burns behind them. The sixth lies on the main island, beneath Crown City, where a prince, an archive, and an unfinished airship are waiting.',
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
          text: 'My mother is dying from silverroot fever. Every Asterra remedy failed. Father found one account of moonleaf curing it in the other world.',
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
          expression: 'determined',
          text: 'Ilyan foresaw Veyra’s ruin if the gate remained. During tomorrow’s eclipse, remove the crystals from their circles and they can be shattered forever.',
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
          text: 'Edric crosses. Aren follows. In Veyra, the king finally learns that Cael closed the gate to prevent a foretold catastrophe—not to deny a cure. He fights once more and loses without being killed.',
        },
        {
          type: 'line',
          speaker: 'aren',
          expression: 'determined',
          text: 'You do not get forgiveness as the price of stopping. You get a chance to stop, step down, and carry what you did while Elara still has a chance to live.',
        },
        {
          type: 'narration',
          text: 'Veyra gives moonleaf under one condition: Edric abdicates. Elara survives. Lucen becomes king. The gate remains open beneath a two-world council, and the seven circles share their gentle cost again.',
          audio: 'narrator_ending_open',
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
