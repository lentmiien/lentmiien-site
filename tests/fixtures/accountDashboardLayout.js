// Synthetic content only; render the real dashboard and lazy Life log fragment.
const pug = require('pug');
const path = require('node:path');
const { SECTIONS } = require('../../services/accountSurfacePolicy');
const { createFormAssets } = require('../../utils/formAssets');
const root = path.resolve(__dirname, '../..');
const assets = createFormAssets();
const longText = 'Synthetic content with a long title and details. '.repeat(4) + 'unbroken'.repeat(30);
const settings = {
  sections: SECTIONS, hiddenSections: ['models'], collapsedSections: ['life', 'gateway'],
  jobs: { scope: 'mine', status: 'all', dateWindow: 7, types: [] }, jobTypes: [],
};
function renderDashboard(preferences = settings) {
  return pug.renderFile(path.join(root, 'views/mypage.pug'), {
    formAssetUrl: assets.url, loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [],
    csrfToken: 's'.repeat(43), dashboard: preferences,
  });
}
function cardData(id, count = 12) {
  return { ok: true, state: 'ready', fetchedAt: '2026-09-19T00:00:00Z', note: longText,
    rows: Array.from({ length: count }, (_, i) => ({
      title: `${id} ${i + 1}: ${longText}`, detail: longText, href: '/mypage',
      at: '2026-09-19T00:00:00Z', taskId: `synthetic-${i}`, canComplete: true,
      group: i % 2 ? 'Upcoming' : 'Ongoing', start: null, end: null,
    })),
  };
}
function renderLifePanel({ labels = [longText] } = {}) {
  return pug.renderFile(path.join(root, 'views/partials/account_life_log.pug'), {
    lifeLogPath: '/admin/life_log', lifeLogReminderCount: 12,
    lifeLogSuggestions: { all: labels, top: [longText], recent: [longText], timeOfDay: [longText] },
    lifeLogReminders: Array.from({ length: 12 }, (_, i) => ({
      reminderKey: `basic::synthetic-${i}`, type: 'basic', label: longText,
      typeLabel: 'Basic', statusLabel: 'Due', scheduleLabel: 'Daily', detailLabel: longText, dueDate: '2026-09-19',
    })),
  });
}
function lifeEntries(count = 12) {
  return { entries: Array.from({ length: count }, (_, i) => ({
    id: `synthetic-${i}`, timestamp: '2026-09-19T00:00:00Z', displayTimestamp: 'Sep 19, 09:00',
    v_log_data: { canvas: { width: 300, height: 200 }, points: [{ x: 0.5, y: 0.5, radius: 8, opacity: 80, category: 'a' }] },
  })) };
}
module.exports = { assets, settings, renderDashboard, cardData, renderLifePanel, lifeEntries };
