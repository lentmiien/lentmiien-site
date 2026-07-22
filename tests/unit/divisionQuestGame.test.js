const fs = require('fs');
const path = require('path');

const gameRoot = path.join(process.cwd(), 'games', 'division_quest');
const audioRoot = path.join(gameRoot, 'assets', 'audio');
const sourceWavRoot = path.join(audioRoot, 'source-wav');

describe('Divide & Shine game', () => {
  test('has a themed, accessible standalone game shell', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');

    expect(html).toContain('Divide &amp; Shine');
    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('assets/images/lantern-garden.webp');
    expect(html).toContain('assets/images/lumi.webp');
    expect(html).toContain('Every lesson and problem is spoken aloud.');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('id="endlessButton"');
  });

  test('keeps every scripted narration and number in WAV and MP3 form', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(audioRoot, 'audio-script.json'), 'utf8'),
    );
    const expectedIds = manifest.clips.map(({ id }) => id);

    for (let number = manifest.numberRange.start; number <= manifest.numberRange.end; number += 1) {
      expectedIds.push(`number-${number}`);
    }

    expect(manifest.voice).toBe('en_US-lessac-medium');
    expect(expectedIds).toHaveLength(131);

    expectedIds.forEach((id) => {
      const mp3Path = path.join(audioRoot, `${id}.mp3`);
      const wavPath = path.join(sourceWavRoot, `${id}.wav`);

      expect(fs.statSync(mp3Path).size).toBeGreaterThan(0);
      expect(fs.statSync(wavPath).size).toBeGreaterThan(0);
    });
  });

  test('includes four strategies, guided practice, and adaptive endless play', () => {
    const gameScript = fs.readFileSync(path.join(gameRoot, 'js', 'game.js'), 'utf8');

    expect(gameScript).toContain("share: {");
    expect(gameScript).toContain("groups: {");
    expect(gameScript).toContain("hops: {");
    expect(gameScript).toContain("family: {");
    expect(gameScript).toContain('const TRAINING_LENGTH = 6;');
    expect(gameScript).toContain('function generateEndlessProblem()');
    expect(gameScript).toContain("name: 'Star Keeper'");
    expect(gameScript).toContain('divisors: [2, 3, 4, 5, 6, 7, 8, 9, 10]');
  });
});
