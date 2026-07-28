const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gameRoot = path.join(process.cwd(), 'games', 'deep_ocean');
const imageRoot = path.join(gameRoot, 'assets', 'images');
const audioRoot = path.join(gameRoot, 'assets', 'audio');

function loadStory() {
  const source = fs.readFileSync(path.join(gameRoot, 'js', 'story.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.DEEP_OCEAN_STORY;
}

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

describe('Deep sea journey', () => {
  test('has a bilingual, themed, accessible standalone shell with essential controls', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const preloadMatches = html.match(/rel="preload"/g) || [];

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Deep sea journey</title>');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('Choose your language');
    expect(html).toContain('data-language="en"');
    expect(html).toContain('data-language="ja"');
    expect(html).toContain('id="panelButton"');
    expect(html).toContain('id="captionButton"');
    expect(html).toContain('id="soundButton"');
    expect(html).toContain('id="infoButton"');
    expect(html).toContain('id="infoDialog"');
    expect(html).toContain('id="journeyNav"');
    expect(html).toContain('id="narrationAudio"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<noscript>');
    expect(preloadMatches).toHaveLength(1);
    expect(html).toContain('rel="preload" href="assets/images/estuary-dawn.webp"');
  });

  test('provides eight story chapters, three discoveries, and a finale', () => {
    const story = loadStory();
    const { scenes } = story;
    const kinds = scenes.map((scene) => scene.kind);

    expect(story.meta.title).toBe('Deep sea journey');
    expect(story.meta.chapters).toBe(8);
    expect(story.meta.quizzes).toBe(3);
    expect(story.meta.duration).toBe('10–15');
    expect(scenes).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'story')).toHaveLength(8);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'finale')).toHaveLength(1);
    expect(new Set(scenes.map((scene) => scene.image)).size).toBe(8);
    expect(new Set(scenes.map((scene) => scene.audio)).size).toBe(scenes.length);
    expect(scenes[0].depth).toBe(2);
    expect(Math.max(...scenes.map((scene) => scene.depth))).toBe(10_935);
    expect(scenes.at(-1).kind).toBe('finale');

    scenes.filter((scene) => scene.kind === 'quiz').forEach((quiz) => {
      ['en', 'ja'].forEach((language) => {
        expect(quiz.copy[language].options).toHaveLength(3);
        expect(quiz.copy[language].question.length).toBeGreaterThan(8);
        expect(quiz.copy[language].explanation.length).toBeGreaterThan(35);
      });
      expect(quiz.answer).toBeGreaterThanOrEqual(0);
      expect(quiz.answer).toBeLessThan(3);
    });
  });

  test('fully localizes story data, help, source notes, and language switching', () => {
    const story = loadStory();
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const setLanguageSource = script.slice(
      script.indexOf('function setLanguage'),
      script.indexOf('function startExperience'),
    );

    expect(Object.keys(story.ui.en).sort()).toEqual(Object.keys(story.ui.ja).sort());
    expect(story.sources.length).toBeGreaterThanOrEqual(15);
    story.sources.forEach((source) => {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.title.en.length).toBeGreaterThan(8);
      expect(source.title.ja.length).toBeGreaterThan(8);
    });

    story.scenes.forEach((scene) => {
      expect(scene.copy.en.title.length).toBeGreaterThan(5);
      expect(scene.copy.ja.title.length).toBeGreaterThan(5);
      expect(scene.copy.en.lede.length).toBeGreaterThan(20);
      expect(scene.copy.ja.lede.length).toBeGreaterThan(15);
      expect(scene.term.pronunciation.en.length).toBeGreaterThan(2);
      expect(scene.term.pronunciation.ja.length).toBeGreaterThan(2);
      expect(scene.term.meaning.en.length).toBeGreaterThan(5);
      expect(scene.term.meaning.ja.length).toBeGreaterThan(5);
    });

    expect(script).toContain("safeStorageSet('deepOceanLanguage', language)");
    expect(script).toContain('document.documentElement.lang = languageUi.documentLanguage');
    expect(script).toContain('setScene(state.index');
    expect(script).toContain('assets/audio/${state.language}/${scene.audio}.mp3');
    expect(setLanguageSource).toContain('setScene(state.index');
    expect(setLanguageSource).not.toContain('state.answers.clear');
  });

  test('ships every referenced image, exact transcript, MP3, and WAV master in both languages', () => {
    const { scenes } = loadStory();

    expect(fs.readdirSync(imageRoot).filter((name) => name.endsWith('.webp'))).toHaveLength(8);

    ['en', 'ja'].forEach((language) => {
      const languageRoot = path.join(audioRoot, language);
      const wavRoot = path.join(languageRoot, 'source-wav');

      expect(fs.readdirSync(languageRoot).filter((name) => name.endsWith('.txt'))).toHaveLength(12);
      expect(fs.readdirSync(languageRoot).filter((name) => name.endsWith('.mp3'))).toHaveLength(12);
      expect(fs.readdirSync(wavRoot).filter((name) => name.endsWith('.wav'))).toHaveLength(12);

      scenes.forEach((scene) => {
        const imagePath = path.join(gameRoot, scene.image);
        const transcriptPath = path.join(languageRoot, `${scene.audio}.txt`);
        const mp3Path = path.join(languageRoot, `${scene.audio}.mp3`);
        const wavPath = path.join(wavRoot, `${scene.audio}.wav`);

        expect(fileSize(imagePath)).toBeGreaterThan(50_000);
        expect(fs.readFileSync(transcriptPath, 'utf8').trim().length).toBeGreaterThan(40);
        expect(fileSize(mp3Path)).toBeGreaterThan(100_000);
        expect(fileSize(wavPath)).toBeGreaterThan(500_000);
      });
    });
  });

  test('forces the panel open for discoveries and restores the stored viewer preference', () => {
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(script).toContain("const savedPanel = safeStorageGet('deepOceanPanel')");
    expect(script).toContain("const quizForcesPanel = scene.kind === 'quiz'");
    expect(script).toContain('const visible = quizForcesPanel || state.panelPreferred');
    expect(script).toContain('dom.panelButton.disabled = quizForcesPanel');
    expect(script).toContain("dom.panelButton.setAttribute('aria-pressed', String(visible))");
    expect(script).toContain('dom.storyCard.inert = !visible');
    expect(script).toContain("safeStorageSet('deepOceanPanel'");
    expect(styles).toContain('.experience[data-panel="hidden"] .story-card');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-wash');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-vignette');
  });

  test('implements local narration, independent captions, keyboard controls, asset warming, and reduced motion', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(html).toContain('id="transcriptCard"');
    expect(html).toContain('id="audioProgressTrack"');
    expect(script).toContain('fetch(`assets/audio/${language}/${scene.audio}.txt`');
    expect(script).toContain('this.audio.src = `assets/audio/${state.language}/${scene.audio}.mp3`');
    expect(script).toContain("event.key === 'ArrowRight'");
    expect(script).toContain("event.key === 'ArrowLeft'");
    expect(script).toContain("key === 'r'");
    expect(script).toContain("key === 'c'");
    expect(script).toContain("key === 'm'");
    expect(script).toContain("key === 'p'");
    expect(script).toContain("key === 'l'");
    expect(script).toContain('chooseQuizByKeyboard(event.key)');
    expect(script).toContain('window.requestIdleCallback');
    expect(script).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('html[lang="ja"]');
  });
});
