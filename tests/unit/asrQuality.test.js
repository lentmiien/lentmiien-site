const { buildAsrQuality } = require('../../utils/asrQuality');

describe('ASR quality helpers', () => {
  test('normalizes Whisper segment metrics and keeps accurate audio unflagged', () => {
    const { segments, quality } = buildAsrQuality({
      segments: [{
        id: 0,
        start: 2.5,
        end: 8.66,
        text: 'I have a question what\'s the fastest thing in the universe?',
        avg_logprob: -0.575066089630127,
        no_speech_prob: 0.11265980452299118,
        compression_ratio: 0.9672131147540983,
      }],
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      avgLogprob: -0.575066089630127,
      noSpeechProb: 0.11265980452299118,
      compressionRatio: 0.9672131147540983,
    });
    expect(quality).toMatchObject({
      segmentCount: 1,
      avgLogprob: -0.575066,
      noSpeechProb: 0.11266,
      compressionRatio: 0.967213,
      possibleGarbage: false,
      garbageReasons: [],
    });
  });

  test('flags very low avg_logprob as possible garbage', () => {
    const { quality } = buildAsrQuality({
      segments: [{
        text: 'Bush-adony brand of power quelques',
        avg_logprob: -6.050871415571733,
        no_speech_prob: 0.4987715482711792,
        compression_ratio: 0.85,
      }],
    });

    expect(quality.possibleGarbage).toBe(true);
    expect(quality.garbageReasons).toContain('avg_logprob_below_threshold');
  });
});
