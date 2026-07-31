# The great adventure — Game Design

## Promise and scope

**The great adventure** is a 20–30 minute, English-language, story-first 2D RPG for casual young-adult players. It adapts the Swedish outline in `../idea.txt` into a complete fantasy drama about seven crystals, two worlds, and the damage caused when grief becomes policy.

The original concepts remain central: the Hand-shaped continent, seven crystal circles, a forgotten dimensional gate, a desperate king, a wounded knight from the second world, a destroyed home village, an airship, a lunar eclipse, and three distinct endings. New names, connective locations, supporting characters, clues, motives, and scene-level choices were added where the outline was intentionally incomplete.

The two dimensions are named **Asterra** (D1, where play begins) and **Veyra** (D2). Asterra’s single continent keeps its source name, **the Hand**.

## Core loop

1. Explore a compact top-down location for two to four minutes.
2. Talk to characters and inspect marked objects for clues, atmosphere, and safer encounter options.
3. Reach a story trigger and watch a short illustrated dialogue or cinematic.
4. Make a choice that changes trust, rescue outcomes, available approaches, or the ending trajectory.
5. Resolve a story encounter without conventional combat.
6. Reach an automatic checkpoint, then travel to the next authored map.

The bulk of the experience is delivered through cut-scenes, but each chapter first gives the player room to walk, inspect, and form an opinion.

## Camera, tiles, and movement

- Fixed top-down camera rendered to a responsive HTML canvas.
- Logical tile size: **48 × 48 CSS pixels** before viewport scaling.
- Authored maps use rectangular character grids in `js/maps.js`; they are never screenshots.
- The canvas scales the visible world to fit while preserving its aspect ratio. The camera eases toward the player on maps larger than the viewport.
- Four-direction movement uses collision-aware continuous motion over the tile grid.
- Keyboard: Arrow keys or WASD to move; Enter, Space, or E to interact/advance; Escape to pause/cancel; number keys or arrows to select choices.
- Touch: a four-way directional pad plus a large context-sensitive Interact button.
- Gamepad is not included; keyboard and touch receive the complete interaction set.

Tile symbols separate visuals from rules. Each map defines walkable ground, solid terrain, hazards, exits, spawns, NPCs, objects, and event triggers. Water, cliffs, walls, forest edges, lava, and the void around Frostcrown are visibly distinct and collide consistently.

## Location and map structure

1. **Birchwood** — a gentle mushroom-gathering tutorial above Willowmere. A weathered gate sigil foreshadows the old portal.
2. **Willowmere Ruins & Rowanstead Farm** — the protagonist’s destroyed village, Bram’s introduction, a memorial, the wounded Sir Cael, and the first full explanation of the crystal race.
3. **Greenwake** — a living canal village on one finger of the Hand. It can be warned and evacuated or found ruined, depending on route order.
4. **Ashfinger** — the king’s army, a crystal demon, and a rescue encounter. Going here first saves people under fire; going here second reveals the cost of arriving late.
5. **Cinder Thumb** — a volcanic crystal circle with no settlement. Heat vents can be studied before the first direct confrontation with King Edric.
6. **Crown City** — palace archives, Prince Lucen’s resistance, Mara “Cinder” Vell’s airship workshop, Cael’s full confession, and the decisive gate-or-seal allegiance.
7. **Frostcrown Isle** — the last crystal circle during a total lunar eclipse, the final multi-choice encounter, and the branch into one of three endings.
8. **Veyra** — illustrated cut-scenes only. It is reached during the reconciliation ending rather than used as an exploration map.

Travel between distant fingers is compressed into short narrated transitions. This keeps the Hand geographically large without padding the play time with empty walking.

## Interaction system

- Nearby interactable NPCs and objects receive an amber focus marker.
- A DOM prompt describes the action in plain English, for example “E — Inspect the scorched banner.”
- Important objects are usable from any adjacent walkable tile.
- Required interactions are tracked by stable IDs. Optional discoveries add transcript entries and flags but never soft-lock progress.
- Exit tiles show the destination and can require a scene, clue count, or completed objective.
- If an image fails, dialogue and map play continue with a themed fallback panel and descriptive alt text.

## Dialogue, cut-scenes, and choices

Story content lives in `js/story.js`; recurring character presentation lives in `js/characters.js`. The engine in `js/game.js` interprets scene steps rather than hard-coding individual conversations.

Scene steps may:

- show dialogue, narration, or a cinematic image;
- play a narrator or Aren voice clip after the initial user gesture;
- set, increment, or clear flags;
- add a clue or story item;
- present two to four choices;
- branch to another scene;
- start an encounter;
- move the player to a map/spawn;
- create a checkpoint;
- resolve an ending or game-over state.

Dialogue is concise, normally one to three sentences per card. Optional lore is placed in journals, monuments, tools, and conversations. All displayed dialogue and narration is copied into an in-game transcript/history.

## Story flags and progression

The save schema explicitly tracks:

- current map and spawn;
- player position and facing;
- completed and active scenes;
- inspected interactions;
- story flags and numeric truth/trust values;
- clues and story items;
- finger-route order;
- rescued village and optional companion state;
- encounter outcomes;
- checkpoint snapshot;
- ending ID;
- settings and accessibility preferences.

Material flags include:

- `mushroomsGathered` — completes the movement tutorial.
- `ridgeWarningSeen` — records the first clear warning not to charge trained soldiers.
- `bramJoined` — forms the initial party.
- `caelPartialTruth` — accepts Cael’s first mission without yet knowing his origin.
- `firstFinger` — `greenwake` or `ashfinger`; controls which community can be saved.
- `villagersSaved` and `miraJoined` — reward rescue-focused play.
- `sluiceRouteKnown` — unlocks a safer Ashfinger rescue option.
- `ventPatternKnown` — unlocks a safer Cinder Thumb encounter option.
- `heardElaraName`, `foundRoyalJournal`, and `foundGateLedger` — build `truthScore` and enrich the final confrontation.
- `caelTrust` and `bramTrust` — change later dialogue and epilogue details.
- `allegiance` — `seal` after helping Cael or `open` after continuing independently.
- `finalApproach` — determines how the Frostcrown encounter begins.

Minor conversational choices often alter trust or phrasing without creating costly branches. The finger order, rescue approach, Cael allegiance, and final approach materially affect progression.

## Story encounters

Story encounters use two or three rounds of clearly described decisions. There are no hit points, battle statistics, equipment, or hidden dice.

Dangerous choices are foreshadowed. A head-on attack against the king’s trained guard or a crystal demon can cause game over, but the choice label and preceding dialogue plainly communicate the risk. Knowledge gathered during exploration creates additional options rather than arbitrary bonuses.

Planned encounters:

1. **Smoke on the ridge** — attacking an armored patrol alone causes a fast, explained game over; observing and helping survivors continues.
2. **Ashfinger evacuation** — distract soldiers, use the inspected sluice, protect villagers, or recklessly chase the commander. Outcomes change the number rescued and whether Mira joins.
3. **Cinder Thumb standoff** — use mapped heat vents, shield Bram, or charge King Edric. The king always escapes after the army seats the crystal, as established in the source.
4. **Workshop escape** — hide evidence, release the airship cradle, and choose whom to protect. Failure is a recoverable setback, not game over.
5. **Frostcrown eclipse** — a final choice-battle against overwhelming royal forces, followed by the seal, restore, or pursue decision that selects an ending.

The protagonist is never presented as capable of winning a conventional duel that the mechanics do not simulate.

## Narrative structure

### Act I — Smoke

Aren Vale gathers mushrooms on an ordinary afternoon. Returning at dusk, he finds Willowmere destroyed after the king’s army fought a demon beside a crystal circle. His parents are dead. Bram Alder, whose wife and daughter were killed in the earlier Mossreach disaster, stops Aren from turning grief into a suicidal charge. At Rowanstead Farm they meet the wounded Sir Cael, who asks them to prevent the king from restoring all seven crystals but conceals that he came from Veyra and originally removed them.

### Act II — The fingers

The party chooses whether to warn Greenwake first or enter the active battle at Ashfinger. One community can be meaningfully saved; the other becomes evidence of the army’s indifference. Mira Fen may join after a rescue-focused approach. At the volcanic Cinder Thumb, the party confronts King Edric for the first time and hears him call for Queen Elara, hinting that conquest is not his only motive.

### Act III — The palm

In Crown City, Prince Lucen reveals the queen’s fatal illness and his father’s suppression of anyone linked to the crystals. Royal records confirm that a Veyran moonleaf may be a cure. Mara “Cinder” Vell reveals the airship Starling. Cael returns and admits that Veyra’s seer predicted catastrophe unless the gate is permanently sealed; one crystal alone would drain its surroundings dry. The player either helps Cael destroy the crystals at eclipse or rejects his unilateral plan and keeps open the possibility of restoring the gate.

### Act IV — The eclipse

The Starling reaches Frostcrown as the king brings the last crystal to its circle. The party survives a choice-driven confrontation. The player can sever the worlds, restore the gate after defeating Edric in Asterra, or let him cross and follow him into Veyra. The final path reveals the entire motive and allows mercy, abdication, medicine, and a monitored open gate.

## Endings

1. **The Severed Dawn** — available on the `seal` allegiance. Aren and Cael defeat Edric before the final restoration; Edric dies in Asterra, the crystals are shattered during the eclipse, Elara dies, and the dimensions are permanently separated. The world is safe from magical depletion, but certainty carries an irreversible human cost.
2. **A Crown of Ash and Peace** — available on the `open` allegiance. Edric dies before crossing, Aren completes the remaining circles because the gate may still be needed, Elara dies before aid arrives, and Lucen becomes king. He makes peace with Veyra and places the gate under civilian stewardship.
3. **The Open Sky** — available from either allegiance by choosing pursuit over immediate certainty. Aren follows Edric into Veyra, learns the full story, defeats but spares him, and negotiates moonleaf in exchange for abdication. Elara survives, Lucen takes the crown, and the gate remains open under a two-world accord.

The endings preserve the three source outcomes while translating “defeat” into story consequences rather than conventional combat. Ending three is the most hopeful, but the game does not label another ending as incorrect.

## Failure, checkpoints, save, and retry

- Automatic local save occurs after every completed scene, map transition, setting change, and checkpoint.
- Eight named checkpoints are created at the smoke ridge, on reaching Willowmere, at Rowanstead’s route fork, after the finger chapter, on entering and leaving Cinder Thumb, aboard the Starling, and on arrival at Frostcrown.
- Game over explains which warning was ignored and offers **Retry checkpoint**, **Return to title**, and **Restart adventure**.
- Pause offers **Resume**, **Save now**, **Retry checkpoint**, **Settings**, **Help**, and **Title screen**.
- Continue appears only when a valid save exists.
- A “Continue from ending” save returns to the ending gallery; New Game asks for confirmation before replacing progress.
- Storage reads and writes are wrapped in `try/catch`. Corrupt or unavailable storage produces a polite warning and keeps the in-memory game fully playable.
- Restart clears only this game’s save key, never unrelated local storage.

## Audio and accessibility

- Aren uses Piper **`en_US-lessac-medium`**, a clear youthful-to-neutral male English voice.
- The narrator uses Piper **`en_US-amy-medium`**, a distinct warm female English voice.
- Bram, Cael, Mira, Mara, Edric, Elara, and Lucen remain text-only.
- Voice playback begins only after New Game/Continue or an explicit replay gesture.
- Exact captions accompany every spoken clip; a replay control is present during voiced lines.
- Voice volume, mute, and automatic voice playback are independently configurable.
- Text speed offers instant, fast, and relaxed modes.
- The UI uses semantic dialogs, buttons, labels, headings, landmarks, focus trapping, polite status announcements, and visible focus rings.
- A transcript/history is available from exploration, dialogue, pause, and endings.
- Reduced motion follows `prefers-reduced-motion` by default and can also be forced on. Decorative particles can be disabled independently.
- Touch targets are at least 44 CSS pixels, include safe-area padding, and rearrange for narrow portrait and short landscape screens.
- Essential narrative information never relies on color, animation, audio, or generated imagery alone.

## Visual direction

Character and scene artwork uses a coherent anime-inspired painted-2D style: clean expressive faces, restrained linework, textured fantasy fabrics, cinematic rim light, and slightly simplified shapes that remain readable at small sizes. Maps use deterministic canvas tiles with the same graphite shadows, ember firelight, amber magic, desaturated forest greens, and Veyran cyan accents.

The page imports `/css/color-theme.css`. Graphite is the structural base, Ember marks primary actions, Golden Amber marks focus, links, crystal light, and highlights, and semantic Jade/Vermilion mark success/danger. Subject colors never replace the shared UI hierarchy.

## Deliberate adaptation decisions

- Names were created for all previously unnamed people and dimensions.
- Aren is nineteen rather than a child, matching the young-adult audience while preserving the “ordinary boy” premise.
- Bram’s grief remains, but his role expands from revenge companion to the person who warns Aren what revenge can become.
- Cael’s concealment is treated as manipulation with understandable stakes, giving the second meeting a meaningful trust decision.
- Mira, Lucen, and Mara were expanded to give affected civilians, the future government, and the airship plot distinct voices.
- “Cid” became Mara’s workshop nickname, **Cinder**, as a respectful nod rather than importing a character from another property.
- The main-island chapter, airship interlude, final island, and Veyran resolution were newly authored because the source leaves them blank.
- The seven-crystal eclipse rules are preserved exactly: crystals must leave their circles to be destroyed; a total lunar eclipse weakens them; one active crystal can keep the gate open only by draining its surroundings; all seven are required to reopen the gate near eclipse.
- No historical or real-world factual claims are made; the setting is wholly fictional.
