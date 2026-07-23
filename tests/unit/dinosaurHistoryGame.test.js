const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gameRoot = path.join(process.cwd(), 'games', 'dinosaur-history');
const imageRoot = path.join(gameRoot, 'assets', 'images');
const audioRoot = path.join(gameRoot, 'assets', 'audio');

function loadExperienceData() {
  const source = fs.readFileSync(path.join(gameRoot, 'js', 'story.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.DINO_HISTORY;
}

describe('The history of the dinosaurs journey', () => {
  test('has a bilingual, themed and accessible standalone shell', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>The history of the dinosaurs</title>');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('assets/images/deep-time-gateway.webp');
    expect(html).toContain('rel="preload" href="assets/images/deep-time-gateway.webp"');
    expect(html).toContain('id="introLanguageEnglish"');
    expect(html).toContain('id="introLanguageJapanese"');
    expect(html).toContain('id="languageButton"');
    expect(html).toContain('id="panelButton"');
    expect(html).toContain('id="captionButton"');
    expect(html).toContain('id="soundButton"');
    expect(html).toContain('id="replayNarrationButton"');
    expect(html).toContain('id="infoDialog"');
    expect(html).toContain('class="skip-link" href="#storyCard"');
    expect(html).not.toContain('id="introOverlay" role="dialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('English');
    expect(html).toContain('日本語');
  });

  test('provides nine chapters, three light discoveries and a finale', () => {
    const { scenes, sources } = loadExperienceData();
    const kinds = scenes.map((scene) => scene.kind);
    const sourceIds = new Set(sources.map((source) => source.id));

    expect(scenes).toHaveLength(13);
    expect(kinds.filter((kind) => kind === 'story')).toHaveLength(9);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'finale')).toHaveLength(1);
    expect(new Set(scenes.map((scene) => scene.image)).size).toBe(10);
    expect(new Set(scenes.map((scene) => scene.audio)).size).toBe(scenes.length);

    scenes.forEach((scene) => {
      expect(scene.id).toMatch(/^[a-z0-9-]+$/);
      expect(scene.focal.x).toBeGreaterThanOrEqual(0);
      expect(scene.focal.x).toBeLessThanOrEqual(100);
      expect(scene.focal.y).toBeGreaterThanOrEqual(0);
      expect(scene.focal.y).toBeLessThanOrEqual(100);
      expect(scene.sources.length).toBeGreaterThan(0);
      scene.sources.forEach((sourceId) => expect(sourceIds.has(sourceId)).toBe(true));

      ['en', 'ja'].forEach((language) => {
        const copy = scene.copy[language];
        expect(copy.title.length).toBeGreaterThan(4);
        expect(copy.lede.length).toBeGreaterThan(20);
        expect(copy.artAlt.length).toBeGreaterThan(20);
        expect(copy.term.name.length).toBeGreaterThan(1);
      });
    });

    scenes.filter((scene) => scene.kind === 'quiz').forEach((quiz) => {
      ['en', 'ja'].forEach((language) => {
        const copy = quiz.copy[language];
        expect(copy.options).toHaveLength(3);
        expect(copy.answer).toBeGreaterThanOrEqual(0);
        expect(copy.answer).toBeLessThan(copy.options.length);
        expect(copy.explanation.length).toBeGreaterThan(40);
      });
      expect(quiz.copy.en.answer).toBe(quiz.copy.ja.answer);
    });
  });

  test('ships every referenced image, transcript, MP3 and WAV master', () => {
    const { scenes } = loadExperienceData();

    new Set(scenes.map((scene) => scene.image)).forEach((image) => {
      const imagePath = path.join(gameRoot, image);
      expect(fs.statSync(imagePath).size).toBeGreaterThan(50_000);
      expect(fs.readFileSync(imagePath, { encoding: null }).subarray(0, 4).toString('ascii')).toBe('RIFF');
    });

    scenes.forEach((scene) => {
      ['en', 'ja'].forEach((language) => {
        const transcriptPath = path.join(audioRoot, language, `${scene.audio}.txt`);
        const mp3Path = path.join(audioRoot, language, `${scene.audio}.mp3`);
        const wavPath = path.join(audioRoot, language, 'source-wav', `${scene.audio}.wav`);

        expect(fs.readFileSync(transcriptPath, 'utf8').trim().length).toBeGreaterThan(100);
        expect(fs.statSync(mp3Path).size).toBeGreaterThan(50_000);
        expect(fs.statSync(wavPath).size).toBeGreaterThan(100_000);
      });
    });

    expect(fs.existsSync(path.join(imageRoot, 'GENERATED-ASSETS.md'))).toBe(true);
    expect(fs.existsSync(path.join(audioRoot, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(gameRoot, 'SOURCES.md'))).toBe(true);
  });

  test('implements quiz-forced panel visibility and restores the saved preference', () => {
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(script).toContain("safeStorageGet('dinosaurHistoryPanel')");
    expect(script).toContain("safeStorageSet('dinosaurHistoryPanel'");
    expect(script).toContain("const quizRequiresPanel = scene.kind === 'quiz'");
    expect(script).toContain('const visible = quizRequiresPanel || state.panelPreferred');
    expect(script).toContain('dom.panelButton.disabled = quizRequiresPanel');
    expect(script).toContain("dom.storyCard.setAttribute('aria-hidden', String(!visible))");
    expect(script).toContain('dom.storyCard.inert = !visible');
    expect(script).toContain('focusWasInsidePanel');
    expect(script).toContain('dom.panelButton.focus({ preventScroll: true })');
    expect(script).toContain('quizOverride');
    expect(script).toContain("announce(t('quizRequiredAnnouncement'))");
    expect(styles).toContain('.experience[data-panel="hidden"] .story-card');
    expect(styles).toContain('.experience[data-panel="hidden"][data-phase="story"] .scene-wash');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-vignette');
  });

  test('supports narration, captions, keyboard controls and reduced motion', () => {
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(script).toContain('assets/audio/${state.language}/${scene.audio}.mp3');
    expect(script).toContain('assets/audio/${language}/${scene.audio}.txt');
    expect(script).toContain("this.audio.addEventListener('timeupdate'");
    expect(script).toContain("this.audio.addEventListener('error'");
    expect(script).toContain("event.key === 'ArrowRight'");
    expect(script).toContain("event.key === 'ArrowLeft'");
    expect(script).toContain("key === 'r'");
    expect(script).toContain("key === 'c'");
    expect(script).toContain("key === 'm'");
    expect(script).toContain("key === 'p'");
    expect(script).toContain("key === 'l'");
    expect(script).toContain('chooseQuizByKeyboard(event.key)');
    expect(script).toContain("document.addEventListener('visibilitychange'");
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('--brand: #ff6a1f');
    expect(styles).toContain('--accent: #ffc247');
    expect(styles).toContain('env(safe-area-inset-bottom)');
  });

  test('keeps localization keys, scene structure and language switching complete', () => {
    const data = loadExperienceData();
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const htmlKeys = [
      ...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g),
    ].map((match) => match[1]);
    const scriptKeys = [
      ...script.matchAll(/\bt\('([^']+)'/g),
    ].map((match) => match[1]);

    expect(Object.keys(data.ui.en).sort()).toEqual(Object.keys(data.ui.ja).sort());
    [...new Set([...htmlKeys, ...scriptKeys])].forEach((key) => {
      expect(data.ui.en).toHaveProperty(key);
      expect(data.ui.ja).toHaveProperty(key);
      expect(data.ui.en[key].length).toBeGreaterThan(0);
      expect(data.ui.ja[key].length).toBeGreaterThan(0);
    });

    data.scenes.forEach((scene) => {
      expect(Object.keys(scene.copy.en).sort()).toEqual(Object.keys(scene.copy.ja).sort());
    });

    expect(script).toContain('function applyLanguage(language');
    expect(script).toContain('document.documentElement.lang = state.language');
    expect(script).toContain("safeStorageSet('dinosaurHistoryLanguage'");
    expect(script).toContain('const cacheKey = `${language}:${scene.audio}`');
    expect(script).toContain('answers: new Map()');
    expect(script).not.toContain('state.answers.clear();\n    state.language');
    expect(script).toContain('state.index');
  });
});
