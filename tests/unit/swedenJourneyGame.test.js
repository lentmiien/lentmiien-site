const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gameRoot = path.join(process.cwd(), 'games', 'sweden_journey');
const imageRoot = path.join(gameRoot, 'assets', 'images');
const audioRoot = path.join(gameRoot, 'assets', 'audio');

function loadSlides() {
  const source = fs.readFileSync(path.join(gameRoot, 'js', 'story.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.STORY_SLIDES;
}

describe('SVERIGE visual journey', () => {
  test('has a Japanese, themed, accessible standalone shell', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');

    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('SVERIGE · 光と余白の国へ');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('assets/images/archipelago-hero.webp');
    expect(html).toContain('id="panelButton"');
    expect(html).toContain('id="captionButton"');
    expect(html).toContain('id="soundButton"');
    expect(html).toContain('id="infoDialog"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('日本語ナレーション付き');
  });

  test('provides eight story chapters, three light quizzes, and a finale', () => {
    const slides = loadSlides();
    const kinds = slides.map((slide) => slide.kind);

    expect(slides).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'story')).toHaveLength(8);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'finale')).toHaveLength(1);
    expect(new Set(slides.map((slide) => slide.image)).size).toBe(8);
    expect(new Set(slides.map((slide) => slide.audio)).size).toBe(slides.length);

    slides.filter((slide) => slide.kind === 'quiz').forEach((quiz) => {
      expect(quiz.options).toHaveLength(3);
      expect(quiz.answer).toBeGreaterThanOrEqual(0);
      expect(quiz.answer).toBeLessThan(quiz.options.length);
      expect(quiz.explanation.length).toBeGreaterThan(20);
    });
  });

  test('ships every referenced generated image and narration asset', () => {
    const slides = loadSlides();

    slides.forEach((slide) => {
      const imageName = path.basename(slide.image);
      const imagePath = path.join(imageRoot, imageName);
      const transcriptPath = path.join(audioRoot, `${slide.audio}.txt`);
      const mp3Path = path.join(audioRoot, `${slide.audio}.mp3`);
      const wavPath = path.join(audioRoot, 'source-wav', `${slide.audio}.wav`);

      expect(fs.statSync(imagePath).size).toBeGreaterThan(50_000);
      expect(fs.readFileSync(transcriptPath, 'utf8').trim().length).toBeGreaterThan(40);
      expect(fs.statSync(mp3Path).size).toBeGreaterThan(50_000);
      expect(fs.statSync(wavPath).size).toBeGreaterThan(100_000);
    });
  });

  test('implements replayable narration, a quiz-aware panel, keyboard travel, and reduced motion', () => {
    const script = fs.readFileSync(path.join(gameRoot, 'js', 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(script).toContain("fetch(`assets/audio/${slide.audio}.txt`");
    expect(script).toContain("this.audio.src = `assets/audio/${slide.audio}.mp3`");
    expect(script).toContain("event.key === 'ArrowRight'");
    expect(script).toContain("key === 'r'");
    expect(script).toContain("key === 'c'");
    expect(script).toContain("key === 'p'");
    expect(script).toContain("safeStorageSet('swedenJourneyPanel'");
    expect(script).toContain("const quizRequiresPanel = slide.kind === 'quiz'");
    expect(script).toContain('chooseQuizByKeyboard(event.key)');
    expect(styles).toContain('.experience[data-panel="hidden"] .story-card');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('--brand: #ff6a1f');
    expect(styles).toContain('--accent: #ffc247');
  });
});
