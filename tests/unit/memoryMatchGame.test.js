const fs = require('fs');
const path = require('path');

const {
  DIFFICULTIES,
  FINAL_AUDIO_GAP_MS,
  createDistributedDeck,
  measureDeckDistribution,
  runCompletionSequence,
  shuffle,
} = require('../../games/memory_match/js/script');

const gameRoot = path.join(process.cwd(), 'games', 'memory_match');

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('Memory Match game', () => {
  test('has a themed, responsive, accessible standalone game shell', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(html).toContain('href="/css/color-theme.css"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('href="/games"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="moves-count"');
    expect(html).toContain('id="board-progress-bar"');
    expect(html).toContain('role="dialog"');
    expect(styles).toContain('var(--surface-1)');
    expect(styles).toContain('var(--brand)');
    expect(styles).toContain('var(--accent)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('keeps the front and back of each card on separate 3D planes', () => {
    const styles = fs.readFileSync(path.join(gameRoot, 'css', 'styles.css'), 'utf8');

    expect(styles).toContain('transform: rotateY(180deg) translateZ(1px);');
    expect(styles).toContain('transform: rotateY(0deg) translateZ(1px);');
  });

  test('uses a non-mutating Fisher-Yates shuffle', () => {
    const cards = ['apple', 'banana', 'cat', 'dog', 'fish', 'lion'];
    const shuffled = shuffle(cards, createSeededRandom(42));

    expect(cards).toEqual(['apple', 'banana', 'cat', 'dog', 'fish', 'lion']);
    expect(shuffled).not.toEqual(cards);
    expect([...shuffled].sort()).toEqual([...cards].sort());
  });

  test('keeps matching cards out of adjacent slots on every board layout', () => {
    DIFFICULTIES.forEach((difficulty) => {
      const cards = Array.from({ length: difficulty.pairs }, (_, index) => ({
        name: `card-${index}`,
      }));
      const deck = createDistributedDeck(
        cards,
        difficulty.columnLayouts,
        createSeededRandom(difficulty.level)
      );
      const metrics = measureDeckDistribution(deck, difficulty.columnLayouts);
      const cardCounts = deck.reduce((counts, card) => {
        counts[card.name] = (counts[card.name] || 0) + 1;
        return counts;
      }, {});

      expect(deck).toHaveLength(difficulty.pairs * 2);
      expect(Object.values(cardCounts)).toEqual(
        Array.from({ length: difficulty.pairs }, () => 2)
      );
      expect(metrics.adjacentPairs).toBe(0);
    });
  });

  test('waits for match narration and a deliberate gap before the win cue', async () => {
    const events = [];
    let finishMatchAudio;
    const matchAudio = new Promise((resolve) => {
      finishMatchAudio = () => {
        events.push('match audio ended');
        resolve();
      };
    });
    const completion = runCompletionSequence(
      matchAudio,
      async (milliseconds) => {
        events.push(`gap ${milliseconds}`);
      },
      () => {
        events.push('win cue');
      }
    );

    await Promise.resolve();
    expect(events).toEqual([]);

    finishMatchAudio();
    await completion;

    expect(FINAL_AUDIO_GAP_MS).toBeGreaterThanOrEqual(600);
    expect(events).toEqual([
      'match audio ended',
      `gap ${FINAL_AUDIO_GAP_MS}`,
      'win cue',
    ]);
  });
});
