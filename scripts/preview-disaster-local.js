// Development-only synthetic preview. Never imports app.js/database.js or contacts providers.
// Run with: node scripts/preview-disaster-local.js; browse http://127.0.0.1:4179
const express = require('express');
const { buildSummary, key } = require('../services/disasterLocalSummaryService');
const { createFormAssets } = require('../utils/formAssets');
const app = express();
app.set('views', 'views'); app.set('view engine', 'pug');
const forms = createFormAssets();
app.locals.formAssetUrl = forms.url;
app.get('/assets/forms/:revision/:filename', forms.serve);
const now = new Date('2026-10-25T02:15:00Z');
const records = [
  { _id: key('weather'), data: { temperatureC: 21.4, feelsLikeC: 21.9, humidityPercent: 64, windSpeedMs: 2.3, precipitationMm: 0,
    observedAt: now, source: 'openweathermap-current', weatherCode: '800', isDay: true, description: 'Clear sky' } },
  { _id: key('warnings'), data: { at: now, coverage: true, hazards: [] } },
  { _id: key('health'), data: { at: now, ok: true } },
  { _id: key('earthquake'), data: { at: now, intensity: '1', nationalMax: '2', magnitude: 4 } },
];
const summary = buildSummary(records, now);
app.use((req, res, next) => { Object.assign(res.locals, { loggedIn: false, bookmarks: [], htmlPaths: [], csrfToken: 'a'.repeat(43), gtag: false }); next(); });
app.use(express.static('public'));
app.get('/admin/disasters', (req, res) => res.render('admin_disaster_dashboard', { summary, feedback: null, pageTitle: 'Synthetic local preview',
  formatDateTimeLong: value => value ? new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unavailable' }));
app.get('/mypage', (req, res) => res.render('mypage', { pageTitle: 'Synthetic account preview', dashboard: { sections: [{ id: 'disaster', title: 'Disaster & weather', href: '/admin/disasters', scope: 'Operations' }],
  hiddenSections: [], collapsedSections: [], jobs: { types: [] }, jobTypes: [] }, overviewSections: [], navChoices: [] }));
app.get('/mypage/api/cards/disaster', (req, res) => res.json({ ok: true, state: summary.state, fetchedAt: now.toISOString(), summary, rows: [], note: summary.warnings.note }));
app.post('/admin/disasters/refresh', (req, res) => res.status(202).json({ ok: true, message: 'Synthetic preview: refresh UX confirmed; no source work was started.' }));
app.get('/art', (req, res) => {
  const { assets } = require('../public/i/disaster/v3/manifest.json');
  res.send(`<html lang="en"><head><title>Original disaster illustrations</title><style>body{background:#0E0F13;color:#E8ECF2;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}figure{margin:0}img{width:100%}</style></head><body><h1>Local conditions · original vector collection</h1><main>${assets.map(a => `<figure><img src="${a.url}" alt=""><figcaption>${a.group} / ${a.condition}</figcaption></figure>`).join('')}</main></body></html>`);
});
const server = app.listen(4179, '127.0.0.1', () => console.log('Synthetic preview at http://127.0.0.1:4179/admin/disasters'));
process.on('SIGTERM', () => server.close());
