const { hasCapabilities } = require('../../utils/authorization');
const { resolveAuthorizedToolPrincipal } = require('../../services/toolExecutionPrincipalService');
const {
  CHAT_TOOL_ADMIN_CAPABILITIES,
  CHAT_TOOL_CAPABILITIES,
  CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
} = require('../../utils/chatToolAuthorizationPolicy');

function roleModel({ userPermissions = [], groupPermissions = [] } = {}) {
  return {
    findOne: jest.fn(({ type }) => Promise.resolve({
      permissions: type === 'user' ? userPermissions : groupPermissions,
    })),
  };
}

describe('Chat tool semantic capability policy', () => {
  test('assigns every Codex and human-request capability to admin explicitly', async () => {
    const model = roleModel();

    await expect(hasCapabilities(
      { _id: 'admin-1', name: 'Admin', type_user: 'admin' },
      CHAT_TOOL_ADMIN_CAPABILITIES,
      { roleModel: model, roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES }
    )).resolves.toBe(true);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  test.each(['family', 'user', 'other'])(
    'denies the %s role without an explicit grant',
    async (typeUser) => {
      await expect(hasCapabilities(
        { _id: `${typeUser}-1`, name: typeUser, type_user: typeUser },
        [CHAT_TOOL_CAPABILITIES.codexReadOnly],
        {
          roleModel: roleModel(),
          roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
        }
      )).resolves.toBe(false);
    }
  );

  test('accepts a narrowly granted non-admin principal', async () => {
    const model = roleModel({ userPermissions: [CHAT_TOOL_CAPABILITIES.humanRequestManage] });

    await expect(hasCapabilities(
      { _id: 'operator-1', name: 'Operator', type_user: 'user' },
      [CHAT_TOOL_CAPABILITIES.humanRequestManage],
      { roleModel: model, roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES }
    )).resolves.toBe(true);
  });

  test('does not let a workspace-write grant imply yolo execution', async () => {
    const model = roleModel({
      userPermissions: [CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite],
    });

    await expect(hasCapabilities(
      { _id: 'developer-1', name: 'Developer', type_user: 'user' },
      [CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite, CHAT_TOOL_CAPABILITIES.codexYolo],
      { roleModel: model, roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES }
    )).resolves.toBe(false);
  });

  test('does not treat a conversation member name as an authenticated principal', async () => {
    const userModel = { findById: jest.fn() };

    await expect(resolveAuthorizedToolPrincipal(
      { userName: 'Admin' },
      CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite,
      {
        userModel,
        roleModel: roleModel(),
        roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
      }
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(userModel.findById).not.toHaveBeenCalled();
  });

  test('reloads the initiating account before applying current capabilities', async () => {
    const accountQuery = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        _id: 'user-1',
        name: 'Former Admin',
        type_user: 'user',
      }),
    };
    const userModel = { findById: jest.fn(() => accountQuery) };

    await expect(resolveAuthorizedToolPrincipal(
      { user: { _id: 'user-1', name: 'Former Admin', type_user: 'admin' } },
      CHAT_TOOL_CAPABILITIES.codexWorkspaceWrite,
      {
        userModel,
        roleModel: roleModel(),
        roleCapabilityBundles: CHAT_TOOL_ROLE_CAPABILITY_BUNDLES,
      }
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(userModel.findById).toHaveBeenCalledWith('user-1');
  });
});
