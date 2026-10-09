const { hasCapabilities } = require('../../utils/authorization');
const { ROLE_BUNDLES, OPERATIONS, SHELTER, DIARY_READ, DIARY_WRITE } = require('../../utils/commonsAuthorizationPolicy');
const { resolvePolicy, allows, SECTIONS } = require('../accountSurfacePolicy');
const SHELTER_ADMIN_ID = '5dd115006b7f671c2009709d';
const shelterIdentity = user => user?.type_user === 'family'
  || user?.type_user === 'admin' && String(user._id) === SHELTER_ADMIN_ID;
async function permitted(user, surface, roleModel) {
  const has = capabilities => hasCapabilities(user, capabilities, { roleModel, roleCapabilityBundles: ROLE_BUNDLES });
  if (surface === 'hall' || surface === 'diagnostics') return user.type_user === 'admin' && has([OPERATIONS]);
  if (surface === 'statistics') return user.type_user === 'admin' && has([OPERATIONS]);
  if (surface === 'shelter' || surface === 'stock') return shelterIdentity(user) && has([SHELTER, 'emergencystock']);
  if (surface === 'diary') return has([DIARY_READ]);
  if (surface === 'diary-save') return has([DIARY_READ, DIARY_WRITE]);
  if (surface === 'quests' || surface === 'quest-done') {
    const policy = await resolvePolicy(user, roleModel);
    if (!allows(policy, SECTIONS.find(s => s.id === 'tasks'))) return false;
    return surface === 'quests' || hasCapabilities(user, ['schedule.task.complete'], { roleModel,
      roleCapabilityBundles: { admin: ['schedule.task.complete'], family: ['schedule.task.complete'], user: ['schedule.task.complete'] } });
  }
  return false;
}
module.exports = { permitted, shelterIdentity, SHELTER_ADMIN_ID };
