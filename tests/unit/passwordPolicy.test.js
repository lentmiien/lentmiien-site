const { passwordReminder, meetsPasswordRequirements } = require('../../utils/passwordPolicy');
const User = require('../../models/useraccount');

test.each([
  ['2026-01-31T12:34:56Z', '2026-07-31T12:34:56Z'],
  ['2026-08-31T12:34:56Z', '2027-02-28T12:34:56Z'],
  ['2023-08-31T12:34:56Z', '2024-02-29T12:34:56Z'],
  ['2026-03-01T00:00:00Z', '2026-09-01T00:00:00Z'],
])('six calendar months from %s expire after %s', (changed, due) => {
  const user = { password_changed_at: new Date(changed) };
  expect(passwordReminder(user, new Date(new Date(due).getTime() - 1))).toBe('');
  expect(passwordReminder(user, new Date(due))).toBe('');
  expect(passwordReminder(user, new Date(new Date(due).getTime() + 1))).toContain('more than six months');
});

test('missing history and admin requests prompt; recent passwords do not', () => {
  expect(passwordReminder({})).toContain('do not have a record');
  expect(passwordReminder({ password_changed_at: 'invalid' })).toContain('do not have a record');
  expect(passwordReminder({ password_changed_at: new Date() })).toBe('');
  expect(passwordReminder({ password_changed_at: new Date(), password_change_requested: true })).toContain('administrator');
  const legacy = new User({ name: 'fixture', email: 'fixture@example.invalid', type_user: 'user', hash_password: 'synthetic' });
  expect(legacy.password_changed_at).toBeNull();
  expect(passwordReminder(legacy)).toContain('do not have a record');
});

test.each(['abcdefghijkl1!', 'ABCDEFGHIJKL1!', 'Abcdefghijkl!!', 'Abcdefghijkl12', 'Aa1!short', 'Aa123456789\u0000', 'Aa1' + ' '.repeat(12), 'Aa1' + '日'.repeat(12), 'Aa1!' + '日'.repeat(23)])('password rules reject %s', value => {
  expect(meetsPasswordRequirements(value)).toBe(false);
});
test.each(['Abcdefghij1!', 'Aa1!' + '日'.repeat(22) + 'ab', 'Long passphrase 1!'])('password rules accept %s', value => {
  expect(meetsPasswordRequirements(value)).toBe(true);
});
