const mongoose = require('mongoose');
const sharp = require('sharp');
const { Group } = require('../../models/document_vault');
const { pageContext, groupContext, parseOutput, reviewFields } = require('../../services/documentVault/content');
const { validateScan } = require('../../services/documentVault/scans');
const { enqueue, finishJob, reviewPage, redoPage, canManage, canRead } = require('../../services/documentVault/workflow');
const { BUNDLES, INTAKE, READ, REVIEW, RESUME } = require('../../services/documentVault/policy');
const { APP_SETTING_KEYS, DEFAULT_APP_SETTINGS } = require('../../services/appSettingsService');
const { hasCapabilities } = require('../../utils/authorization');

const receipt = {
  englishText: 'One admission ticket', documentDate: '2026-01-02', title: 'Ticket',
  tags: ['travel'], description: 'A train ticket.', totalAmount: 0, currency: 'JPY',
};
const owner = new mongoose.Types.ObjectId();
const uploader = new mongoose.Types.ObjectId();
const viewer = new mongoose.Types.ObjectId();
function create(pages = 1) {
  const group = new Group({ ownerId: owner, uploaderId: uploader, viewerIds: [viewer], state: 'ready',
    pages: Array.from({ length: pages }, () => ({ filename: 'scan.png' })) });
  for (const page of group.pages) enqueue(group, 'ocr', uploader, page._id, true, INTAKE);
  return group;
}
function complete(group, output) {
  const job = group.jobs[0];
  finishJob(group, job._id, 'success', output);
  expect(group.jobs.id(job._id)).toBeNull();
}
const response = value => ({ choices: [{ message: { content: JSON.stringify(value) } }] });

test('single-page descriptions mirror reviewed edits and all three redo choices preserve the right source', async () => {
  const group = create();
  const page = group.pages[0];
  complete(group, '乗車券');
  complete(group, receipt);
  expect(group.jobs).toHaveLength(0);
  expect(group.description).toBe(receipt.description);
  reviewPage(group, page, uploader, page.revision, { ...receipt, description: 'Corrected ticket.', physical: { decision: 'keep', yearLabel: '2026', folderId: 'A', groupLabel: 'Rail' } });
  expect(group.description).toBe('Corrected ticket.');
  expect(page.state).toBe('stored');
  expect(canRead(group, page, uploader)).toBeFalsy();
  expect(canRead(group, page, viewer)).toBeTruthy();
  expect(canManage(group, page, viewer)).toBeFalsy();
  expect(canManage(group, page, owner)).toBeTruthy();

  redoPage(group, page, owner, page.revision, 'ocr');
  expect(canRead(group, page, uploader)).toBeFalsy();
  complete(group, '乗車券 改訂');
  expect(page).toMatchObject({ state: 'review', ocrText: '乗車券 改訂', description: 'Corrected ticket.' });
  expect(group.jobs).toHaveLength(0);
  redoPage(group, page, owner, page.revision, 'chat');
  complete(group, receipt);
  expect(page.ocrText).toBe('乗車券 改訂');
  redoPage(group, page, owner, page.revision, 'both');
  complete(group, '最終版');
  expect(group.jobs[0].kind).toBe('chat');
  complete(group, receipt);
  reviewPage(group, page, owner, page.revision, { ...receipt, physical: { decision: 'dispose' } });
  expect(page.toObject().physical).toEqual({ decision: 'dispose' });
  await expect(group.validate()).resolves.toBeUndefined();
});

test('a concurrent edit supersedes a running group description and stale review forms cannot overwrite regeneration', () => {
  const group = create(2);
  complete(group, 'Page 1');
  complete(group, 'Page 2');
  complete(group, receipt);
  complete(group, receipt);
  const old = group.jobs[0]._id;
  const page = group.pages[0];
  const revision = page.revision;
  reviewPage(group, page, owner, revision, { ...receipt, description: 'A corrected description.', physical: { decision: 'dispose' } });
  expect(group.jobs[0]._id).not.toEqual(old);
  finishJob(group, old, 'success', { description: 'Outdated summary.' });
  expect(group.description).toBeNull();
  expect(group.jobs).toHaveLength(1);
  expect(() => redoPage(group, page, owner, revision, 'chat')).toThrow('changed');
  complete(group, { description: 'Current summary.' });
  expect(group.description).toBe('Current summary.');
  expect(page.state).toBe('stored');
  expect(group.pages[1].state).toBe('review');
});

test('classifies only validated structured output and accepts zero or unknown receipt amounts', () => {
  expect(pageContext).toMatch(/translate Japanese/i);
  expect(groupContext).toMatch(/English/);
  expect(parseOutput('chat', response(receipt))).toEqual(receipt);
  expect(parseOutput('chat', response({ ...receipt, totalAmount: null }))).toMatchObject({ totalAmount: null, currency: null });
  for (const invalid of [{ ...receipt, documentDate: '2026-02-31' }, { ...receipt, tags: 'a' }, { ...receipt, ownerId: 'x' }]) {
    expect(() => parseOutput('chat', response(invalid))).toThrow();
  }
  expect(() => parseOutput('group', { choices: [{ message: { content: '{"description":"x"}', tool_calls: ['tool'] } }] })).toThrow();
  const valid = { ...receipt, tags: 'travel, rail', totalAmount: '0', decision: 'keep', yearLabel: '2026', folderId: 'A', groupLabel: 'Rail' };
  expect(reviewFields(valid)).toMatchObject({ tags: ['travel', 'rail'], totalAmount: 0, physical: { folderId: 'A' } });
  for (const change of [{ decision: '' }, { folderId: '' }, { totalAmount: 'NaN' }, { documentDate: 'bad' }]) {
    expect(() => reviewFields({ ...valid, ...change })).toThrow();
  }
  expect(reviewFields({ ...valid, decision: 'dispose' }).physical).toEqual({ decision: 'dispose' });
});

test('upload decoder checks the format, declared type, size and content of every page', async () => {
  const png = await sharp({ create: { width: 4, height: 5, channels: 3, background: 'white' } }).png().toBuffer();
  const file = { buffer: png, originalname: 'page.png', mimetype: 'image/png' };
  await expect(validateScan(file)).resolves.toBe('page.png');
  // A real two-frame PNG, which the default sharp PNG loader reports as one page.
  const animated = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAADAAAAAwAAAAAAAAAAAMgD6AAA2pumOgAAABdJREFUeJxj/P//PwMDAwMDAxMDDCBYAFQkAwMiWiEqAAAAGmZjVEwAAAABAAAAAwAAAAMAAAAAAAAAAADIA+gAAEHoTO4AAAAPZmRBVAAAAAJ4nGNgwAcAAB4AAXBcJAkAAAAASUVORK5CYII=', 'base64');
  await expect(validateScan({ ...file, buffer: animated })).rejects.toHaveProperty('status', 422);
  for (const change of [{ originalname: 'page.svg' }, { mimetype: 'image/jpeg' }, { mimetype: 'image/jpeg', originalname: 'page.jpg' },
    { buffer: Buffer.from('<svg/>') }, { buffer: png.subarray(0, 20) }, { buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }]) {
    await expect(validateScan({ ...file, ...change })).rejects.toHaveProperty('status');
  }
});

test('all standard account bundles can file and review; global resume requires a separate grant', async () => {
  for (const type_user of ['admin', 'family', 'user']) {
    const user = { name: 'reader', type_user };
    const options = { roleCapabilityBundles: BUNDLES };
    await expect(hasCapabilities(user, [READ, REVIEW, INTAKE], options)).resolves.toBe(true);
    await expect(hasCapabilities(user, [RESUME], options)).resolves.toBe(type_user === 'admin');
  }
  const options = { roleCapabilityBundles: BUNDLES, roleModel: { findOne: async () => ({ permissions: [READ] }) } };
  await expect(hasCapabilities({ name: 'guest', type_user: 'custom' }, [READ], options)).resolves.toBe(true);
  await expect(hasCapabilities({ name: 'guest', type_user: 'custom' }, [INTAKE], options)).resolves.toBe(false);
  expect(DEFAULT_APP_SETTINGS).toContainEqual(expect.objectContaining({ key: APP_SETTING_KEYS.VAULT_CHAT_MODEL, value: 'qwen3.8:27b' }));
});

test('reviewers can correct a generated group summary without overwriting a newer revision', () => {
  const group = create(2);
  complete(group, 'one');
  complete(group, 'two');
  complete(group, receipt);
  complete(group, receipt);
  complete(group, { description: 'Generated description.' });
  const revision = group.descriptionRevision;
  const fields = { ...receipt, physical: { decision: 'dispose' } };
  reviewPage(group, group.pages[0], owner, group.pages[0].revision, fields, { revision, text: 'Verified group.' });
  expect(group.description).toBe('Verified group.');
  expect(group.jobs).toHaveLength(0);
  expect(() => reviewPage(group, group.pages[1], owner, group.pages[1].revision, fields, { revision, text: 'Stale edit' })).toThrow('changed');
  expect(group.pages[1].state).toBe('review');
});
