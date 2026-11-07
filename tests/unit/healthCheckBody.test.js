const { areaFor, assess, tone } = require('../../public/js/health-check-body');

test('report grades and ranges determine color without inventing a normal result', () => {
  expect(tone({ rating: 'A', value: 20, reference_range: '0-10' })).toBe('warning');
  expect(tone({ rating: 'C6' })).toBe('danger');
  expect(tone({ rating: 'T' })).toBe('info');
  expect(tone({ rating: 'A' })).toBe('success');
  expect(tone({ value: 10 })).toBe('muted');
  expect(tone({ value: 10, reference_range: '5-15' })).toBe('success');
  expect(tone({ rating: 'Unfamiliar rating' })).toBe('warning');
});

test('mixed kidney/pancreas reports keep organ-specific measurements distinct', () => {
  const category = 'Pancreas / kidney / gout';
  expect(areaFor({ category, name: 'Creatinine' })).toBe('kidneys');
  expect(areaFor({ category, name: 'Amylase' })).toBe('pancreas');
  expect(areaFor({ category, name: 'Uric acid' })).toBe('systemic');
  expect(areaFor({ category: 'Blood (hematology)', name: 'WBC' })).toBe('systemic');
  expect(areaFor({ category: 'Urine sediment', name: 'WBC' })).toBe('kidneys');
  expect(areaFor({ category: 'Unknown hospital section', name: 'Test' })).toBe('other');
});

test('worst associated report grade is shown and no history is borrowed for absent organs', () => {
  const areas = assess({ sections: [{ name: 'Liver function', section_rating: 'C6' }], measurements: [
    { category: 'Liver function', name: 'ALT', value: 20, reference_range: '0-30', rating: 'A' },
    { category: 'Liver function', name: 'AST', value: 50, reference_range: '0-30' },
  ] });
  expect(areas.find(area => area.id === 'liver')).toMatchObject({ tone: 'danger', rating: 'C6', flags: 1 });
  expect(areas.find(area => area.id === 'kidneys')).toMatchObject({ tone: 'muted', items: [], rating: '' });
});

test('mixed section grade is not attributed to every organ in that section', () => {
  const areas = assess({ sections: [{ name: 'Pancreas / kidney / gout', section_rating: 'D' }], measurements: [
    { category: 'Pancreas / kidney / gout', name: 'Creatinine', value: 1, reference_range: '0.5-1.1', rating: 'A' },
    { category: 'Pancreas / kidney / gout', name: 'Amylase', value: 150, reference_range: '0-100', rating: 'H' },
  ] });
  expect(areas.find(area => area.id === 'kidneys').tone).toBe('success');
  expect(areas.find(area => area.id === 'pancreas').tone).toBe('warning');
});
