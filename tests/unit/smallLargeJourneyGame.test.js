const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');

const repositoryRoot = process.cwd();
const gameRoot = path.join(repositoryRoot, 'games', 'small_large');
const imageRoot = path.join(gameRoot, 'assets', 'images');
const audioRoot = path.join(gameRoot, 'assets', 'audio');

function read(relativePath) {
  return fs.readFileSync(path.join(gameRoot, relativePath), 'utf8');
}

function loadStory() {
  const source = read('js/story.js');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.SCALE_STORY;
}

describe('THE LONG ZOOM bilingual scale journey', () => {
  test('ships an accessible standalone shell with a clear bilingual opening and essential controls', () => {
    const html = read('index.html');

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('THE LONG ZOOM · From Quarks to Galaxies');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('rel="preload" href="assets/images/09-human.webp"');
    expect((html.match(/rel="preload"/g) || [])).toHaveLength(1);
    expect(html).toContain('id="introLanguageSwitch"');
    expect(html).toContain('id="topLanguageSwitch"');
    expect(html).toContain('data-language="en"');
    expect(html).toContain('data-language="ja"');
    expect(html).toContain('id="panelButton"');
    expect(html).toContain('id="captionButton"');
    expect(html).toContain('id="soundButton"');
    expect(html).toContain('id="replayNarrationButton"');
    expect(html).toContain('id="infoDialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<main class="story-layout">');
    expect(html).toContain('<nav class="journey-nav"');
    expect(html).toContain('<audio id="narrationAudio"');
  });

  test('provides 18 ordered scale topics, three embedded quizzes, and a reflective finale', () => {
    const story = loadStory();
    const scenes = Array.from(story.scenes);
    const kinds = scenes.map((scene) => scene.kind);

    expect(story.meta.sceneCount).toBe(19);
    expect(scenes).toHaveLength(19);
    expect(kinds.filter((kind) => kind === 'story')).toHaveLength(15);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'finale')).toHaveLength(1);
    expect(new Set(scenes.map((scene) => scene.image)).size).toBe(18);
    expect(scenes[0].id).toBe('quantum-edge');
    expect(scenes[17].id).toBe('ic-1101');
    expect(scenes[18].id).toBe('finale');
    expect(scenes[0].order).toBeLessThan(-19);
    expect(scenes[17].order).toBeGreaterThan(22);
    expect(story.sources.length).toBeGreaterThanOrEqual(15);

    scenes.forEach((scene) => {
      expect(scene.image).toMatch(/^assets\/images\/[\w-]+\.webp$/);
      expect(typeof scene.order).toBe('number');
      expect(scene.scale.length).toBeGreaterThan(2);
      for (const language of ['en', 'ja']) {
        const localized = scene[language];
        expect(localized.title.length).toBeGreaterThan(5);
        expect(localized.lede.length).toBeGreaterThan(20);
        expect(Array.from(localized.facts)).toHaveLength(3);
        expect(Array.from(localized.term)).toHaveLength(3);
        expect(localized.narration.length).toBeGreaterThan(200);
      }
    });

    scenes.filter((scene) => scene.kind === 'quiz').forEach((scene) => {
      for (const language of ['en', 'ja']) {
        const quiz = scene[language].quiz;
        expect(Array.from(quiz.options)).toHaveLength(3);
        expect(quiz.answer).toBeGreaterThanOrEqual(0);
        expect(quiz.answer).toBeLessThan(quiz.options.length);
        expect(quiz.explanation.length).toBeGreaterThan(30);
      }
    });
  });

  test('ships every generated image at 1600 by 900 pixels', async () => {
    const story = loadStory();
    const imageNames = [...new Set(Array.from(story.scenes, (scene) => path.basename(scene.image)))];

    expect(imageNames).toHaveLength(18);
    for (const imageName of imageNames) {
      const imagePath = path.join(imageRoot, imageName);
      expect(fs.statSync(imagePath).size).toBeGreaterThan(30_000);
      const metadata = await sharp(imagePath).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(900);
    }

    const manifest = read('assets/images/GENERATED-ASSETS.md');
    imageNames.forEach((imageName) => expect(manifest).toContain(`\`${imageName}\``));
    expect(manifest).toContain('built-in image-generation tool');
    expect(manifest).toContain('Caveat:');
  });

  test('has exact bilingual transcript coverage plus non-empty MP3 and WAV assets for every scene', () => {
    const story = loadStory();

    for (const scene of Array.from(story.scenes)) {
      for (const language of ['en', 'ja']) {
        const languageRoot = path.join(audioRoot, language);
        const transcriptPath = path.join(languageRoot, `${scene.id}.txt`);
        const mp3Path = path.join(languageRoot, `${scene.id}.mp3`);
        const wavPath = path.join(languageRoot, 'source-wav', `${scene.id}.wav`);
        const transcript = fs.readFileSync(transcriptPath, 'utf8').trim();

        expect(transcript).toBe(scene[language].narration);
        expect(fs.statSync(transcriptPath).size).toBeGreaterThan(200);
        expect(fs.statSync(mp3Path).size).toBeGreaterThan(100_000);
        expect(fs.statSync(wavPath).size).toBeGreaterThan(1_000_000);
      }
    }

    expect(fs.readdirSync(path.join(audioRoot, 'en')).filter((name) => name.endsWith('.mp3'))).toHaveLength(19);
    expect(fs.readdirSync(path.join(audioRoot, 'ja')).filter((name) => name.endsWith('.mp3'))).toHaveLength(19);
    expect(read('assets/audio/README.md')).toContain('libmp3lame -q:a 2');
  });

  test('implements localized replacement, narration, captions, panel mode, quizzes, and keyboard access', () => {
    const script = read('js/app.js');

    expect(script).toContain("safeStorageGet('smallLargeLanguage')");
    expect(script).toContain("safeStorageSet('smallLargeLanguage', language)");
    expect(script).toContain('document.documentElement.lang = state.language');
    expect(script).toContain('state.answers.set(scene.id, answer)');
    expect(script).toContain('const quizNeedsPanel = scene.kind === \'quiz\'');
    expect(script).toContain("dom.experience.dataset.panel = visible ? 'visible' : 'hidden'");
    expect(script).toContain("dom.panelButton.setAttribute('aria-pressed', String(state.panelVisible))");
    expect(script).toContain('`${meta.audioBase}/${state.language}/${scene.id}.mp3`');
    expect(script).toContain('`${meta.audioBase}/${language}/${scene.id}.txt`');
    expect(script).toContain('dom.transcriptText.textContent = fallback');
    expect(script).toContain("event.key === 'ArrowRight'");
    expect(script).toContain("event.key === 'ArrowLeft'");
    expect(script).toContain("key === 'r'");
    expect(script).toContain("key === 'c'");
    expect(script).toContain("key === 'm'");
    expect(script).toContain("key === 'p'");
    expect(script).toContain("key === 'l'");
    expect(script).toContain("key === 'i'");
    expect(script).toContain("['1', '2', '3']");
    expect(script).toContain("requestIdleCallback");
    expect(script).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  test('styles artwork-only mode, responsive layouts, safe areas, focus, and reduced motion', () => {
    const styles = read('css/styles.css');

    expect(styles).toContain('.experience[data-panel="hidden"] .story-card');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-wash');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-image');
    expect(styles).toContain('@media (max-width: 760px)');
    expect(styles).toContain('@media (max-height: 650px) and (min-width: 700px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('outline: 3px solid var(--focus');
    expect(styles).toContain('background: var(--brand');
    expect(styles).toContain('color: var(--accent');
    expect(styles).toContain('line-break: strict');
  });

  test('documents the modular insertion workflow, controls, voice choices, and route', () => {
    const readme = read('README.md');

    expect(readme).toContain('serves it at `/small_large/`');
    expect(readme).toContain('## Adding another scale waypoint');
    expect(readme).toContain('`P`');
    expect(readme).toContain('`L`');
    expect(readme).toContain('en_US-lessac-medium');
    expect(readme).toContain('ja_shikoku_metan_normal');
    expect(readme).toContain('Do not use `npm start`');
  });
});
