const DEFAULT_ASR_QUALITY_THRESHOLDS = Object.freeze({
  avgLogprobMin: parseNumberEnv('ASR_QUALITY_AVG_LOGPROB_MIN', -1),
  noSpeechProbMax: parseNumberEnv('ASR_QUALITY_NO_SPEECH_PROB_MAX', 0.6),
  compressionRatioMax: parseNumberEnv('ASR_QUALITY_COMPRESSION_RATIO_MAX', 2.4),
});

function parseNumberEnv(name, fallback) {
  const parsed = Number.parseFloat(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value) {
  if (!Number.isFinite(value)) return null;
  return Number.parseFloat(value.toFixed(6));
}

function average(values) {
  const usableValues = values.filter((value) => Number.isFinite(value));
  if (!usableValues.length) return null;
  const total = usableValues.reduce((sum, value) => sum + value, 0);
  return roundMetric(total / usableValues.length);
}

function normalizeAsrSegment(segment = {}, index = 0) {
  const id = toNullableNumber(segment.id);
  const text = typeof segment.text === 'string' ? segment.text.trim() : '';
  return {
    id: id !== null ? id : index,
    start: toNullableNumber(segment.start),
    end: toNullableNumber(segment.end),
    text,
    avgLogprob: toNullableNumber(segment.avg_logprob ?? segment.avgLogprob),
    noSpeechProb: toNullableNumber(segment.no_speech_prob ?? segment.noSpeechProb),
    compressionRatio: toNullableNumber(segment.compression_ratio ?? segment.compressionRatio),
  };
}

function normalizeAsrSegments(data = {}) {
  const rawSegments = Array.isArray(data?.segments) ? data.segments : [];
  return rawSegments.map((segment, index) => normalizeAsrSegment(segment, index));
}

function resolveThresholds(overrides = {}) {
  return {
    avgLogprobMin: toNullableNumber(overrides.avgLogprobMin) ?? DEFAULT_ASR_QUALITY_THRESHOLDS.avgLogprobMin,
    noSpeechProbMax: toNullableNumber(overrides.noSpeechProbMax) ?? DEFAULT_ASR_QUALITY_THRESHOLDS.noSpeechProbMax,
    compressionRatioMax: toNullableNumber(overrides.compressionRatioMax) ?? DEFAULT_ASR_QUALITY_THRESHOLDS.compressionRatioMax,
  };
}

function buildAsrQualitySummary(segments = [], thresholdOverrides = {}) {
  const thresholds = resolveThresholds(thresholdOverrides);
  const avgLogprobs = segments
    .map((segment) => segment.avgLogprob)
    .filter((value) => Number.isFinite(value));
  const noSpeechProbs = segments
    .map((segment) => segment.noSpeechProb)
    .filter((value) => Number.isFinite(value));
  const compressionRatios = segments
    .map((segment) => segment.compressionRatio)
    .filter((value) => Number.isFinite(value));

  const minAvgLogprob = avgLogprobs.length ? Math.min(...avgLogprobs) : null;
  const maxNoSpeechProb = noSpeechProbs.length ? Math.max(...noSpeechProbs) : null;
  const maxCompressionRatio = compressionRatios.length ? Math.max(...compressionRatios) : null;
  const garbageReasons = [];

  if (minAvgLogprob !== null && minAvgLogprob < thresholds.avgLogprobMin) {
    garbageReasons.push('avg_logprob_below_threshold');
  }
  if (maxNoSpeechProb !== null && maxNoSpeechProb > thresholds.noSpeechProbMax) {
    garbageReasons.push('no_speech_prob_above_threshold');
  }
  if (maxCompressionRatio !== null && maxCompressionRatio > thresholds.compressionRatioMax) {
    garbageReasons.push('compression_ratio_above_threshold');
  }

  return {
    segmentCount: segments.length,
    avgLogprob: average(avgLogprobs),
    minAvgLogprob: roundMetric(minAvgLogprob),
    noSpeechProb: average(noSpeechProbs),
    maxNoSpeechProb: roundMetric(maxNoSpeechProb),
    compressionRatio: average(compressionRatios),
    maxCompressionRatio: roundMetric(maxCompressionRatio),
    possibleGarbage: garbageReasons.length > 0,
    garbageReasons,
    thresholds,
  };
}

function buildAsrQuality(data = {}, thresholdOverrides = {}) {
  const segments = normalizeAsrSegments(data);
  return {
    segments,
    quality: buildAsrQualitySummary(segments, thresholdOverrides),
  };
}

module.exports = {
  DEFAULT_ASR_QUALITY_THRESHOLDS,
  buildAsrQuality,
  buildAsrQualitySummary,
  normalizeAsrSegment,
  normalizeAsrSegments,
  resolveThresholds,
};
