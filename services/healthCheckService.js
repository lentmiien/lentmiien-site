const crypto = require('crypto');
const { z } = require('zod');
const seedCatalog = require('./healthCheckCatalog.json');
const text = z.string().max(12000).nullable();
const label = z.string().trim().min(1).max(240);
const short = z.string().max(500).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && +value.slice(0, 4) >= 1900;
});
const itemSchema = z.object({
  name: label, original: short.optional(), value: z.union([z.number().finite(), z.string().max(500), z.null()]).optional(),
  unit: short.optional(), reference_range: short.optional(), rating: short.optional(),
  finding: text.optional(), description: text.optional(), why_useful: text.optional(),
});
const noteFields = ['overall_comment', 'doctor_comment', 'metabolic_comment', 'doctor_judgment', 'report_notes'];
const examSchema = z.object({
  exam_date: date, overall_rating: short.optional(), metabolic_syndrome_determination: text.optional(),
  overall_comment: text.optional(), doctor_comment: text.optional(), metabolic_comment: text.optional(),
  doctor_judgment: text.optional(), report_notes: text.optional(), institution: short.optional(), doctor: short.optional(),
  sections: z.array(z.object({ name: label, original_japanese: short.optional(), section_rating: short.optional(), items: z.array(itemSchema).max(1000) })).max(100),
});
const reportSchema = z.object({
  exams: z.array(examSchema).min(1).max(100),
  patient: z.object({ institution: short.optional(), doctor: short.optional() }).optional(),
  report: z.object({ notes: text.optional() }).optional(),
});
const mappingSchema = z.record(z.string().regex(/^[a-f0-9]{24}$/), z.union([
  z.string().regex(/^(?:[a-f0-9]{24}|new|skip)$/),
  z.object({ id: z.literal('new'), category: label }).strict(),
])).refine(value => Object.keys(value).length <= 2000);
const requestSchema = z.object({
  report: reportSchema, notesYear: z.number().int().min(1900).max(2200),
  mappings: mappingSchema.default({}), signature: z.string().max(200).optional(),
  choices: z.record(z.string().max(200), z.enum(['keep', 'import'])).default({}),
}).strict();
function invalid(message) { const error = new Error(message); error.status = 400; return error; }
function normalized(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim(); }
function nameAliases(name) {
  // Parenthetical labels in the supplied catalog offer conservative acronym matches.
  // These are suggestions only; a changed source label always requires review.
  const source = String(name || '');
  return [...new Set([source, source.replace(/\([^)]*\)/g, '').trim(),
    ...Array.from(source.matchAll(/\(([^)]+)\)/g), match => match[1]),
  ].map(normalized).filter(Boolean))];
}
function sourceId(item) {
  return crypto.createHash('sha256').update(JSON.stringify([item.category, item.name, item.original].map(normalized))).digest('hex').slice(0, 24);
}
function parseRequest(body) {
  const result = requestSchema.safeParse(body);
  if (!result.success) throw invalid('Invalid report. Check exam dates, measurement fields and input limits.');
  const input = result.data;
  const dates = new Set(); let total = 0;
  for (const exam of input.report.exams) {
    if (dates.has(exam.exam_date)) throw invalid('The file contains repeated exam dates. Combine each date into one exam first.');
    dates.add(exam.exam_date);
    const count = exam.sections.reduce((sum, section) => sum + section.items.length, 0);
    total += count;
    if (count > 1000 || total > 20000) throw invalid('The report contains too many measurements.');
  }
  if (!input.report.exams.some(exam => +exam.exam_date.slice(0, 4) === input.notesYear)) throw invalid('The report year must match an exam in this file.');
  if (Object.keys(input.choices).length > 20000) throw invalid('Too many conflict choices.');
  return input;
}
function catalogFor(history) {
  const map = new Map(seedCatalog.map(item => [sourceId(item), { ...item, id: sourceId(item) }]));
  for (const exam of history.exams) for (const item of exam.measurements) map.set(item.id, { id: item.id, category: item.category, name: item.name, original: item.original || '' });
  return [...map.values()];
}
function mappingReview(input, history) {
  const catalog = catalogFor(history); const sources = new Map();
  const exactBySource = new Map(catalog.map(item => [sourceId(item), item]));
  const byName = new Map();
  for (const item of catalog) {
    for (const key of nameAliases(item.name)) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(item);
    }
  }
  for (const exam of input.report.exams) for (const section of exam.sections) for (const item of section.items) {
    const source = { category: section.name, name: item.name, original: item.original || '' };
    const key = sourceId(source);
    if (!sources.has(key)) {
      if (sources.size >= 2000) throw invalid('Import at most 2,000 distinct measurements at a time.');
      const exact = exactBySource.get(key);
      const candidates = [...new Map(nameAliases(item.name).flatMap(alias => byName.get(alias) || []).map(item => [item.id, item])).values()];
      const sameCategory = candidates.filter(known => normalized(known.category) === normalized(section.name));
      // Missing/different side, frequency, specimen or source labels require review.
      const suggestion = exact || (sameCategory.length === 1 ? sameCategory[0] : candidates.length === 1 ? candidates[0] : null);
      sources.set(key, { ...source, key, suggested: suggestion?.id || 'new', certain: Boolean(exact), samples: [] });
    }
    sources.get(key).samples.push({ date: exam.exam_date, value: item.value ?? null, unit: item.unit || '', finding: item.finding || '' });
  }
  return { catalog, sources: [...sources.values()] };
}
function normalizeReport(input, history) {
  const review = mappingReview(input, history); const sources = new Map(review.sources.map(item => [item.key, item]));
  for (const key of Object.keys(input.mappings)) if (!sources.has(key)) throw invalid('Unknown measurement mapping.');
  const known = new Map(review.catalog.map(item => [item.id, item]));
  return input.report.exams.map(exam => {
    const result = { exam_date: exam.exam_date, measurements: [], sections: [] };
    for (const field of ['overall_rating', 'metabolic_syndrome_determination', 'institution', 'doctor']) if (exam[field] !== undefined) result[field] = exam[field];
    if (+exam.exam_date.slice(0, 4) === input.notesYear) {
      for (const field of noteFields) if (exam[field] !== undefined) result[field] = exam[field];
      if (result.report_notes === undefined && input.report.report?.notes !== undefined) result.report_notes = input.report.report.notes;
      for (const field of ['institution', 'doctor']) if (result[field] === undefined && input.report.patient?.[field] !== undefined) result[field] = input.report.patient[field];
    }
    const seen = new Set(); const sections = new Set();
    for (const section of exam.sections) {
      if (sections.has(section.name)) throw invalid('Repeated section names within an exam must be combined first.');
      sections.add(section.name);
      result.sections.push({ name: section.name, ...(section.original_japanese !== undefined ? { original_japanese: section.original_japanese } : {}), ...(section.section_rating !== undefined ? { section_rating: section.section_rating } : {}) });
      for (const item of section.items) {
        const source = { category: section.name, name: item.name, original: item.original || '' };
        const key = sourceId(source); const suggested = sources.get(key);
        const selection = input.mappings[key] ?? (suggested.certain ? suggested.suggested : null);
        if (!selection) throw invalid('Review each uncertain measurement mapping before continuing.');
        if (selection === 'skip') continue;
        const isNew = selection === 'new' || typeof selection === 'object';
        const category = typeof selection === 'object' ? selection.category : section.name;
        const target = isNew ? { ...source, category, id: sourceId({ ...source, category }) } : known.get(selection);
        if (!target) throw invalid('The selected measurement category does not exist.');
        if (seen.has(target.id)) throw invalid('Two measurements in the same exam map to one category. Choose distinct categories or skip one.');
        seen.add(target.id);
        result.measurements.push({ ...item, category: target.category, id: target.id });
      }
    }
    return result;
  });
}
// Work only with known schema fields, never client-provided database paths.
function makePlan(history, incoming, choices = {}) {
  const exams = structuredClone(history.exams); const conflicts = []; let addedExams = 0; let addedMeasurements = 0; let identical = 0; let changes = 0;
  function merge(target, source, prefix, labelText) {
    for (const [field, value] of Object.entries(source)) {
      if (['measurements', 'sections', 'id', 'exam_date'].includes(field)) continue;
      const existing = target[field] === undefined ? null : target[field];
      if (JSON.stringify(existing) === JSON.stringify(value) || (existing == null && value === '')) { identical++; continue; }
      const key = `${prefix}.${field}`;
      conflicts.push({ key, label: `${labelText} · ${field.replace(/_/g, ' ')}`, existing, incoming: value });
      if (choices[key] === 'import') { target[field] = value; changes++; }
    }
  }
  for (const source of incoming) {
    let target = exams.find(exam => exam.exam_date === source.exam_date);
    if (!target) {
      target = { ...Object.fromEntries(noteFields.map(field => [field, ''])), ...structuredClone(source) };
      exams.push(target); addedExams++; addedMeasurements += target.measurements.length; changes++; continue;
    }
    const prefix = source.exam_date;
    merge(target, source, prefix, prefix);
    for (const section of source.sections) {
      const current = target.sections.find(item => item.name === section.name);
      if (!current) { target.sections.push(structuredClone(section)); changes++; }
      else merge(current, section, `${prefix}.section.${sourceId({ category: section.name })}`, `${prefix} · ${section.name}`);
    }
    for (const item of source.measurements) {
      const current = target.measurements.find(entry => entry.id === item.id);
      if (!current) { target.measurements.push(structuredClone(item)); addedMeasurements++; changes++; }
      else merge(current, item, `${prefix}.${item.id}`, `${prefix} · ${item.category} / ${item.name} (${item.original || 'measurement'})`);
    }
  }
  exams.sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  if (conflicts.length > 20000) throw invalid('Too many changed fields. Import fewer exams at a time.');
  if (exams.length > 100 || exams.reduce((sum, exam) => sum + exam.measurements.length, 0) > 20000 || Buffer.byteLength(JSON.stringify(exams)) > 8 * 1024 * 1024) throw invalid('History exceeds the supported storage limit.');
  return { exams, conflicts, addedExams, addedMeasurements, identical, changes };
}
const secret = crypto.randomBytes(32);
function signature(ownerId, revision, incoming, timestamp) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify([String(ownerId), revision, incoming, timestamp])).digest('hex');
}
function createService(model) {
  async function read(ownerId) {
    const document = await model.findOne({ ownerId }).lean();
    return document ? { revision: document.revision, exams: document.exams } : { revision: 0, exams: [] };
  }
  async function review(ownerId, body, mappingOnly = false) {
    const input = parseRequest(body); const history = await read(ownerId);
    if (mappingOnly) return mappingReview(input, history);
    const incoming = normalizeReport(input, history); const plan = makePlan(history, incoming); const timestamp = Date.now();
    return { conflicts: plan.conflicts, addedExams: plan.addedExams, addedMeasurements: plan.addedMeasurements, identical: plan.identical,
      signature: `${timestamp}.${signature(ownerId, history.revision, incoming, timestamp)}` };
  }
  async function commit(ownerId, body) {
    const input = parseRequest(body); const history = await read(ownerId); const incoming = normalizeReport(input, history);
    const [stamp, supplied] = (input.signature || '').split('.'); const timestamp = Number(stamp);
    const expected = signature(ownerId, history.revision, incoming, timestamp);
    if (!/^\d{13}$/.test(stamp || '') || !/^[a-f0-9]{64}$/.test(supplied || '') || Date.now() - timestamp > 30 * 60 * 1000 || timestamp > Date.now()
      || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      const error = new Error('The review expired or the data changed. Review the upload again.'); error.status = 409; throw error;
    }
    const plan = makePlan(history, incoming, input.choices);
    const keys = new Set(plan.conflicts.map(conflict => conflict.key));
    if (plan.conflicts.some(conflict => !input.choices[conflict.key]) || Object.keys(input.choices).some(key => !keys.has(key))) throw invalid('Choose keep or import for every changed field.');
    if (!plan.changes) return { saved: false, message: 'No changes saved; identical entries were ignored.' };
    try {
      // Owner-derived _id also enforces uniqueness before the secondary index finishes building.
      if (!history.revision) await model.create({ _id: ownerId, ownerId, revision: 1, exams: plan.exams });
      else {
        const result = await model.updateOne({ ownerId, revision: history.revision }, { $set: { exams: plan.exams }, $inc: { revision: 1 } }, { runValidators: true });
        if (result.matchedCount !== 1) { const error = new Error('History changed while saving. Review the upload again.'); error.status = 409; throw error; }
      }
    } catch (error) {
      if (error.code === 11000) { const conflict = new Error('History changed while saving. Review the upload again.'); conflict.status = 409; throw conflict; }
      throw error;
    }
    return { saved: true, message: 'Reviewed health-check data saved.' };
  }
  return { read, review, commit };
}
module.exports = { createService, parseRequest, mappingReview, normalizeReport, makePlan, sourceId, noteFields };
