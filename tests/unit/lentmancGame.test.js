'use strict';

const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../..');
const gameRoot = path.join(repositoryRoot, 'games/lentmanc_game');
const readGameFile = (relativePath) => fs.readFileSync(path.join(gameRoot, relativePath), 'utf8');
const characters = require(path.join(gameRoot, 'js/characters'));
const mapData = require(path.join(gameRoot, 'js/maps'));
const story = require(path.join(gameRoot, 'js/story'));
const audioManifest = require(path.join(gameRoot, 'assets/audio/en/audio-manifest.json'));

function collectValues(value, predicate, results = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectValues(entry, predicate, results));
  } else if (value && typeof value === 'object') {
    if (predicate(value)) results.push(value);
    Object.values(value).forEach((entry) => collectValues(entry, predicate, results));
  }
  return results;
}

function getMapItems(map) {
  return [...map.npcs, ...map.interactions];
}

function reachableTiles(map, spawn) {
  const width = map.tiles[0].length;
  const queue = [[Math.floor(spawn.x), Math.floor(spawn.y)]];
  const visited = new Set();

  while (queue.length) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    if (
      visited.has(key)
      || x < 0
      || y < 0
      || y >= map.tiles.length
      || x >= width
      || mapData.legend[map.tiles[y][x]].solid
    ) {
      continue;
    }

    visited.add(key);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return visited;
}

function itemCanBeReached(item, reachable) {
  return [
    [item.x, item.y],
    [item.x + 1, item.y],
    [item.x - 1, item.y],
    [item.x, item.y + 1],
    [item.x, item.y - 1],
  ].some(([x, y]) => reachable.has(`${x},${y}`));
}

function getSceneTargets(scene) {
  const targets = [];
  scene.steps.forEach((step) => {
    if (step.type === 'choice') {
      step.options.forEach((option) => {
        if (option.next) targets.push(option.next);
      });
    }
  });
  if (scene.onComplete?.next) targets.push(scene.onComplete.next);
  return targets;
}

function getStructurallyReachableScenes() {
  const reached = new Set();
  const visited = new Set();
  const queue = [{ sceneId: story.initialScene, mapId: 'birchwood' }];

  while (queue.length) {
    const { sceneId, mapId } = queue.shift();
    const visitKey = `${sceneId}@${mapId}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    reached.add(sceneId);

    const scene = story.scenes[sceneId];
    const choiceSteps = scene.steps.filter((step) => step.type === 'choice');
    const choiceTargets = choiceSteps.flatMap((step) => (
      step.options.filter((option) => option.next).map((option) => option.next)
    ));
    choiceTargets.forEach((target) => queue.push({ sceneId: target, mapId }));

    const canCompleteNormally = choiceSteps.length === 0
      || choiceSteps.some((step) => step.options.some((option) => !option.next));
    if (!canCompleteNormally || scene.kind === 'gameover' || scene.kind === 'ending') continue;

    const destinationMap = scene.onComplete?.travel?.mapId || mapId;
    if (scene.onComplete?.next) {
      queue.push({ sceneId: scene.onComplete.next, mapId: destinationMap });
      continue;
    }

    getMapItems(mapData.maps[destinationMap]).forEach((item) => {
      queue.push({ sceneId: item.sceneId, mapId: destinationMap });
      if (item.repeatSceneId) queue.push({ sceneId: item.repeatSceneId, mapId: destinationMap });
    });
  }

  return reached;
}

describe('The great adventure standalone RPG', () => {
  const html = readGameFile('index.html');
  const css = readGameFile('css/styles.css');
  const gameSource = readGameFile('js/game.js');
  const audioSource = readGameFile('js/audio.js');

  test('provides the complete accessible standalone shell and control surfaces', () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<link rel="stylesheet" href="/css/color-theme.css">');
    [
      'titleScreen',
      'newGameButton',
      'continueButton',
      'settingsButton',
      'helpButton',
      'creditsButton',
      'gameScreen',
      'worldCanvas',
      'sceneOverlay',
      'dialogueCard',
      'choiceRegion',
      'pauseDialog',
      'gameOverOverlay',
      'retryCheckpointButton',
      'endingOverlay',
      'endingTitleButton',
      'endingReplayButton',
      'transcriptDialog',
      'voiceCaption',
    ].forEach((id) => expect(html).toContain(`id="${id}"`));

    expect(html).toMatch(/role="dialog"[\s\S]*aria-modal="true"/);
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('aria-label="Top-down view of Birchwood.');
    expect(html).toMatch(/<canvas[^>]+id="worldCanvas"[^>]+tabindex="0"/);
    expect(html).toContain('data-direction="up"');
    expect(html).toContain('data-direction="down"');
    expect(html).toContain('data-direction="left"');
    expect(html).toContain('data-direction="right"');
    expect(html).toContain('id="touchInteractButton"');
  });

  test('implements keyboard, touch, captions, settings, reduced motion, and safe areas', () => {
    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w:', 'a:', 's:', 'd:']
      .forEach((control) => expect(gameSource).toContain(control));
    expect(gameSource).toContain("event.key === 'Enter'");
    expect(gameSource).toContain("event.key === ' '");
    expect(gameSource).toContain("event.key === 'e'");
    expect(gameSource).toContain("event.key === 'Escape'");
    expect(gameSource).toContain('/^[1-4]$/');
    expect(gameSource).toContain("button.addEventListener('pointerdown'");
    expect(gameSource).toContain("button.addEventListener('pointerup'");
    expect(gameSource).toContain('dom.gameScreen.inert = true');
    expect(gameSource).toContain('dom.gameScreen.inert = false');
    expect(gameSource).toContain("`Loading ${scene.title || 'the next scene'}…`");
    expect(html).toContain('Mute voice');
    expect(html).toContain('Play voices automatically');
    expect(html).toContain('Text reveal');
    expect(html).toContain('High-contrast dialogue');
    expect(html).toContain('Reduce motion');
    expect(html).toContain('Decorative animation');
    expect(css).toContain('env(safe-area-inset-top');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toContain('@media (max-height: 560px) and (orientation: landscape)');
    expect(css).toMatch(/:focus-visible/);
  });

  test('loads the intended story, locations, encounters, and three endings', () => {
    expect(story.meta).toMatchObject({
      id: 'the-great-adventure',
      title: 'The great adventure',
      language: 'en',
      dimensions: { d1: 'Asterra', d2: 'Veyra' },
      continent: 'the Hand',
      crystalCount: 7,
    });
    expect(mapData.mapOrder).toEqual([
      'birchwood',
      'willowmere',
      'greenwake',
      'ashfinger',
      'cinder_thumb',
      'crown_city',
      'frostcrown',
    ]);
    expect(story.encounters).toEqual([
      'ridge_smoke',
      'ashfinger_encounter',
      'cinder_standoff',
      'workshop_escape',
      'frostcrown_final',
    ]);
    story.encounters.forEach((id) => expect(story.scenes[id].kind).toBe('encounter'));
    expect(Object.keys(story.endings)).toEqual([
      'severed_dawn',
      'crown_of_ash',
      'open_sky',
    ]);
    expect(Object.values(story.endings).map((ending) => ending.number).sort()).toEqual([1, 2, 3]);
  });

  test('keeps all scene, choice, speaker, travel, and ending references valid', () => {
    const allowedStepTypes = new Set(['narration', 'line', 'effect', 'choice', 'gameover', 'ending']);

    Object.entries(story.scenes).forEach(([sceneId, scene]) => {
      expect(scene.id).toBe(sceneId);
      expect(scene.steps.length).toBeGreaterThan(0);
      scene.steps.forEach((step) => {
        expect(allowedStepTypes.has(step.type)).toBe(true);
        if (step.speaker) expect(characters[step.speaker]).toBeDefined();
        if (step.type === 'choice') {
          expect(step.options.length).toBeGreaterThanOrEqual(2);
          expect(step.options.length).toBeLessThanOrEqual(4);
          step.options.forEach((option) => {
            expect(option.text).toEqual(expect.any(String));
            expect(option.hint).toEqual(expect.any(String));
            if (option.next) expect(story.scenes[option.next]).toBeDefined();
          });
        }
        if (step.type === 'ending') expect(story.endings[step.endingId]).toBeDefined();
      });

      getSceneTargets(scene).forEach((target) => expect(story.scenes[target]).toBeDefined());
      if (scene.onComplete?.travel) {
        const { mapId, spawnId } = scene.onComplete.travel;
        expect(mapData.maps[mapId]).toBeDefined();
        expect(mapData.maps[mapId].spawns.some((spawn) => spawn.id === spawnId)).toBe(true);
      }
    });
  });

  test('uses maintainable valid maps with reachable spawns and interaction points', () => {
    expect(mapData.tileSize).toBe(48);

    Object.entries(mapData.maps).forEach(([mapId, map]) => {
      expect(map.id).toBe(mapId);
      expect(map.tiles.length).toBeGreaterThan(4);
      const width = map.tiles[0].length;
      expect(width).toBeGreaterThan(4);
      map.tiles.forEach((row) => {
        expect(row).toHaveLength(width);
        [...row].forEach((symbol) => expect(mapData.legend[symbol]).toBeDefined());
      });

      map.spawns.forEach((spawn) => {
        const x = Math.floor(spawn.x);
        const y = Math.floor(spawn.y);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(width);
        expect(y).toBeLessThan(map.tiles.length);
        expect(mapData.legend[map.tiles[y][x]].solid).toBe(false);

        const reachable = reachableTiles(map, spawn);
        getMapItems(map).forEach((item) => {
          expect({
            map: mapId,
            spawn: spawn.id,
            interaction: item.id,
            reachable: itemCanBeReached(item, reachable),
          }).toMatchObject({ reachable: true });
        });
      });

      getMapItems(map).forEach((item) => {
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.y).toBeGreaterThanOrEqual(0);
        expect(item.x).toBeLessThan(width);
        expect(item.y).toBeLessThan(map.tiles.length);
        expect(story.scenes[item.sceneId]).toBeDefined();
        if (item.repeatSceneId) expect(story.scenes[item.repeatSceneId]).toBeDefined();
        if (item.characterId) expect(characters[item.characterId]).toBeDefined();
      });
    });
  });

  test('defines every condition flag through initial state or a story effect', () => {
    const definedFlags = new Set([
      'mushroomsGathered',
      'truthScore',
      'bramTrust',
      'caelTrust',
      'miraTrust',
    ]);
    collectValues(story.scenes, (value) => (
      ['set', 'increment'].includes(value.type) && typeof value.key === 'string'
    )).forEach((effect) => definedFlags.add(effect.key));

    const conditions = [];
    Object.values(mapData.maps).forEach((map) => {
      getMapItems(map).forEach((item) => {
        if (item.when) conditions.push(item.when);
        if (item.requires) conditions.push(item.requires);
      });
    });
    Object.values(story.scenes).forEach((scene) => {
      scene.steps.forEach((step) => {
        if (step.when) conditions.push(step.when);
        (step.options || []).forEach((option) => {
          if (option.when) conditions.push(option.when);
        });
      });
    });

    const referencedFlags = new Set();
    collectValues(conditions, (value) => Boolean(value.flag || value.counter))
      .forEach((condition) => referencedFlags.add(condition.flag || condition.counter));
    referencedFlags.forEach((flag) => expect(definedFlags.has(flag)).toBe(true));
  });

  test('makes all endings structurally reachable through exploration and scene choices', () => {
    const reachable = getStructurallyReachableScenes();
    expect(reachable.has('ending_severed_dawn')).toBe(true);
    expect(reachable.has('ending_crown_of_ash')).toBe(true);
    expect(reachable.has('ending_open_sky')).toBe(true);

    const decision = story.scenes.frostcrown_decision;
    const targets = decision.steps
      .filter((step) => step.type === 'choice')
      .flatMap((step) => step.options.map((option) => option.next));
    expect(new Set(targets)).toEqual(new Set([
      'ending_severed_dawn',
      'ending_crown_of_ash',
      'ending_open_sky',
    ]));
  });

  test('provides foreshadowed game overs, checkpoints, and retry recovery', () => {
    const checkpointEffects = collectValues(
      story.scenes,
      (value) => value.type === 'checkpoint',
    );
    const completionCheckpoints = Object.values(story.scenes)
      .filter((scene) => Boolean(scene.onComplete?.checkpoint));
    expect(checkpointEffects.length + completionCheckpoints.length).toBeGreaterThanOrEqual(6);

    story.gameOverScenes.forEach((sceneId) => {
      const gameOverScene = story.scenes[sceneId];
      expect(gameOverScene.kind).toBe('gameover');
      const outcome = gameOverScene.steps.find((step) => step.type === 'gameover');
      expect(outcome.reason.length).toBeGreaterThan(40);
      expect(outcome.lesson.length).toBeGreaterThan(40);

      const inboundChoices = collectValues(
        story.scenes,
        (value) => value.next === sceneId && typeof value.text === 'string',
      );
      expect(inboundChoices.length).toBeGreaterThan(0);
      inboundChoices.forEach((choice) => {
        expect(`${choice.text} ${choice.hint}`).toMatch(/reckless|danger|overwhelming|alone|cannot|warning/i);
      });
    });

    expect(gameSource).toContain('function createCheckpoint');
    expect(gameSource).toContain('function retryCheckpoint');
    expect(gameSource).toContain('snapshot.checkpoint = null');
    expect(gameSource).toContain('Returned to checkpoint:');
    expect(html).toContain('Try another choice');
  });

  test('implements versioned local saves, restart, corruption handling, and storage fallback', () => {
    expect(gameSource).toContain("const SAVE_KEY = 'theGreatAdventure.save.v1'");
    expect(gameSource).toContain('const SAVE_VERSION = 1');
    expect(gameSource).toContain('function createStorageAdapter');
    expect(gameSource).toContain('window.localStorage.setItem');
    expect(gameSource).toContain('window.localStorage.getItem');
    expect(gameSource).toContain('window.localStorage.removeItem');
    expect(gameSource).toMatch(/function normalizeSave[\s\S]+candidate\.version !== SAVE_VERSION/);
    expect(gameSource).toContain('A damaged save was ignored.');
    expect(gameSource).toContain('Local storage is unavailable.');
    expect(gameSource).toContain('function continueGame');
    expect(gameSource).toContain('function restartAdventure');
    expect(gameSource).toContain('storage.remove(SAVE_KEY)');
    expect(gameSource).not.toContain('localStorage.clear(');
  });

  test('documents every game character and gives recurring characters full visual rules', () => {
    const bible = readGameFile('docs/CHARACTER-BIBLE.md');
    Object.entries(characters)
      .filter(([id]) => !['narrator', 'system'].includes(id))
      .forEach(([, character]) => expect(bible).toContain(character.name));

    ['Aren Vale', 'Bram Alder', 'Sir Cael Varin', 'Mira Fen', 'Mara “Cinder” Vell', 'King Edric Aurel', 'Queen Elara Aurel', 'Prince Lucen Aurel']
      .forEach((name, index, names) => {
        const start = bible.indexOf(`## ${name}`);
        const nextStarts = names
          .slice(index + 1)
          .map((nextName) => bible.indexOf(`## ${nextName}`))
          .filter((position) => position > start);
        const end = nextStarts.length ? Math.min(...nextStarts) : bible.indexOf('## One-scene figures');
        const section = bible.slice(start, end);
        [
          '**Identity:**',
          '**Personality',
          '**Speaking style:**',
          '**Build:**',
          '**Face:**',
          '**Hair:**',
          '**Clothing:**',
          '**Props:**',
          '**Posture',
          '**Portrait framing:**',
          '**Sprite silhouette:**',
          '**Invariants:**',
          '**Allowed changes:**',
          '**Expression set:**',
          '**Reusable generation description:**',
          '**Negative constraints:**',
        ].forEach((field) => expect(section).toContain(field));
      });
  });

  test('keeps all runtime image references local, present, and non-empty', () => {
    const referencedImages = new Set([
      ...story.assets.initial,
      ...story.assets.deferred,
      ...Object.values(story.scenes).map((scene) => scene.image).filter(Boolean),
      ...Object.values(story.endings).map((ending) => ending.image),
      ...Object.values(characters).map((character) => character.portrait).filter(Boolean),
    ]);

    const cssImageMatches = [...css.matchAll(/url\\(['"]?([^'")]+\\.(?:webp|png))['"]?\\)/g)];
    cssImageMatches.forEach((match) => {
      const absolute = path.resolve(gameRoot, 'css', match[1]);
      expect(fs.existsSync(absolute)).toBe(true);
      expect(fs.statSync(absolute).size).toBeGreaterThan(1000);
    });

    referencedImages.forEach((relativePath) => {
      expect(relativePath).not.toMatch(/^https?:/);
      const absolute = path.join(gameRoot, relativePath);
      expect(fs.existsSync(absolute)).toBe(true);
      expect(fs.statSync(absolute).size).toBeGreaterThan(1000);
    });

    const imageManifest = readGameFile('assets/images/GENERATED-ASSETS.md');
    const imageDirectories = [
      'assets/images/characters',
      'assets/images/portraits',
      'assets/images/environments',
      'assets/images/scenes',
    ];
    imageDirectories.forEach((directory) => {
      fs.readdirSync(path.join(gameRoot, directory)).forEach((filename) => {
        const file = path.join(gameRoot, directory, filename);
        expect(fs.statSync(file).size).toBeGreaterThan(1000);
        expect(imageManifest).toContain(filename);
      });
    });
  });

  test('aligns every spoken story line with a local transcript, WAV, and MP3', () => {
    const voicedSteps = collectValues(
      story.scenes,
      (value) => typeof value.audio === 'string' && typeof value.text === 'string',
    );
    const stepsByAudioId = new Map(voicedSteps.map((step) => [step.audio, step]));
    const clipsById = new Map(audioManifest.clips.map((clip) => [clip.id, clip]));

    expect(audioManifest.language).toBe('en');
    expect(audioManifest.clips).toHaveLength(16);
    expect(new Set(clipsById.keys())).toEqual(new Set(stepsByAudioId.keys()));
    expect(new Set(audioManifest.clips.map((clip) => clip.speakerId))).toEqual(new Set(['narrator', 'aren']));
    expect(Object.entries(characters).filter(([, character]) => character.voice).map(([id]) => id).sort())
      .toEqual(['aren', 'narrator']);

    audioManifest.clips.forEach((clip) => {
      const step = stepsByAudioId.get(clip.id);
      expect(clip.text).toBe(step.text);
      expect(clip.speakerId).toBe(step.type === 'narration' ? 'narrator' : step.speaker);
      expect(clip.durationSeconds).toBeGreaterThan(1);
      ['transcript', 'wav', 'mp3'].forEach((field) => {
        expect(clip[field]).not.toMatch(/^https?:/);
        const absolute = path.join(gameRoot, clip[field]);
        expect(fs.existsSync(absolute)).toBe(true);
        expect(fs.statSync(absolute).size).toBeGreaterThan(20);
      });
      expect(readGameFile(clip.transcript).trim()).toBe(clip.text);
    });

    expect(audioSource).toContain("preload = 'metadata'");
    expect(audioSource).toContain('Automatic voice playback was blocked or unavailable.');
    expect(audioSource).toContain('The complete caption remains available.');
  });

  test('contains no third-party runtime asset URLs and registers the requested route', () => {
    const runtimeFiles = [
      'index.html',
      'css/styles.css',
      'js/characters.js',
      'js/maps.js',
      'js/story.js',
      'js/audio.js',
      'js/game.js',
      'assets/audio/en/audio-manifest.json',
    ];
    runtimeFiles.forEach((file) => expect(readGameFile(file)).not.toMatch(/https?:\/\//i));

    const appSource = fs.readFileSync(path.join(repositoryRoot, 'app.js'), 'utf8');
    expect(appSource).toContain("if (gameFolder === 'lentmanc_game')");
    expect(appSource).toContain('app.use(`/games/${gameFolder}`');
    expect(appSource).toContain("? 'The great adventure'");
    expect(appSource).toContain('? `/games/${encodeURIComponent(entry.name)}/`');
  });
});
