const { buildAsrQuality } = require('../../utils/asrQuality');

const TEST_THRESHOLDS = {
  avgLogprobMin: -1.75,
  avgLogprobMax: -0.1,
  noSpeechProbMin: 0,
  noSpeechProbMax: 0.3,
  compressionRatioMin: 0.6,
  compressionRatioMax: 1.15,
};

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
    }, TEST_THRESHOLDS);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      avgLogprob: -0.575066089630127,
      noSpeechProb: 0.11265980452299118,
      compressionRatio: 0.9672131147540983,
    });
    expect(quality).toMatchObject({
      segmentCount: 1,
      avgLogprob: -0.575066,
      minAvgLogprob: -0.575066,
      maxAvgLogprob: -0.575066,
      noSpeechProb: 0.11266,
      minNoSpeechProb: 0.11266,
      maxNoSpeechProb: 0.11266,
      compressionRatio: 0.967213,
      minCompressionRatio: 0.967213,
      maxCompressionRatio: 0.967213,
      possibleGarbage: false,
      garbageReasons: [],
      thresholds: {
        avgLogprobMin: -1.75,
        avgLogprobMax: -0.1,
        noSpeechProbMin: 0,
        noSpeechProbMax: 0.3,
        compressionRatioMin: 0.6,
        compressionRatioMax: 1.15,
      },
    });
  });

  test('flags very low avg_logprob as possible garbage', () => {
    const { quality } = buildAsrQuality({
      segments: [{
        text: 'Bush-adony brand of power quelques',
        avg_logprob: -6.050871415571733,
        no_speech_prob: 0.2,
        compression_ratio: 0.85,
      }],
    }, TEST_THRESHOLDS);

    expect(quality.possibleGarbage).toBe(true);
    expect(quality.garbageReasons).toEqual(['avg_logprob_below_threshold']);
  });

  test('flags metrics outside the padded quality ranges', () => {
    const { quality } = buildAsrQuality({
      segments: [
        {
          text: 'too low values',
          avg_logprob: -1.76,
          no_speech_prob: -0.01,
          compression_ratio: 0.59,
        },
        {
          text: 'too high values',
          avg_logprob: -0.05,
          no_speech_prob: 0.31,
          compression_ratio: 1.16,
        },
      ],
    }, TEST_THRESHOLDS);

    expect(quality.possibleGarbage).toBe(true);
    expect(quality.garbageReasons).toEqual([
      'avg_logprob_below_threshold',
      'avg_logprob_above_threshold',
      'no_speech_prob_below_threshold',
      'no_speech_prob_above_threshold',
      'compression_ratio_below_threshold',
      'compression_ratio_above_threshold',
    ]);
  });
});
