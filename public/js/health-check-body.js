/* Body areas organize report findings; unknown categories stay in Other tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./health-check-analytics'));
  else root.HealthCheckBody = factory(root.HealthCheckAnalytics);
})(typeof globalThis === 'object' ? globalThis : this, function (analytics) {
  'use strict';
  const areas = [
    { id: 'eyes', label: 'Eyes & vision', short: 'Eyes', icon: 'eye' },
    { id: 'ears', label: 'Hearing', short: 'Hearing', icon: 'ear' },
    { id: 'lungs', label: 'Lungs & chest', short: 'Lungs', icon: 'lungs' },
    { id: 'heart', label: 'Heart & circulation', short: 'Heart', icon: 'pulse' },
    { id: 'liver', label: 'Liver', short: 'Liver', icon: 'liver' },
    { id: 'stomach', label: 'Stomach & upper GI', short: 'Stomach', icon: 'stomach' },
    { id: 'pancreas', label: 'Pancreas', short: 'Pancreas', icon: 'pancreas' },
    { id: 'kidneys', label: 'Kidneys & urine', short: 'Kidneys', icon: 'kidneys' },
    { id: 'bowel', label: 'Bowel', short: 'Bowel', icon: 'bowel' },
    { id: 'systemic', label: 'Blood & whole body', short: 'Whole body', icon: 'body' },
    { id: 'other', label: 'Other tests', short: 'Other', icon: 'report' },
  ];
  const ranks = { muted: 0, success: 1, info: 2, warning: 3, danger: 4 };
  function tone(item) {
    const status = analytics.status(item);
    const rating = String(item.rating || '').trim().toUpperCase();
    if (/^(C(?:3|6)?|D|E|F)$/.test(rating)) return 'danger';
    if (status.outside || ['B', 'H', 'L'].includes(rating)) return 'warning';
    if (rating === 'T') return 'info';
    if (status.flagged) return 'warning';
    if (rating === 'A' || status.label === 'Within range') return 'success';
    return 'muted';
  }
  function areaFor(item) {
    const category = String(item.category || '').toLowerCase();
    const name = String(item.name || '').toLowerCase();
    if (/eye|vision|ophthalm/.test(category)) return 'eyes';
    if (/hearing|audiom/.test(category)) return 'ears';
    if (/lung|chest|pulmonary|respiratory/.test(category)) return 'lungs';
    if (/blood pressure|lipid|ecg|electrocardio|cardiac|cardiovascular/.test(category)) return 'heart';
    if (/liver|hepatic/.test(category)) return 'liver';
    if (/upper gi|stomach|gastric|gastroscop/.test(category)) return 'stomach';
    if (/stool|bowel|colorectal|colonoscopy/.test(category)) return 'bowel';
    if (/urine|urinary|renal/.test(category)) return 'kidneys';
    if (/pancreas|kidney|gout/.test(category)) {
      if (/amylase|lipase|pancrea/.test(name)) return 'pancreas';
      if (/creatinine|egfr|urea|bun|kidney/.test(name)) return 'kidneys';
      // Uric acid and a mixed section's unspecified tests stay body-wide.
      if (/gout|\//.test(category)) return 'systemic';
      return category.includes('kidney') ? 'kidneys' : 'pancreas';
    }
    if (/body|glucose|diabet|blood|hematolog|haematolog|serolog|metabol/.test(category)) return 'systemic';
    return 'other';
  }
  function assess(exam) {
    return areas.map(area => {
      const items = exam.measurements.filter(item => areaFor(item) === area.id);
      const categories = new Set(items.map(item => item.category));
      const sections = (exam.sections || []).filter(section => categories.has(section.name)
        && !/pancreas.*kidney|kidney.*pancreas/i.test(section.name)
        && section.section_rating && !['-', '—'].includes(section.section_rating));
      const evidence = [...items, ...sections.map(section => ({ rating: section.section_rating }))];
      const strongest = evidence.reduce((best, item) => ranks[tone(item)] > ranks[tone(best)] ? item : best, {});
      return { ...area, items, sections, tone: tone(strongest), rating: strongest.rating || '',
        flags: items.filter(item => analytics.status(item).outside || analytics.status(item).flagged).length };
    });
  }
  return { areas, areaFor, assess, tone, ranks };
});
