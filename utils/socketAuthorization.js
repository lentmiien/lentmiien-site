const { hasPermission } = require('./authorization');

async function authorizeSocketSession(session, {
  userModel,
  roleModel,
  permission = 'chat5',
  now = Date.now(),
} = {}) {
  const userId = session?.passport?.user;
  const parsedExpiry = session?.cookie?.expires ? new Date(session.cookie.expires) : null;
  const sessionExpiresAt = parsedExpiry && Number.isFinite(parsedExpiry.getTime())
    ? parsedExpiry.getTime()
    : null;

  if (!userId || !sessionExpiresAt || sessionExpiresAt <= now) {
    return { ok: false, reason: 'Unauthorized' };
  }

  const user = await userModel.findOne({ _id: userId });
  if (!user) {
    return { ok: false, reason: 'Unauthorized' };
  }
  const permissionGranted = permission
    ? await hasPermission(user, permission, { roleModel })
    : true;

  return {
    ok: true,
    userName: user.name,
    sessionExpiresAt,
    permissionGranted,
  };
}

module.exports = { authorizeSocketSession };
