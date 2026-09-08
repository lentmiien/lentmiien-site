const { loadAssignedCapabilities, hasCompletePrincipal, roleBundleCapabilities } = require('../utils/authorization');
const { CODEX_ROLE_CAPABILITY_BUNDLES } = require('../utils/codexAuthorizationPolicy');
const { RUNPOD_ROLE_CAPABILITY_BUNDLES } = require('../utils/runpodAuthorizationPolicy');
const { MYPAGE_ICON_DEFINITIONS } = require('./mypageIconService');
const extras = require('./accountNavigationExtras.json');
const { CHAT_TOOL_ROLE_CAPABILITY_BUNDLES } = require('../utils/chatToolAuthorizationPolicy');
const { getSoraLifecycle } = require('../utils/soraLifecycle');

const { MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../utils/miienAuthorizationPolicy');

const BASE = ['dashboard.account.read', 'dashboard.preferences.write'];
const ADMIN = ['dashboard.operations.read', 'dashboard.personal.read', 'dashboard.personal.write', 'dashboard.embedding.search'];
const ROLE_BUNDLES = { admin: [...BASE, ...ADMIN], family: BASE, user: BASE };
const PERSONAL_PATH = /^\/(?:accounting|budget|receipt|payroll|health)(?:\/|$)|^\/admin\/(?:life_log|minute-logger)(?:\/|$)/;
const GROUPS = ['Chat & knowledge', 'Create & generate', 'Documents & utilities', 'Plan & household', 'Personal account', 'Content & learning', 'Operations', 'Administration'];
function groupFor(item) {
  const p = item.href;
  if (PERSONAL_PATH.test(p)) return GROUPS[4];
  if (/^\/admin\/(runpod|ai-gateway|tapo|disasters|ask-lennart)/.test(p) || p === '/codex') return GROUPS[6];
  if (p.startsWith('/admin') || p === '/tmp-files' || p === '/codex-log-review') return GROUPS[7];
  if (/^\/chat/.test(p)) return GROUPS[0];
  if (/^\/(gpt-image|image_gen|music|sora|qwen3|trellis|pixal|prompt-to|lego)/.test(p)) return GROUPS[1];
  if (/^\/(cooking|scheduleTask|es|shopping-list|reminders)/.test(p)) return GROUPS[3];
  if (/^\/(blog|learning|games)/.test(p) || p === '/mypage/blogpost') return GROUPS[5];
  return GROUPS[2];
}
const NAVIGATION = MYPAGE_ICON_DEFINITIONS.map(item => ({ ...item, public: false }));
NAVIGATION.push({ id: 'chat5_miien', href: '/chat5/miien', label: 'Miien character chat', src: '/i/miien/neutral.webp', capability: 'chat.conversation.read', subgroup: 'Chat5 tools' });
for (const item of extras) {
  const existing = NAVIGATION.find(x => x.href === item.href);
  if (existing) continue;
  NAVIGATION.push({ ...item, id: `nav_${item.href.replace(/[^a-z0-9]/gi, '_')}`, src: '/i/product.svg' });
}
NAVIGATION.push({ id: 'personal_health', href: '/health', label: 'Health records', permissions: ['health'], src: '/i/health.svg' });
for (const item of NAVIGATION) {
  item.group = groupFor(item);
  item.subgroup = item.subgroup || ({ [GROUPS[0]]: 'Conversations', [GROUPS[1]]: 'Studios', [GROUPS[6]]: 'Monitoring' }[item.group] || 'Tools');
  item.personal = PERSONAL_PATH.test(item.href);
  if (item.id === 'batch') item.permissions = ['chat4'];
  if (item.id === 'ask_lennart') item.capability = 'human.request.manage';
  if (item.id === 'runpod') item.capability = 'runpod.pod.read';
}
const SECTIONS = [
  ['tasks', 'To do & to buy', '/scheduleTask/upcoming', 'scheduletask'],
  ['agenda', 'Today’s agenda', '/scheduleTask/calendar', 'scheduletask'],
  ['cooking', 'Today’s cooking', '/cooking/v2', 'cooking'],
  ['chats', 'Your recent chats', '/chat5/top', 'chat5'],
  ['jobs', 'Recent tool activity', '/mypage'],
  ['ask', 'Ask Lennart', '/admin/ask-lennart', null, 'human.request.manage'],
  ['codex', 'Running Codex', '/codex', null, 'codex.turn.read'],
  ['accounting', 'Accounting', '/accounting', 'accounting'],
  ['life', 'My Life Log', '/admin/life_log'],
  ['minute', 'Minute Logger', '/admin/minute-logger'],
  ['disaster', 'Disaster & weather', '/admin/disasters'],
  ['runpod', 'Tracked Runpod pods', '/admin/runpod', null, 'runpod.pod.read'],
  ['tapo', 'Household energy', '/admin/tapo'],
  ['gateway', 'AI Gateway', '/admin/ai-gateway'],
  ['stock', 'Household emergency stock', '/es/es_dashboard', 'emergencystock'],
  ['models', 'New AI models', '/chat5/ai_model_cards', 'chat5'],
  ['embedding', 'Search your mixed knowledge corpus', '/mypage/embedding-search', 'embedding', 'dashboard.embedding.search'],
].map(([id, title, href, permission, capability]) => ({
  id, title, href, permissions: permission ? [permission] : [], capability,
  personal: ['accounting', 'life', 'minute', 'embedding'].includes(id),
  adminOnly: ['ask', 'codex', 'life', 'minute', 'disaster', 'runpod', 'tapo', 'gateway', 'models'].includes(id),
  collapsed: ['life', 'gateway', 'models', 'embedding'].includes(id),
  scope: ['cooking', 'tapo', 'stock'].includes(id) ? 'Shared household' : ['ask', 'codex', 'disaster', 'runpod', 'gateway', 'models'].includes(id) ? 'Operations' : 'Your account',
}));
SECTIONS.find(s => s.id === 'accounting').permissions = [];
SECTIONS.find(s => s.id === 'accounting').anyPermissions = ['accounting', 'budget'];
function reportPersonalConfiguration() {
  if (!/^[a-f\d]{24}$/i.test(process.env.DASHBOARD_PERSONAL_OWNER_USER_ID || '')) {
    require('../utils/logger').warning('Personal dashboard surfaces disabled: configure DASHBOARD_PERSONAL_OWNER_USER_ID with the confirmed account ID', { category: 'account_dashboard' });
  }
}
function ownerMatches(user, configured = process.env.DASHBOARD_PERSONAL_OWNER_USER_ID) {
  return typeof configured === 'string' && /^[a-f\d]{24}$/i.test(configured)
    && /^[a-f\d]{24}$/i.test(String(user?._id || ''))
    && String(user._id).toLowerCase() === configured.toLowerCase();
}
async function resolvePolicy(user, roleModel, ownerId) {
  if (!hasCompletePrincipal(user) || !user._id) return { user: null, capabilities: [], isAdmin: false, isOwner: false };
  const assigned = await loadAssignedCapabilities(user, roleModel);
  return {
    user, isAdmin: user.type_user === 'admin', isOwner: ownerMatches(user, ownerId),
    capabilities: [...new Set([...assigned, ...roleBundleCapabilities(user, ROLE_BUNDLES),
      ...roleBundleCapabilities(user, MIIEN_ROLE_CAPABILITY_BUNDLES), ...roleBundleCapabilities(user, CHAT_TOOL_ROLE_CAPABILITY_BUNDLES), ...roleBundleCapabilities(user, CODEX_ROLE_CAPABILITY_BUNDLES), ...roleBundleCapabilities(user, RUNPOD_ROLE_CAPABILITY_BUNDLES)])],
  };
}
function allows(policy, item) {
  if (item.public) return true;
  if (!policy.user || !policy.capabilities.includes('dashboard.account.read')) return false;
  if (item.adminOnly && !policy.isAdmin) return false;
  if (item.scope === 'Operations' && !policy.capabilities.includes('dashboard.operations.read')) return false;
  if (item.personal && (!policy.isOwner || !policy.capabilities.includes('dashboard.personal.read'))) return false;
  if (item.anyPermissions && !item.anyPermissions.some(p => policy.capabilities.includes(p))) return false;
  if (item.capability && !policy.capabilities.includes(item.capability)) return false;
  return (item.permissions || []).every(p => policy.capabilities.includes(p));
}
function bookmarkAllowed(policy, url) {
  try {
    const rawPath = decodeURIComponent(new URL(url, 'https://local.invalid').pathname);
    const path = rawPath.toLowerCase().replace(/^\/mypage\/life_log(?=\/|$)/, '/admin/life_log');
    if (!PERSONAL_PATH.test(path)) return true;
    const candidates = NAVIGATION.filter(n => n.personal && (path === n.href || path.startsWith(n.href + '/')));
    return candidates.some(n => allows(policy, n));
  } catch (_) { return false; }
}
function navigationFor(policy, settings = {}) {
  const order = Array.isArray(settings.order) ? settings.order : [];
  const hidden = Array.isArray(settings.hidden) ? settings.hidden : [];
  return NAVIGATION.filter(item => allows(policy, item) && (item.href !== '/login' || !policy.user)).map(item => ({ ...item, hidden: hidden.includes(item.id),
    meta: item.id === 'sora' && getSoraLifecycle().generationDisabled ? 'Library · generation stopped' : null,
  })).sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : 999) - (order.includes(b.id) ? order.indexOf(b.id) : 999));
}
module.exports = { BASE, ROLE_BUNDLES, GROUPS, NAVIGATION, SECTIONS, reportPersonalConfiguration, bookmarkAllowed, ownerMatches, resolvePolicy, allows, navigationFor };
