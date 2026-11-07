/* Shared deterministic display logic; no clinical advice or inferred reference limits. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HealthCheckAnalytics = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const notes = { overall_comment: 'Overall result', doctor_comment: 'Doctor’s note', metabolic_comment: 'Metabolic syndrome', doctor_judgment: 'Lifestyle guidance', report_notes: 'Report notes' };
  function parseRange(value) {
    if (typeof value !== 'string') return null;
    const source = value.toLowerCase().trim().replace(/[−]/g, '-');
    const number = '(-?\\d+(?:\\.\\d+)?)';
    let match = source.match(new RegExp(`^${number}\\s*[-–~〜]\\s*${number}$`));
    if (match) return +match[1] <= +match[2] ? { min: +match[1], max: +match[2] } : null;
    match = source.match(new RegExp(`^(<=|≤|<|below|under|>=|≥|>|above|over)\\s*${number}$`));
    if (match) return ['<=', '≤', '<', 'below', 'under'].includes(match[1])
      ? { max: +match[2], maxExclusive: ['<', 'below', 'under'].includes(match[1]) }
      : { min: +match[2], minExclusive: ['>', 'above', 'over'].includes(match[1]) };
    match = source.match(new RegExp(`^${number}\\s+(or below|or less|or lower|or higher|or more|or above)(?:\\s*\\([^)]*\\))?$`));
    if (match) return /below|less|lower/.test(match[2]) ? { max: +match[1] } : { min: +match[1] };
    return null;
  }
  function status(item) {
    const range = parseRange(item.reference_range);
    let numeric = null;
    if (range && typeof item.value === 'number') {
      if (range.min !== undefined && (item.value < range.min || (range.minExclusive && item.value === range.min))) numeric = 'Below range';
      else if (range.max !== undefined && (item.value > range.max || (range.maxExclusive && item.value === range.max))) numeric = 'Above range';
      else numeric = 'Within range';
    }
    const rating = String(item.rating || '').trim().toUpperCase();
    const flaggedRating = rating && !['A', '-', '—', 'NORMAL'].includes(rating);
    return { label: numeric || (flaggedRating ? `Reported ${rating}` : 'Not classified'), outside: ['Below range', 'Above range'].includes(numeric), flagged: Boolean(flaggedRating), range };
  }
  function trends(exams) {
    const groups = new Map();
    for (const exam of [...exams].sort((a, b) => a.exam_date.localeCompare(b.exam_date))) {
      for (const item of exam.measurements) {
        if (typeof item.value !== 'number') continue;
        const key = `${item.id}|${item.unit || ''}`;
        if (!groups.has(key)) groups.set(key, { key, id: item.id, name: item.name, original: item.original, category: item.category, unit: item.unit || '', points: [] });
        groups.get(key).points.push({ date: exam.exam_date, value: item.value, reference: item.reference_range || '', status: status(item) });
      }
    }
    return [...groups.values()];
  }
  function summary(exam) {
    const lines = [`Health check — ${exam.exam_date}`, '', 'Outside the recorded reference range:'];
    const outside = exam.measurements.filter(item => status(item).outside);
    const describe = item => `- ${item.category} / ${item.name}${item.original ? ` (${item.original})` : ''}: ${item.value ?? item.finding ?? 'No value'} ${item.unit || ''}; range: ${item.reference_range || 'not recorded'}; rating: ${item.rating || 'not recorded'}`;
    lines.push(...(outside.length ? outside.map(describe) : ['None detected among values with a supported numeric reference range.']));
    const flagged = exam.measurements.filter(item => status(item).flagged && !status(item).outside);
    if (flagged.length) lines.push('', 'Other reported flags (not necessarily outside a numeric range):', ...flagged.map(describe));
    const unknown = exam.measurements.filter(item => typeof item.value === 'number' && !status(item).range).length;
    if (unknown) lines.push('', `${unknown} numeric measurements have no supported reference range; they were not classified as normal.`);
    if (exam.overall_rating) lines.push('', `Overall rating: ${exam.overall_rating}`);
    if (exam.metabolic_syndrome_determination) lines.push(`Metabolic syndrome determination: ${exam.metabolic_syndrome_determination}`);
    for (const [field, title] of Object.entries(notes)) if (exam[field]) lines.push('', `${title}:`, exam[field]);
    if (!Object.keys(notes).some(field => exam[field])) lines.push('', 'No notes recorded for this exam.');
    return lines.join('\n');
  }
  return { notes, parseRange, status, trends, summary };
});
