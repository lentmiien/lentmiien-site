const { MODEL_CONTRACTS } = require('../../services/gptImageModels');
const { auditGptImageModelCards } = require('../../services/gptImageModelCardAudit');

function fixture() {
  const cards = Object.keys(MODEL_CONTRACTS).map(api_model => ({ api_model, model_type: 'image',
    in_modalities: ['text', 'image'], out_modalities: ['image'], deprecation_date: null }));
  const query = { select: jest.fn(() => query), limit: jest.fn(() => query), maxTimeMS: jest.fn(() => query), lean: jest.fn(async () => cards) };
  const model = { find: jest.fn(() => query) };
  const log = { warning: jest.fn() };
  return { cards, query, model, log, now: new Date('2026-11-09T12:00:00') };
}

test('every selectable image model must have compatible tracking metadata', async () => {
  const f = fixture();
  expect((await auditGptImageModelCards(f)).ok).toBe(true);
  expect(f.log.warning).not.toHaveBeenCalled();
  f.cards.splice(f.cards.findIndex(card => card.api_model === 'gpt-image-2.6-sunburst'), 1);
  expect(await auditGptImageModelCards(f)).toMatchObject({ ok: false, issues: [
    { model: 'gpt-image-2.6-sunburst', reasons: ['missing_card'] },
  ] });
  expect(f.query.maxTimeMS).toHaveBeenCalledWith(5000);
  expect(f.query.limit).toHaveBeenCalledWith(101);
});

test('duplicates, expired dates and incompatible cards remain visible without seeding or provider requests', async () => {
  const f = fixture();
  Object.assign(f.cards[0], { deprecation_date: '2026-11-01', in_modalities: ['text'] });
  f.cards.push({ ...f.cards[0], deprecation_date: 'PRIVATE invalid value' });
  expect((await auditGptImageModelCards(f)).issues[0].reasons).toEqual([
    'duplicate_cards', 'incompatible_modalities', 'deprecated_selectable_model', 'invalid_deprecation_date',
  ]);
  expect(JSON.stringify(f.log.warning.mock.calls)).not.toContain('PRIVATE');
});

test('database failure is not reported as a clean audit', async () => {
  const f = fixture(); f.query.lean.mockRejectedValue(new Error('unavailable'));
  await expect(auditGptImageModelCards(f)).rejects.toThrow('unavailable');
});
