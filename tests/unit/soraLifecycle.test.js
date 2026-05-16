const {
  SORA_API_DISCONTINUATION_DATE,
  SORA_GENERATION_STOP_DATE,
  getSoraLifecycle,
  isSoraGenerationDisabled,
} = require('../../utils/soraLifecycle');

describe('soraLifecycle', () => {
  test('sets the local generation cutoff one week before Sora API discontinuation', () => {
    expect(SORA_API_DISCONTINUATION_DATE).toBe('2026-09-24');
    expect(SORA_GENERATION_STOP_DATE).toBe('2026-09-17');
  });

  test('allows generation before the cutoff date', () => {
    const lifecycle = getSoraLifecycle(new Date('2026-09-16T00:00:00.000Z'));

    expect(lifecycle.generationDisabled).toBe(false);
    expect(lifecycle.daysUntilGenerationStop).toBe(1);
    expect(isSoraGenerationDisabled(new Date('2026-09-16T23:59:59.999Z'))).toBe(false);
  });

  test('disables generation on and after the cutoff date', () => {
    const lifecycle = getSoraLifecycle(new Date('2026-09-17T00:00:00.000Z'));

    expect(lifecycle.generationDisabled).toBe(true);
    expect(lifecycle.daysUntilGenerationStop).toBe(0);
    expect(isSoraGenerationDisabled(new Date('2026-09-24T00:00:00.000Z'))).toBe(true);
  });
});
