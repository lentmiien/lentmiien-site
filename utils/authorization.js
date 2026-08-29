async function hasPermission(user, permission, { roleModel } = {}) {
  if (!user || !roleModel || typeof permission !== 'string' || !permission) {
    return false;
  }

  const [userRole, groupRole] = await Promise.all([
    roleModel.findOne({ name: user.name, type: 'user' }),
    roleModel.findOne({ name: user.type_user, type: 'group' }),
  ]);

  return [userRole, groupRole].some((role) =>
    Array.isArray(role?.permissions) && role.permissions.includes(permission)
  );
}

module.exports = { hasPermission };
