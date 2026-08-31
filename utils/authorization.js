function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) {
    return [];
  }

  return Array.from(new Set(
    capabilities.filter((capability) => typeof capability === 'string' && capability.length > 0)
  ));
}

function hasCompletePrincipal(user) {
  return Boolean(
    user
    && typeof user.name === 'string'
    && user.name.trim()
    && typeof user.type_user === 'string'
    && user.type_user.trim()
  );
}

function roleBundleCapabilities(user, roleCapabilityBundles) {
  if (!hasCompletePrincipal(user) || !roleCapabilityBundles || typeof roleCapabilityBundles !== 'object') {
    return [];
  }

  return normalizeCapabilities(roleCapabilityBundles[user.type_user]);
}

async function loadAssignedCapabilities(user, roleModel) {
  if (!hasCompletePrincipal(user) || !roleModel || typeof roleModel.findOne !== 'function') {
    return [];
  }

  const [userRole, groupRole] = await Promise.all([
    roleModel.findOne({ name: user.name, type: 'user' }),
    roleModel.findOne({ name: user.type_user, type: 'group' }),
  ]);

  return normalizeCapabilities([
    ...(Array.isArray(userRole?.permissions) ? userRole.permissions : []),
    ...(Array.isArray(groupRole?.permissions) ? groupRole.permissions : []),
  ]);
}

async function hasCapabilities(user, capabilities, {
  roleModel,
  roleCapabilityBundles,
} = {}) {
  const requiredCapabilities = normalizeCapabilities(capabilities);
  if (!hasCompletePrincipal(user) || requiredCapabilities.length === 0) {
    return false;
  }

  const bundledCapabilities = roleBundleCapabilities(user, roleCapabilityBundles);
  if (requiredCapabilities.every((capability) => bundledCapabilities.includes(capability))) {
    return true;
  }

  const assignedCapabilities = await loadAssignedCapabilities(user, roleModel);
  const availableCapabilities = new Set([
    ...bundledCapabilities,
    ...assignedCapabilities,
  ]);
  return requiredCapabilities.every((capability) => availableCapabilities.has(capability));
}

async function hasPermission(user, permission, { roleModel } = {}) {
  if (typeof permission !== 'string' || !permission) {
    return false;
  }

  return hasCapabilities(user, [permission], { roleModel });
}

module.exports = {
  hasCapabilities,
  hasCompletePrincipal,
  hasPermission,
  loadAssignedCapabilities,
  normalizeCapabilities,
  roleBundleCapabilities,
};
