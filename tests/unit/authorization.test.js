const { hasPermission } = require('../../utils/authorization');

describe('hasPermission', () => {
  test('accepts either a user-specific or group permission', async () => {
    const roleModel = {
      findOne: jest.fn()
        .mockResolvedValueOnce({ permissions: ['chat5'] })
        .mockResolvedValueOnce({ permissions: [] }),
    };

    await expect(hasPermission(
      { name: 'work-user', type_user: 'user' },
      'chat5',
      { roleModel }
    )).resolves.toBe(true);
    expect(roleModel.findOne).toHaveBeenCalledWith({ name: 'work-user', type: 'user' });
    expect(roleModel.findOne).toHaveBeenCalledWith({ name: 'user', type: 'group' });
  });

  test('denies users without the requested permission', async () => {
    const roleModel = {
      findOne: jest.fn().mockResolvedValue({ permissions: ['chat4'] }),
    };

    await expect(hasPermission(
      { name: 'work-user', type_user: 'user' },
      'chat5',
      { roleModel }
    )).resolves.toBe(false);
  });

  test('fails closed for incomplete principals', async () => {
    await expect(hasPermission(null, 'chat5', { roleModel: {} })).resolves.toBe(false);
    await expect(hasPermission(
      { type_user: 'admin' },
      'chat5',
      { roleModel: { findOne: jest.fn() } }
    )).resolves.toBe(false);
  });
});
