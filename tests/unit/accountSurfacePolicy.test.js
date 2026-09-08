const { resolvePolicy, allows, SECTIONS, NAVIGATION, navigationFor, bookmarkAllowed } = require('../../services/accountSurfacePolicy');
const prefs = require('../../services/accountPreferencesService');
const ownerId = '111111111111111111111111';
const otherId = '222222222222222222222222';
const principal = (role = 'admin', id = ownerId) => ({ _id: id, name: 'synthetic', type_user: role });
const roles = permissions => ({ findOne: jest.fn(async filter => filter.type === 'user' ? { permissions } : null) });
async function policy(role = 'admin', permissions = [], id = ownerId, owner = ownerId) { return resolvePolicy(principal(role, id), roles(permissions), owner); }

test('typed role lookups resist username/group collisions and re-evaluate revoked grants', async () => {
  let granted = true;
  const roleModel = { findOne: jest.fn(async q => q.type === 'user' && q.name === 'admin' && granted ? { permissions: ['chat5'] } : null) };
  const user = { ...principal('user'), name: 'admin' };
  const first = await resolvePolicy(user, roleModel, ownerId);
  expect(first.capabilities).toContain('chat5');
  expect(first.isAdmin).toBe(false);
  expect(roleModel.findOne.mock.calls).toEqual([[{ name: 'admin', type: 'user' }], [{ name: 'user', type: 'group' }]]);
  granted = false;
  expect((await resolvePolicy(user, roleModel, ownerId)).capabilities).not.toContain('chat5');
});
test.each(['', 'invalid', '123', 'g'.repeat(24), undefined])('missing/invalid owner binding %s fails closed', async binding => {
  const p = await resolvePolicy(principal(), roles(['accounting', 'budget', 'embedding']), binding === undefined ? '' : binding);
  expect(p.isOwner).toBe(false);
  expect(navigationFor(p).some(n => n.personal)).toBe(false);
  expect(prefs.effective(p).sections.some(n => n.personal)).toBe(false);
});
test('another admin cannot see personal cards, aliases, bookmark destinations or preference metadata', async () => {
  const p = await policy('admin', ['accounting', 'budget', 'embedding', 'health', 'receipt', 'payroll'], otherId);
  expect(SECTIONS.filter(s => allows(p, s)).some(s => s.personal)).toBe(false);
  expect(navigationFor(p).some(s => /\/(accounting|budget|health|receipt|payroll)|life_log|minute-logger/.test(s.href))).toBe(false);
  for (const path of ['/accounting', '/accounting/external-assets', '/budget/review', '/admin/life_log', '/admin/minute-logger', 'https://local.invalid/budget/cards']) expect(bookmarkAllowed(p, path)).toBe(false);
  const effective = prefs.effective(p, { sectionOrder: ['life', 'accounting'], hiddenSections: ['minute'] });
  expect(JSON.stringify(effective)).not.toMatch(/life_log|minute-logger|Accounting/);
});
test('owner admin needs existing tool grants; admin is not universal permission', async () => {
  const p = await policy();
  expect(allows(p, SECTIONS.find(s => s.id === 'accounting'))).toBe(false);
  expect(navigationFor(p).some(n => n.id === 'music')).toBe(false);
  expect(navigationFor(p).some(n => n.id === 'my_life_log')).toBe(true);
  const granted = await policy('admin', ['accounting', 'budget', 'embedding']);
  for (const id of ['accounting', 'embedding', 'life', 'minute']) expect(allows(granted, SECTIONS.find(s => s.id === id))).toBe(true);
});
test.each(['user', 'family'])('%s gets existing general generation and explicit grants only', async role => {
  const p = await policy(role, ['ocr']);
  const ids = navigationFor(p).map(n => n.id);
  expect(ids).toEqual(expect.arrayContaining(['gpt_image', 'prompt_to_3d', 'trellis2', 'pixal3d', 'ocr']));
  expect(ids).not.toContain('music'); expect(ids).not.toContain('my_life_log');
  expect(prefs.jobTypesFor(p, 'mine')).not.toEqual(expect.arrayContaining(['music', 'sora', 'bulk']));
});
test('unknown role needs explicit semantic dashboard grant', async () => {
  expect(navigationFor(await policy('unknown')).filter(n => !n.public)).toHaveLength(0);
  expect(navigationFor(await policy('unknown', ['dashboard.account.read', 'ocr'])).some(n => n.id === 'ocr')).toBe(true);
});
test('catalog consolidates exact URLs and retains stable old IDs', () => {
  expect(new Set(NAVIGATION.map(n => n.href)).size).toBe(NAVIGATION.length);
  expect(NAVIGATION.map(n => n.id)).toEqual(expect.arrayContaining(['accounting', 'credit_card', 'my_life_log', 'minute_logger', 'image_gen', 'gpt_image']));
});
test('legacy shortcut migration is read-only and full catalog includes hidden shortcuts', async () => {
  const settings = { order: ['gpt_image', 'learning'], hidden: ['gpt_image'] };
  const before = JSON.stringify(settings);
  const nav = navigationFor(await policy('user'), settings);
  expect(nav[0]).toMatchObject({ id: 'gpt_image', hidden: true });
  expect(JSON.stringify(settings)).toBe(before);
});
test('save/reset preserves invisible settings and effective response filters them', async () => {
  const p = await policy('user');
  const previous = { sectionOrder: ['accounting'], hiddenSections: ['accounting'], collapsedSections: ['life'] };
  const saved = prefs.saveSettings({ ...prefs.normalize(), sectionOrder: ['jobs'] }, previous, p);
  expect(saved.hiddenSections).toContain('accounting');
  expect(prefs.effective(p, saved).hiddenSections).not.toContain('accounting');
  const nav = prefs.saveNavigation({ reset: true }, { hidden: ['accounting'] }, p);
  expect(nav.hidden).toContain('accounting');
});
test.each([{ userId: otherId }, [], { version: 99 }, { ...prefs.normalize(), sectionOrder: ['jobs', 'jobs'] }, { ...prefs.normalize(), jobs: { ...prefs.DEFAULT_JOBS, dateWindow: 99999 } }, { ...prefs.normalize(), jobs: { ...prefs.DEFAULT_JOBS, scope: 'all' } }])('rejects malformed preferences %#', async input => {
  const p = await policy('user'); expect(() => prefs.saveSettings(input, {}, p)).toThrow();
});

test('owner with Budget grant uses its existing alias without requiring Accounting grant', async () => {
  const p = await policy('admin', ['budget']);
  expect(prefs.effective(p).sections.find(s => s.id === 'accounting').href).toBe('/budget');
});
