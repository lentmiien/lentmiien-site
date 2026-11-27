const { CAP: localAi } = require('../services/localAi/policy');
const { BUNDLES: vault } = require('../services/documentVault/policy');
const { ROLE_BUNDLES: dashboard } = require('../services/accountSurfacePolicy');
const { CODEX_CAPABILITIES: codex } = require('./codexAuthorizationPolicy');
const { CHAT_TOOL_CAPABILITIES: chatTools } = require('./chatToolAuthorizationPolicy');
const { RUNPOD_CAPABILITIES: runpod } = require('./runpodAuthorizationPolicy');
const { MIIEN_ROLE_CAPABILITY_BUNDLES: miien } = require('./miienAuthorizationPolicy');
const { ROLE_BUNDLES: commons } = require('./commonsAuthorizationPolicy');
const { CAPABILITIES: music } = require('./musicAuthorizationPolicy');
const { CAPABILITIES: packing } = require('./smallestBoxPolicy');
const { CAPABILITIES: thumbnails } = require('./imageGenThumbnailPolicy');
const { GPT_IMAGE_CAPABILITIES: gptImage } = require('./gptImageAuthorizationPolicy');
const { CAPABILITIES: account } = require('./userSettingsPolicy');
const { SECURITY_CAPABILITY } = require('./twoFactorSession');
const { ROLE_BUNDLES: disasters } = require('./disasterPolicy');
const { ROLE_BUNDLES: health } = require('./healthCheckPolicy');
const { RECIPE_READ } = require('./cookbookReadPolicy');
const { MANAGE: batchManage } = require('./batchAuthorizationPolicy');
const { CAPABILITY: decisions } = require('./decisionsAuthorizationPolicy');
const { MANAGE: taricManage } = require('./taricAuthorizationPolicy');
const { IMPORT: amiamiImport } = require('./amiamiUploadPolicy');

// List interactive role grants here. Machine-token scopes and bundle-only
// checks that do not consult stored roles are outside the editor's scope.
const emberwake = require('../services/emberwake/policy').BUNDLES;

const catalog = {
  'Account & dashboard': [
    ...account, SECURITY_CAPABILITY, ...dashboard.admin.filter(key => key.startsWith('dashboard.')),
    'admin.password_reminders.request',
  ],
  'AI gateway & models': ['openai', 'embedding', decisions, 'ai_gateway.monitor.read', 'ai.model_cards.manage', batchManage],
  'Chat & conversations': ['chat', 'chat2', 'chat3', 'chat4', 'chat5', ...miien.admin, 'chat.conversation.export'],
  'Codex & human requests': [...Object.values(codex), ...Object.values(chatTools)],
  'Commons': commons.admin,
  'Emberwake Together': emberwake.admin,
  'Documents & OCR': ['archive', 'gptdocument', 'ocr', 'ocr.jobs.test_models', ...vault.admin],
  'Finance': [
    'accounting', 'budget', 'payroll', 'receipt', ...dashboard.admin.filter(key => key.startsWith('finance.')),
    'finance.receipt.read', 'finance.receipt.write',
  ],
  'Health & household': [
    'cooking', RECIPE_READ, 'health', ...health.admin, 'emergencystock', 'shoppinglist',
    'scheduletask', 'schedule.task.complete', 'quicknote',
  ],
  'Images, music & video': [
    'asr', 'gallery', 'image_gen', 'music', 'sora', ...Object.values(thumbnails),
    ...Object.values(gptImage), ...Object.values(music),
  ],
  'Inventory & packing': [
    'binpacking', 'box', 'product', ...Object.values(packing), amiamiImport,
    'amiami.items.read', 'amiami.items.merge', taricManage,
  ],
  'Local AI': Object.values(localAi),
  'Monitoring & diagnostics': [...disasters.admin, 'monitoring.connectivity.read', 'test'],
  'Runpod': Object.values(runpod),
};

function permissionGroups(roles) {
  const groups = Object.entries(catalog).map(([name, permissions]) => ({
    name, permissions: [...permissions].sort(),
  }));
  const known = new Set(groups.flatMap(group => group.permissions));
  const additional = new Set(roles.flatMap(role => role.permissions).filter(permission => !known.has(permission)));
  if (additional.size) groups.push({ name: 'Other stored permissions', permissions: [...additional].sort() });
  return groups;
}

module.exports = { permissionGroups };
