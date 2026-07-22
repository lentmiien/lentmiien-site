const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    expect(html).toContain('id="languageButton"');
    expect(html).toContain('data-i18n="introLede"');
    expect(html).toContain('日本語');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('id="endlessButton"');
  });

  test('keeps every English and Japanese narration clip in WAV and MP3 form', () => {
    const audioSets = [
      {
        language: 'en',
        voice: 'en_US-lessac-medium',
        manifestPath: path.join(audioRoot, 'audio-script.json'),
        mp3Root: audioRoot,
        wavRoot: sourceWavRoot,
      },
      {
        language: 'ja',
        voice: 'ja_shikoku_metan_normal',
        manifestPath: path.join(audioRoot, 'ja', 'audio-script.json'),
        mp3Root: path.join(audioRoot, 'ja'),
        wavRoot: path.join(sourceWavRoot, 'ja'),
      },
    ];

    audioSets.forEach((audioSet) => {
      const manifest = JSON.parse(fs.readFileSync(audioSet.manifestPath, 'utf8'));
      const expectedIds = manifest.clips.map(({ id }) => id);

      for (let number = manifest.numberRange.start; number <= manifest.numberRange.end; number += 1) {
        expectedIds.push(`number-${number}`);
      }

      expect(manifest.voice).toBe(audioSet.voice);
      if (audioSet.language === 'ja') expect(manifest.language).toBe('ja');
      expect(expectedIds).toHaveLength(131);

      expectedIds.forEach((id) => {
        const mp3Path = path.join(audioSet.mp3Root, `${id}.mp3`);
        const wavPath = path.join(audioSet.wavRoot, `${id}.wav`);

        expect(fs.statSync(mp3Path).size).toBeGreaterThan(0);
        expect(fs.statSync(wavPath).size).toBeGreaterThan(0);
      });
    });
  });

  test('localizes live game text, accessibility labels, and audio paths', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const gameScript = fs.readFileSync(path.join(gameRoot, 'js', 'game.js'), 'utf8');
    const copyStart = gameScript.indexOf('const COPY = ') + 'const COPY = '.length;
    const copyEnd = gameScript.indexOf('\n\n  function getInitialLanguage');
    const copy = vm.runInNewContext(`(${gameScript.slice(copyStart, copyEnd).replace(/;$/, '')})`);
    const referencedKeys = [
      ...html.matchAll(/data-i18n(?:-aria|-alt|-html)?="([^"]+)"/g),
      ...gameScript.matchAll(/\bt\('([^']+)'/g),
    ].map((match) => match[1]);

    expect(gameScript).toContain("documentTitle: 'わけて ひかろう・ランタンの庭'");
    expect(gameScript).toContain("language: getInitialLanguage()");
    expect(gameScript).toContain('function toggleLanguage()');
    expect(gameScript).toContain("state.language === 'ja' ? `${AUDIO_BASE}/ja` : AUDIO_BASE");
    expect(gameScript).toContain("element.setAttribute('aria-label', t(element.dataset.i18nAria))");
    expect(Object.keys(copy.ja).sort()).toEqual(Object.keys(copy.en).sort());
    referencedKeys.forEach((key) => {
      expect(copy.en).toHaveProperty(key);
      expect(copy.ja).toHaveProperty(key);
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
    expect(gameScript).toContain("levelStar: 'Star Keeper'");
    expect(gameScript).toContain('divisors: [2, 3, 4, 5, 6, 7, 8, 9, 10]');
  });
});
