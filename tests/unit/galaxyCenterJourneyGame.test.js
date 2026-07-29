const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gameRoot = path.join(process.cwd(), 'games', 'galaxy_center');
const imageRoot = path.join(gameRoot, 'assets', 'images');
const audioRoot = path.join(gameRoot, 'assets', 'audio');
const wavRoot = path.join(audioRoot, 'source-wav');

function loadStory() {
  const source = fs.readFileSync(path.join(gameRoot, 'js', 'story.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.GALAXY_CENTER_STORY;
}

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

describe('Journey to the center of our galaxy', () => {
  test('has an English, themed, accessible standalone shell with essential controls', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const preloadMatches = html.match(/rel="preload"/g) || [];

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Journey to the center of our galaxy</title>');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('rel="preload"');
    expect(html).toContain('assets/images/01-orion-spur-departure.webp');
    expect(preloadMatches).toHaveLength(1);
    expect(html).toContain('id="panelButton"');
    expect(html).toContain('aria-controls="storyCard"');
    expect(html).toContain('id="captionButton"');
    expect(html).toContain('aria-controls="transcriptCard"');
    expect(html).toContain('id="soundButton"');
    expect(html).toContain('id="replayNarrationButton"');
    expect(html).toContain('id="audioProgressTrack"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('id="infoDialog"');
    expect(html).toContain('id="journeyNav"');
    expect(html).toContain('id="narrationAudio"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<noscript>');
    expect(html).not.toMatch(/(?:src|href)="https?:\/\/[^"]+"/);
  });

  test('provides eight chapters, three narrative discoveries, and a finale', () => {
    const story = loadStory();
    const kinds = story.scenes.map((scene) => scene.kind);

    expect(story.meta.title).toBe('Journey to the center of our galaxy');
    expect(story.meta.chapters).toBe(8);
    expect(story.meta.quizzes).toBe(3);
    expect(story.meta.duration).toBe('10–15');
    expect(story.meta.voice).toBe('en_US-lessac-medium');
    expect(story.scenes).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'story')).toHaveLength(8);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'finale')).toHaveLength(1);
    expect(new Set(story.scenes.map((scene) => scene.image)).size).toBe(9);
    expect(new Set(story.scenes.map((scene) => scene.audio)).size).toBe(12);
    expect(story.scenes[0].id).toBe('home-orion-spur');
    expect(story.scenes.at(-1).kind).toBe('finale');

    story.scenes.filter((scene) => scene.kind === 'quiz').forEach((quiz) => {
      expect(quiz.copy.options).toHaveLength(3);
      expect(quiz.copy.question.length).toBeGreaterThan(12);
      expect(quiz.copy.answer).toBeGreaterThanOrEqual(0);
      expect(quiz.copy.answer).toBeLessThan(3);
      expect(quiz.copy.explanation.length).toBeGreaterThan(70);
    });
  });

  test('keeps English UI, story data, source notes, and citations outside interaction code', () => {
    const story = loadStory();
    const app = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const research = fs.readFileSync(path.join(gameRoot, 'RESEARCH-NOTES.md'), 'utf8');

    expect(story.ui.documentLanguage).toBe('en');
    expect(story.ui.pageTitle).toBe(story.meta.title);
    expect(Object.keys(story.ui).length).toBeGreaterThan(60);
    Object.values(story.ui).forEach((value) => {
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    });

    expect(story.sources.length).toBeGreaterThanOrEqual(12);
    story.sources.forEach((source) => {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.title.length).toBeGreaterThan(15);
    });

    story.scenes.forEach((scene) => {
      expect(scene.copy.title.length).toBeGreaterThan(8);
      expect(scene.copy.lede.length).toBeGreaterThan(35);
      expect(scene.term.name.length).toBeGreaterThan(3);
      expect(scene.term.pronunciation.length).toBeGreaterThan(3);
      expect(scene.term.meaning.length).toBeGreaterThan(12);
      expect(scene.focal.desktop).toMatch(/%/);
      expect(scene.focal.mobile).toMatch(/%/);
    });

    expect(app).toContain('const story = window.GALAXY_CENTER_STORY');
    expect(app).not.toContain('Alpha Centauri A and B are two bright');
    expect(research).toContain('## Claim map');
    expect(research).toContain('Sagittarius A*');
  });

  test('ships every referenced image, exact transcript, MP3, and WAV master', () => {
    const story = loadStory();
    const imageNames = fs.readdirSync(imageRoot).filter((name) => name.endsWith('.webp'));
    const transcriptNames = fs.readdirSync(audioRoot).filter((name) => name.endsWith('.txt'));
    const mp3Names = fs.readdirSync(audioRoot).filter((name) => name.endsWith('.mp3'));
    const wavNames = fs.readdirSync(wavRoot).filter((name) => name.endsWith('.wav'));

    expect(imageNames).toHaveLength(9);
    expect(transcriptNames).toHaveLength(12);
    expect(mp3Names).toHaveLength(12);
    expect(wavNames).toHaveLength(12);

    story.scenes.forEach((scene) => {
      const imagePath = path.join(gameRoot, scene.image);
      const transcriptPath = path.join(audioRoot, `${scene.audio}.txt`);
      const mp3Path = path.join(audioRoot, `${scene.audio}.mp3`);
      const wavPath = path.join(wavRoot, `${scene.audio}.wav`);

      expect(fileSize(imagePath)).toBeGreaterThan(50_000);
      expect(fs.readFileSync(transcriptPath, 'utf8').trim().length).toBeGreaterThan(250);
      expect(fileSize(mp3Path)).toBeGreaterThan(200_000);
      expect(fileSize(wavPath)).toBeGreaterThan(1_000_000);
    });
  });

  test('forces the panel open for discoveries and restores the stored preference afterward', () => {
    const app = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(app).toContain("const savedPanel = safeStorageGet('galaxyCenterPanel')");
    expect(app).toContain("const quizForcesPanel = scene.kind === 'quiz'");
    expect(app).toContain('const visible = quizForcesPanel || state.panelPreferred');
    expect(app).toContain('dom.panelButton.disabled = quizForcesPanel');
    expect(app).toContain("dom.panelButton.setAttribute('aria-pressed', String(visible))");
    expect(app).toContain('dom.storyCard.inert = !visible');
    expect(app).toContain("safeStorageSet(\n      'galaxyCenterPanel'");
    expect(styles).toContain('.experience[data-panel="hidden"] .story-card');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-wash');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-vignette');
    expect(styles).toContain('.experience[data-panel="hidden"] .galactic-haze');
  });

  test('implements local narration, captions, keyboard controls, idle warming, and reduced motion', () => {
    const app = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(app).toContain('fetch(`assets/audio/${scene.audio}.txt`');
    expect(app).toContain('this.audio.src = `assets/audio/${scene.audio}.mp3`');
    expect(app).toContain("event.key === 'ArrowRight'");
    expect(app).toContain("event.key === 'ArrowLeft'");
    expect(app).toContain("key === 'r'");
    expect(app).toContain("key === 'c'");
    expect(app).toContain("key === 'm'");
    expect(app).toContain("key === 'p'");
    expect(app).toContain('chooseQuizByKeyboard(event.key)');
    expect(app).toContain('window.requestIdleCallback');
    expect(app).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(app).toContain('state.dialogWasPlaying = narrator.isPlaying()');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('@media (max-height: 520px) and (orientation: landscape)');
    expect(styles).not.toMatch(/url\(['"]?https?:\/\//);
  });

  test('documents generated media and the retained local-audio workflow', () => {
    const readme = fs.readFileSync(path.join(gameRoot, 'README.md'), 'utf8');
    const imageManifest = fs.readFileSync(
      path.join(imageRoot, 'GENERATED-ASSETS.md'),
      'utf8',
    );
    const audioReadme = fs.readFileSync(path.join(audioRoot, 'README.md'), 'utf8');

    expect(readme).toContain('/galaxy_center/');
    expect(readme).toContain('11 minutes 24 seconds');
    expect(readme).toContain('eight core chapters');
    expect(imageManifest.match(/^## `\d{2}-.*\.webp`/gm)).toHaveLength(9);
    expect(imageManifest).toContain('1600×900');
    expect(imageManifest).toContain('Review correction');
    expect(audioReadme).toContain('en_US-lessac-medium');
    expect(audioReadme).toContain('libmp3lame');
    expect(audioReadme).toContain('684.487 seconds');
  });
});
