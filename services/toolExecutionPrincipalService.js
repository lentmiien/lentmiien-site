const Useraccount = require('../models/useraccount');
const Role = require('../models/role');
const logger = require('../utils/logger');
const {
  hasCapabilities,
  hasCompletePrincipal,
  normalizeCapabilities,
} = require('../utils/authorization');
const {
  CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
} = require('../utils/chatToolAuthorizationPolicy');

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function serializePrincipal(user) {
  if (!hasCompletePrincipal(user)) {
    return null;
  }
  const id = user._id || user.id;
  if (!id) {
    return null;
  }
  return {
    _id: String(id),
    name: String(user.name),
    type_user: String(user.type_user),
  };
}

async function executeQuery(query) {
  let current = query;
  if (current && typeof current.select === 'function') {
    current = current.select({ _id: 1, name: 1, type_user: 1 });
  }
  if (current && typeof current.lean === 'function') {
    current = current.lean();
  }
  if (current && typeof current.exec === 'function') {
    return current.exec();
  }
  return current;
}

async function resolveToolPrincipal(context = {}, { userModel = Useraccount } = {}) {
  const suppliedPrincipal = serializePrincipal(context.user);
  if (!suppliedPrincipal) {
    throw createHttpError(403, 'This tool requires an authenticated application user.');
  }

  if (!userModel || typeof userModel.findById !== 'function') {
    throw createHttpError(503, 'Tool authorization is temporarily unavailable.');
  }

  const account = await executeQuery(userModel.findById(suppliedPrincipal._id));
  const principal = serializePrincipal(account);
  if (!principal || principal._id !== suppliedPrincipal._id) {
    throw createHttpError(403, 'This tool requires an authenticated application user.');
  }
  return principal;
}

async function assertToolCapability(principal, capabilityInput, {
  roleModel = Role,
  roleCapabilityBundles = CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
  appLogger = logger,
} = {}) {
  const capabilities = normalizeCapabilities(
    Array.isArray(capabilityInput) ? capabilityInput : [capabilityInput]
  );
  if (!capabilities.length) {
    throw createHttpError(500, 'The tool authorization policy is not configured correctly.');
  }
  let allowed = false;
  try {
    allowed = await hasCapabilities(principal, capabilities, {
      roleModel,
      roleCapabilityBundles,
    });
  } catch (error) {
    await appLogger.error('Chat tool capability lookup failed', {
      category: 'authorization',
      metadata: {
        capabilityCount: capabilities.length,
        errorName: error?.name || 'Error',
      },
    });
    throw createHttpError(503, 'Tool authorization is temporarily unavailable.');
  }

  if (!allowed) {
    throw createHttpError(403, 'You do not have permission to use this tool.');
  }
}

async function resolveAuthorizedToolPrincipal(context, capability, options = {}) {
  let principal;
  try {
    principal = await resolveToolPrincipal(context, options);
  } catch (error) {
    if (error?.statusCode) throw error;
    await (options.appLogger || logger).error('Chat tool principal lookup failed', {
      category: 'authorization',
      metadata: { errorName: error?.name || 'Error' },
    });
    throw createHttpError(503, 'Tool authorization is temporarily unavailable.');
  }
  await assertToolCapability(principal, capability, options);
  return principal;
}

module.exports = {
  assertToolCapability,
  createHttpError,
  resolveAuthorizedToolPrincipal,
  resolveToolPrincipal,
  serializePrincipal,
};
