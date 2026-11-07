jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { createService, parseRequest, normalizeReport, mappingReview, makePlan, sourceId } = require('../../services/healthCheckService');
const analytics = require('../../public/js/health-check-analytics');
const owner = '111111111111111111111111';
function fixture(value = 10) {
  return { notesYear: 2026, report: { patient: { institution: 'Synthetic clinic', name: 'DO NOT STORE' }, report: { notes: 'Report-specific note' }, exams: [
    { exam_date: '2026-04-12', overall_comment: 'Current note', sections: [{ name: 'Body measurements', items: [{ name: 'Synthetic measurement', original: 'Test', value, unit: 'kg', reference_range: '5-15', rating: 'A' }] }] },
    { exam_date: '2025-04-10', overall_comment: 'Historical placeholder', doctor_comment: 'Wrong report note', sections: [{ name: 'Body measurements', items: [{ name: 'Synthetic measurement', original: 'Test', value: 11, unit: 'kg' }] }] },
  ] }, mappings: {} };
}
function mapped(body, history = { exams: [] }) {
  const input = parseRequest(body); const review = mappingReview(input, history);
  body.mappings = Object.fromEntries(review.sources.map(source => [source.key, source.certain ? source.suggested : 'new'])); return body;
}
function memoryModel() {
  let stored;
  return {
    findOne: jest.fn(filter => ({ lean: jest.fn(async () => stored?.ownerId === filter.ownerId ? structuredClone(stored) : null) })),
    create: jest.fn(async data => { if (stored) { const error = new Error('duplicate'); error.code = 11000; throw error; } stored = structuredClone(data); }),
    updateOne: jest.fn(async (filter, change) => {
      if (!stored || stored.ownerId !== filter.ownerId || stored.revision !== filter.revision) return { matchedCount: 0 };
      stored = { ...stored, ...structuredClone(change.$set), revision: stored.revision + 1 }; return { matchedCount: 1 };
    }),
  };
}
let model; let service;
beforeEach(() => { model = memoryModel(); service = createService(model); });
async function save(body) {
  const review = await service.review(owner, body);
  return service.commit(owner, { ...body, signature: review.signature, choices: Object.fromEntries(review.conflicts.map(conflict => [conflict.key, 'import'])) });
}
test('imports all measurements, keeps notes only for report year, drops personal identifiers', async () => {
  const body = mapped(fixture()); await save(body);
  const result = await service.read(owner);
  expect(result.exams).toHaveLength(2);
  expect(result.exams[0].overall_comment).toBe(''); expect(result.exams[0].doctor_comment).toBe('');
  expect(result.exams[1].overall_comment).toBe('Current note'); expect(result.exams[1].report_notes).toBe('Report-specific note');
  expect(JSON.stringify(result)).not.toContain('DO NOT STORE');
  expect(model.findOne).toHaveBeenCalledWith({ ownerId: owner });
  expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: owner, revision: 1 }));
});
test('identical reimport is ignored and does not issue a write', async () => {
  const body = mapped(fixture()); await save(body); const preview = await service.review(owner, body);
  expect(preview.conflicts).toHaveLength(0); expect(preview.addedExams).toBe(0); expect(preview.addedMeasurements).toBe(0);
  expect(await save(body)).toEqual(expect.objectContaining({ saved: false })); expect(model.updateOne).not.toHaveBeenCalled();
});
test('every differing field requires a choice; keep and import apply separately', async () => {
  await save(mapped(fixture())); const body = mapped(fixture(20)); body.report.exams[0].sections[0].items[0].unit = 'lb';
  const preview = await service.review(owner, body); expect(preview.conflicts).toHaveLength(2);
  await expect(service.commit(owner, { ...body, signature: preview.signature })).rejects.toMatchObject({ status: 400 });
  const choices = Object.fromEntries(preview.conflicts.map(conflict => [conflict.key, conflict.key.endsWith('.value') ? 'import' : 'keep']));
  await service.commit(owner, { ...body, signature: preview.signature, choices });
  const item = (await service.read(owner)).exams[1].measurements[0]; expect(item.value).toBe(20); expect(item.unit).toBe('kg');
  expect(model.updateOne).toHaveBeenCalledWith({ ownerId: owner, revision: 1 }, expect.any(Object), { runValidators: true });
});
test('older report fills empty notes via explicit conflict without removing missing data', async () => {
  await save(mapped(fixture())); const report = fixture(); report.notesYear = 2025; report.report.exams = [report.report.exams[1]];
  report.report.exams[0].overall_comment = 'Actual older notes'; report.report.exams[0].sections = [];
  const preview = await service.review(owner, report);
  expect(preview.conflicts).toContainEqual(expect.objectContaining({ key: '2025-04-10.overall_comment', existing: '', incoming: 'Actual older notes' }));
  await save(report); const history = await service.read(owner); expect(history.exams).toHaveLength(2);
  expect(history.exams[0].measurements).toHaveLength(1); expect(history.exams[0].overall_comment).toBe('Actual older notes'); expect(history.exams[1].overall_comment).toBe('Current note');
});
test('stale or tampered review cannot overwrite newer data', async () => {
  const original = mapped(fixture()); await save(original);
  const changed = mapped(fixture(20)); const preview = await service.review(owner, changed); await save(mapped(fixture(30)));
  await expect(service.commit(owner, { ...changed, signature: preview.signature })).rejects.toMatchObject({ status: 409 });
  const fresh = await service.review(owner, changed); changed.report.exams[0].sections[0].items[0].value = 40;
  await expect(service.commit(owner, { ...changed, signature: fresh.signature })).rejects.toMatchObject({ status: 409 });
  expect((await service.read(owner)).exams[1].measurements[0].value).toBe(30);
});
test('simultaneous first imports cannot create duplicate histories', async () => {
  const body = mapped(fixture()); const preview = await service.review(owner, body);
  const results = await Promise.allSettled([service.commit(owner, { ...body, signature: preview.signature }), service.commit(owner, { ...body, signature: preview.signature })]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected').reason.status).toBe(409);
});
test('concurrent update compare-and-swap loss returns conflict', async () => {
  await save(mapped(fixture())); const body = mapped(fixture(22)); const preview = await service.review(owner, body);
  model.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
  await expect(service.commit(owner, { ...body, signature: preview.signature, choices: Object.fromEntries(preview.conflicts.map(conflict => [conflict.key, 'import'])) })).rejects.toMatchObject({ status: 409 });
});
test('uncertain mappings require selection; exact source and distinct hearing labels stay separate', () => {
  const input = parseRequest(fixture()); expect(() => normalizeReport(input, { exams: [] })).toThrow('uncertain');
  const exam = { exam_date: '2026-01-01', sections: [{ name: 'Hearing', items: [{ name: 'Hearing', original: '聴力 1000 Hz right', finding: 'Normal' }, { name: 'Hearing', original: '聴力 1000 Hz left', finding: 'Normal' }] }] };
  const source = parseRequest({ notesYear: 2026, report: { exams: [exam] } });
  const review = mappingReview(source, { exams: [] }); expect(review.sources.every(row => row.certain)).toBe(true);
  const result = normalizeReport(source, { exams: [] }); expect(new Set(result[0].measurements.map(item => item.id)).size).toBe(2);
});
test('hospital acronym aliases suggest a known category but require explicit review', () => {
  const body = fixture(); body.report.exams = [{ exam_date: '2026-01-01', sections: [{ name: 'Different hospital', items: [{ name: 'GPT', value: 12 }] }] }];
  const review = mappingReview(parseRequest(body), { exams: [] });
  expect(review.sources[0].certain).toBe(false);
  expect(review.catalog.find(item => item.id === review.sources[0].suggested).name).toBe('ALT (GPT)');
});
test('measurement identity preserves decimal and punctuation distinctions', () => {
  expect(sourceId({ category: 'Hearing', name: 'Tone', original: '1.0 kHz' })).not.toBe(sourceId({ category: 'Hearing', name: 'Tone', original: '10 kHz' }));
});
test('same names in different specimens do not merge and ambiguous target collisions fail', () => {
  expect(sourceId({ category: 'Urine', name: 'RBC' })).not.toBe(sourceId({ category: 'Blood', name: 'RBC' }));
  const body = fixture(); body.report.exams[0].sections[0].items.push({ name: 'Another test', value: 5 });
  const source = parseRequest(mapped(body)); const review = mappingReview(source, { exams: [] });
  const target = review.catalog[0].id; review.sources.forEach(row => { source.mappings[row.key] = target; });
  expect(() => normalizeReport(source, { exams: [] })).toThrow('Two measurements');
});
test.each([
  body => { body.ownerId = owner; }, body => { body.report.exams[0].exam_date = '2026-02-30'; },
  body => { body.report.exams[0].sections[0].items[0].value = { $gt: 0 }; },
  body => { body.report.exams.push(body.report.exams[0]); },
  body => { body.report.exams[0].overall_comment = 'x'.repeat(12001); },
  body => { body.notesYear = 2020; },
])('invalid and unbounded input fails %#', mutate => { const body = fixture(); mutate(body); expect(() => parseRequest(body)).toThrow(); });
test('a missing value is retained, explicit null is offered as a conflict', () => {
  const history = { exams: [{ exam_date: '2026-01-01', sections: [], measurements: [{ id: 'one', name: 'Measure', value: 7 }] }] };
  expect(makePlan(history, [{ exam_date: '2026-01-01', sections: [], measurements: [{ id: 'one', name: 'Measure' }] }]).conflicts).toHaveLength(0);
  expect(makePlan(history, [{ exam_date: '2026-01-01', sections: [], measurements: [{ id: 'one', name: 'Measure', value: null }] }]).conflicts[0]).toMatchObject({ existing: 7, incoming: null });
});
test('numeric ranges honor one-sided and strict bounds and do not invent maxima', () => {
  expect(analytics.status({ value: 100000, reference_range: '60 or higher' }).outside).toBe(false);
  expect(analytics.status({ value: 130, reference_range: 'below 130' }).outside).toBe(true);
  expect(analytics.status({ value: 130, reference_range: '130 or below' }).outside).toBe(false);
  expect(analytics.status({ value: -5, reference_range: '-4–2' }).outside).toBe(true);
  expect(analytics.status({ value: 10, reference_range: 'unknown range' }).label).toBe('Not classified');
});
test('all years appear in trends, units separate, summary includes unflagged outliers and notes', () => {
  const exams = Array.from({ length: 13 }, (_, index) => ({ exam_date: `${2014 + index}-01-01`, overall_comment: 'Note', measurements: [{ id: 'x', name: 'Test', category: 'Test category', value: 20, reference_range: '0-10', unit: index === 0 ? 'lb' : 'kg' }] }));
  expect(analytics.trends(exams).map(trend => trend.points.length)).toEqual([1, 12]);
  expect(analytics.summary(exams[12])).toContain('Test category / Test: 20 kg'); expect(analytics.summary(exams[12])).toContain('Note');
});
