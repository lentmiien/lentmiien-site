// Synthetic UI preview only: no environment, application server, database or providers.
// node scripts/preview-health-check.js -> http://127.0.0.1:4183/health-check
// Add ?years=13 on the dashboard to preview a longer history.
const express = require('express');
const path = require('path');
const { status } = require('../public/js/health-check-analytics');
const app = express();
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'pug');
app.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  Object.assign(res.locals, { loggedIn: false, gtag: false, bookmarks: [], htmlPaths: [], csrfToken: 'a'.repeat(43), pageTitle: 'Health check · synthetic design preview' });
  next();
});
app.use(express.static(path.join(__dirname, '../public')));
const definitions = [
  ['weight', 'Body measurements', 'Weight', '体重', 'kg', '50-80', 73, 1.2],
  ['bmi', 'Body measurements', 'Body mass index (BMI)', 'BMI', 'kg/m²', '18.5-24.9', 23.4, .2],
  ['waist', 'Body measurements', 'Waist circumference', '腹囲', 'cm', 'below 85', 83, 1.5],
  ['systolic', 'Blood pressure', 'Systolic blood pressure', '最高血圧', 'mmHg', 'below 130', 131, 2],
  ['diastolic', 'Blood pressure', 'Diastolic blood pressure', '最低血圧', 'mmHg', 'below 85', 79, 1],
  ['ldl', 'Lipids', 'LDL cholesterol', 'LDL', 'mg/dL', '60-119', 127, 4],
  ['hdl', 'Lipids', 'HDL cholesterol', 'HDL', 'mg/dL', '40 or higher', 57, 2],
  ['triglycerides', 'Lipids', 'Triglycerides', '中性脂肪', 'mg/dL', '30-149', 112, -5],
  ['glucose', 'Glucose', 'Fasting glucose', '血糖', 'mg/dL', '70-99', 92, 1],
  ['alt', 'Liver function', 'ALT (GPT)', 'ALT', 'U/L', '0-30', 24, 3],
  ['ast', 'Liver function', 'AST (GOT)', 'AST', 'U/L', '0-30', 22, -1],
  ['creatinine', 'Pancreas / kidney / gout', 'Creatinine', 'クレアチニン', 'mg/dL', '0.6-1.1', .9, .02],
  ['egfr', 'Pancreas / kidney / gout', 'eGFR', 'eGFR', 'mL/min', '60 or higher', 91, -.5],
  ['amylase', 'Pancreas / kidney / gout', 'Amylase', 'アミラーゼ', 'U/L', '40-120', 78, 4],
];
function history(years) {
  return Array.from({ length: years }, (_, index) => {
    const year = 2027 - years + index;
    const measurements = definitions.map(([id, category, name, original, unit, reference_range, value, step]) => {
      const item = { id, category, name, original, unit, reference_range, value: Number((value + (year - 2024) * step).toFixed(2)), description: 'Synthetic measurement provided for layout and interaction review.' };
      item.rating = status(item).outside ? 'H' : 'A';
      return item;
    });
    for (const [id, category, name] of [['eyes', 'Eye', 'Visual examination'], ['hearing', 'Hearing', 'Hearing test'], ['lungs', 'Chest X-ray', 'Chest X-ray'], ['ecg', 'ECG', 'Electrocardiogram'], ['stomach', 'Upper GI', 'Upper GI examination'], ['bowel', 'Stool', 'Occult blood'], ['urine', 'Urine', 'Urine protein']]) measurements.push({ id, category, name, finding: 'No abnormal finding', rating: 'A' });
    const sections = [...new Set(measurements.map(item => item.category))].map(name => ({ name, section_rating: name === 'Lipids' && year === 2026 ? 'C6' : 'A' }));
    return { exam_date: `${year}-04-12`, overall_rating: year === 2026 ? 'C6' : 'B', institution: 'Example clinic · synthetic preview', doctor: 'Example clinician',
      overall_comment: 'This is a fictional report used to review the dashboard design. Some measurements are outside the example reference ranges; explore the trend cards to see their history.',
      doctor_comment: 'Synthetic note: review the results at the next routine appointment.', metabolic_comment: '', doctor_judgment: '', report_notes: '', sections, measurements };
  });
}
app.get('/health-check/api/history', (req, res) => {
  const years = req.get('referer')?.includes('years=13') ? 13 : 3;
  res.json({ revision: 1, exams: history(years) });
});
app.get('/health-check', (req, res) => res.render('health_check'));
app.get('/health-check/upload', (req, res) => res.render('health_check_upload'));
const server = app.listen(4183, '127.0.0.1', () => process.stdout.write('Synthetic preview: http://127.0.0.1:4183/health-check\n'));
server.on('error', () => {
  require('../utils/logger').error('Health-check preview could not start; check whether port 4183 is available', { category: 'health_check_preview' });
  process.exitCode = 1;
});
process.on('SIGTERM', () => server.close());
