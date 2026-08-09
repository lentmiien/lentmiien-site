const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gameRoot = path.join(process.cwd(), 'games', 'kardashev');
const imageRoot = path.join(gameRoot, 'assets', 'images');
const audioRoot = path.join(gameRoot, 'assets', 'audio');

function loadSlides() {
  const source = fs.readFileSync(path.join(gameRoot, 'js', 'story.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.STORY_SLIDES;
}

describe('Kardashev Civilizations visual journey', () => {
  test('ships a standalone English shell with the essential accessible controls', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Kardashev Civilizations</title>');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('assets/images/first-signal.webp');
    expect(html.match(/rel="preload"/g)).toHaveLength(1);
    expect(html).toContain('id="startButton"');
    expect(html).toContain('Begin the ascent');
    expect(html).toContain('id="panelButton"');
    expect(html).toContain('id="captionButton"');
    expect(html).toContain('id="soundButton"');
    expect(html).toContain('id="replayNarrationButton"');
    expect(html).toContain('id="infoDialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('English narration');
    expect(html).toContain('generated specifically for this experience');
    expect(html).toContain('Piper Lessac voice');
  });

  test('provides the intended story, transition, discovery, and finale arc', () => {
    const slides = loadSlides();
    const kinds = slides.map((slide) => slide.kind);
    const chapters = new Set(slides.map((slide) => slide.chapter));

    expect(slides).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'story')).toHaveLength(8);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'finale')).toHaveLength(1);
    [
      'Origin',
      'Type I',
      'Transition I → II',
      'Type II',
      'Transition II → III',
      'Type III',
      'Meaning',
      'Finale',
    ].forEach((chapter) => expect(chapters.has(chapter)).toBe(true));
    expect(new Set(slides.map((slide) => slide.image)).size).toBe(9);
    expect(new Set(slides.map((slide) => slide.audio)).size).toBe(slides.length);

    slides.forEach((slide) => {
      expect(slide.image).toMatch(/^assets\/images\/[a-z0-9-]+\.webp$/);
      expect(slide.audio).toMatch(/^[a-z0-9-]+$/);
      expect(slide.title.length).toBeGreaterThan(8);
      expect(slide.lede.length).toBeGreaterThan(45);
      expect(slide.term.name.length).toBeGreaterThan(3);
    });

    slides.filter((slide) => slide.kind === 'quiz').forEach((quiz) => {
      expect(quiz.options).toHaveLength(3);
      expect(quiz.answer).toBeGreaterThanOrEqual(0);
      expect(quiz.answer).toBeLessThan(quiz.options.length);
      expect(quiz.explanation.length).toBeGreaterThan(60);
    });
  });

  test('ships every referenced image, transcript, MP3, and WAV master', () => {
    const slides = loadSlides();
    const manifest = fs.readFileSync(path.join(imageRoot, 'GENERATED-ASSETS.md'), 'utf8');

    slides.forEach((slide) => {
      const imageName = path.basename(slide.image);
      const imagePath = path.join(imageRoot, imageName);
      const transcriptPath = path.join(audioRoot, `${slide.audio}.txt`);
      const mp3Path = path.join(audioRoot, `${slide.audio}.mp3`);
      const wavPath = path.join(audioRoot, 'source-wav', `${slide.audio}.wav`);
      const imageHeader = fs.readFileSync(imagePath).subarray(0, 12);
      const wavHeader = fs.readFileSync(wavPath).subarray(0, 12);

      expect(fs.statSync(imagePath).size).toBeGreaterThan(50_000);
      expect(imageHeader.subarray(0, 4).toString()).toBe('RIFF');
      expect(imageHeader.subarray(8, 12).toString()).toBe('WEBP');
      expect(fs.readFileSync(transcriptPath, 'utf8').trim().length).toBeGreaterThan(180);
      expect(fs.statSync(mp3Path).size).toBeGreaterThan(100_000);
      expect(fs.statSync(wavPath).size).toBeGreaterThan(500_000);
      expect(wavHeader.subarray(0, 4).toString()).toBe('RIFF');
      expect(wavHeader.subarray(8, 12).toString()).toBe('WAVE');
      expect(manifest).toContain(`\`${imageName}\``);
    });
  });

  test('implements a stored, quiz-aware panel and restores hidden viewing mode', () => {
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(script).toContain("safeStorageGet('kardashevPanel')");
    expect(script).toContain("safeStorageSet('kardashevPanel'");
    expect(script).toContain("const quizRequiresPanel = slide.kind === 'quiz';");
    expect(script).toContain('const visible = quizRequiresPanel || state.panelPreferred;');
    expect(script).toContain('dom.panelButton.disabled = quizRequiresPanel;');
    expect(script).toContain("dom.storyCard.toggleAttribute('inert', !visible)");
    expect(script).toContain("dom.panelButton.setAttribute('aria-pressed', String(visible))");
    expect(styles).toContain('.experience[data-panel="hidden"] .story-card');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-wash');
    expect(styles).toContain('.experience[data-panel="hidden"] .scene-image.is-visible');
  });

  test('supports local narration, captions, keyboard travel, warmed assets, and reduced motion', () => {
    const scriptSource = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(() => new vm.Script(scriptSource)).not.toThrow();
    expect(scriptSource).toContain('fetch(`assets/audio/${slide.audio}.txt`');
    expect(scriptSource).toContain('this.audio.src = `assets/audio/${slide.audio}.mp3`');
    expect(scriptSource).toContain("event.key === 'ArrowRight'");
    expect(scriptSource).toContain("event.key === 'ArrowLeft'");
    expect(scriptSource).toContain("key === 'r'");
    expect(scriptSource).toContain("key === 'c'");
    expect(scriptSource).toContain("key === 'm'");
    expect(scriptSource).toContain("key === 'p'");
    expect(scriptSource).toContain('chooseQuizByKeyboard(event.key)');
    expect(scriptSource).toContain('requestIdleCallback');
    expect(scriptSource).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('var(--brand)');
    expect(styles).toContain('var(--accent)');
    expect(styles).toContain('env(safe-area-inset-bottom');
  });
});
