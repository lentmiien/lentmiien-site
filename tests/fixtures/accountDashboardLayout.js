// Synthetic content only; render the real dashboard and lazy Life log fragment.
const pug = require('pug');
const path = require('node:path');
const { SECTIONS } = require('../../services/accountSurfacePolicy');
const { OVERVIEW_SECTIONS } = require('../../services/accountOverviewData');
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
    formAssetUrl: assets.url, loggedIn: true, permissions: ['account.profile.read'], bookmarks: [], htmlPaths: [],
    csrfToken: 's'.repeat(43), dashboard: preferences,
    overviewSections: OVERVIEW_SECTIONS, accountContext: 'Your account', accountDate: 'Saturday, October 24',
  });
}
function overviewData() {
  const row = (title, detail, href, at = null) => ({ title, detail, href, at });
  const groups = [
    { id: 'tasks', count: 4, rows: [row('Collect the parcel', 'To do', '/scheduleTask/upcoming', '2026-10-24T08:00:00Z'), row('Buy fresh vegetables', 'Buy', '/scheduleTask/upcoming', '2026-10-24T10:00:00Z')] },
    { id: 'cooking', count: 2, rows: [row('Miso salmon', 'Dinner', '/cooking/cookbook/synthetic'), row('Cucumber salad', 'Side dish', '/cooking/cookbook/synthetic')] },
    { id: 'life', count: 1, rows: [row('Evening walk', 'Basic · Due today', '/admin/life_log')] },
    { id: 'accounting', count: 1, rows: [row('Household account', 'Finalize September 2026', '/accounting/close-month/')] },
    { id: 'ask', count: 3, rows: [row('General request', 'Pending', '/admin/ask-lennart', '2026-10-24T00:30:00Z'), row('Codex request', 'Pending', '/admin/ask-lennart', '2026-10-24T01:00:00Z')] },
    { id: 'codex', count: 2, rows: [row('Polish recipe search', 'Running', '/codex/sessions/synthetic', '2026-10-24T03:00:00Z'), row('Review account layout', 'Queued', '/codex/sessions/synthetic', '2026-10-24T03:10:00Z')] },
    { id: 'chats', count: 3, rows: [row('Weekend meal planning', '', '/chat5/chat/synthetic', '2026-10-24T03:20:00Z'), row('Ideas for the garden', '', '/chat5/chat/synthetic', '2026-10-24T02:15:00Z')] },
  ];
  return { ok: true, fetchedAt: '2026-10-24T04:00:00Z', groups: groups.map(g => ({ ...g, state: 'ready' })) };
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
module.exports = { assets, settings, renderDashboard, cardData, overviewData, renderLifePanel, lifeEntries };
