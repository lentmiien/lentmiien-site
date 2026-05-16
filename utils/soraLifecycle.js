const MS_PER_DAY = 24 * 60 * 60 * 1000;
// OpenAI Help Center says the Sora API is discontinued on 2026-09-24.
const SORA_API_DISCONTINUATION_DATE = '2026-09-24';
const SORA_GENERATION_STOP_OFFSET_DAYS = 7;
const SORA_API_DISCONTINUATION_AT = new Date(`${SORA_API_DISCONTINUATION_DATE}T00:00:00.000Z`);
const SORA_GENERATION_STOP_AT = new Date(
  SORA_API_DISCONTINUATION_AT.getTime() - (SORA_GENERATION_STOP_OFFSET_DAYS * MS_PER_DAY),
);
const SORA_GENERATION_STOP_DATE = SORA_GENERATION_STOP_AT.toISOString().slice(0, 10);

function normalizeDate(value) {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function formatDateLabel(value) {
  const date = normalizeDate(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getDaysUntil(targetDate, now = new Date()) {
  const target = normalizeDate(targetDate);
  const current = normalizeDate(now);
  const diffMs = target.getTime() - current.getTime();
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / MS_PER_DAY);
}

function isSoraGenerationDisabled(now = new Date()) {
  return normalizeDate(now).getTime() >= SORA_GENERATION_STOP_AT.getTime();
}

function getSoraGenerationDisabledMessage() {
  return `Sora generation is disabled because OpenAI is discontinuing the Sora API on ${formatDateLabel(SORA_API_DISCONTINUATION_AT)}. This app stopped new Sora generations on ${formatDateLabel(SORA_GENERATION_STOP_AT)}.`;
}

function getSoraLifecycle(now = new Date()) {
  const generationDisabled = isSoraGenerationDisabled(now);
  const generationStopLabel = formatDateLabel(SORA_GENERATION_STOP_AT);
  const apiDiscontinuationLabel = formatDateLabel(SORA_API_DISCONTINUATION_AT);
  const daysUntilGenerationStop = getDaysUntil(SORA_GENERATION_STOP_AT, now);
  const daysUntilApiDiscontinuation = getDaysUntil(SORA_API_DISCONTINUATION_AT, now);

  return {
    apiDiscontinuationDate: SORA_API_DISCONTINUATION_DATE,
    apiDiscontinuationAt: SORA_API_DISCONTINUATION_AT.toISOString(),
    apiDiscontinuationLabel,
    generationStopDate: SORA_GENERATION_STOP_DATE,
    generationStopAt: SORA_GENERATION_STOP_AT.toISOString(),
    generationStopLabel,
    generationStopOffsetDays: SORA_GENERATION_STOP_OFFSET_DAYS,
    daysUntilGenerationStop,
    daysUntilApiDiscontinuation,
    generationDisabled,
    generationDisabledMessage: getSoraGenerationDisabledMessage(),
  };
}

module.exports = {
  MS_PER_DAY,
  SORA_API_DISCONTINUATION_DATE,
  SORA_API_DISCONTINUATION_AT,
  SORA_GENERATION_STOP_DATE,
  SORA_GENERATION_STOP_AT,
  SORA_GENERATION_STOP_OFFSET_DAYS,
  formatDateLabel,
  getDaysUntil,
  getSoraLifecycle,
  isSoraGenerationDisabled,
};
