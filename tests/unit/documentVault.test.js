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

test('the Invoice switch owns the reserved tag and requires a numeric total, including zero', () => {
  const fields = { ...receipt, decision: 'dispose', tags: 'rail, INVOICE, Invoice, invoice copy', totalAmount: '' };
  expect(reviewFields(fields)).toMatchObject({ tags: ['rail', 'invoice copy'], totalAmount: null });
  expect(() => reviewFields({ ...fields, invoice: 'on' })).toThrow('receipt total');
  expect(() => reviewFields({ ...fields, invoice: 'on', totalAmount: 'NaN' })).toThrow();
  expect(reviewFields({ ...fields, invoice: 'on', totalAmount: '0' })).toMatchObject({
    tags: ['rail', 'invoice copy', 'invoice'], totalAmount: 0,
  });
  expect(reviewFields({ ...fields, totalAmount: '500' })).toMatchObject({ tags: ['rail', 'invoice copy'], totalAmount: 500 });
});

test('accepts one validated object inside a fence or explanatory text', () => {
  const page = { ...receipt, englishText: 'Quoted "name", {code}, [value]\nnext line' };
  const content = 'Here is the result:\n```json\n' + JSON.stringify(page) + '\n```\nEnd.';
  expect(parseOutput('chat', { choices: [{ message: { content } }] })).toEqual(page);
  const summary = 'The summary is {"description":"Rail ticket."} as requested.';
  expect(parseOutput('group', { choices: [{ message: { content: summary } }] })).toEqual({ description: 'Rail ticket.' });
});

test.each([
  ['  ', 'empty_reply'],
  ['```json\n{"description":oops}\n```', 'invalid_fenced_json'],
  [String.raw`{"description":"bad\q"}`, 'invalid_json'],
  ['{"description":"one"} {"description":"two"}', 'invalid_json'],
  ['[{"description":"not an object"}]', 'schema_mismatch'],
  ['[{"description":"unfinished array"}', 'invalid_json'],
  ['{"title":"private"}', 'schema_mismatch'],
])('keeps the exact failed reply and a content-free reason (%#)', (content, reason) => {
  expect(() => parseOutput('group', { choices: [{ message: { content } }] })).toThrow(
    expect.objectContaining({ message: reason, reply: { reason, raw: content, clipped: false } }));
});

test('preserves unexpected and truncated messages and bounds retained text', () => {
  for (const [message, finish_reason, reason] of [
    [{ content: '{"description":"partial"}' }, 'length', 'token_limit'],
    [{ content: '', thinking: 'No final answer' }, 'stop', 'empty_reply'],
    [{ content: [{ text: 'unexpected' }] }, 'stop', 'unexpected_content'],
    [{ content: '', tool_calls: [{}] }, 'stop', 'unexpected_tool_call'],
  ]) {
    expect(() => parseOutput('group', { choices: [{ message, finish_reason }] })).toThrow(expect.objectContaining({
      reply: { reason, raw: typeof message.content === 'string' && Object.keys(message).length === 1 ? message.content : JSON.stringify(message), clipped: false },
    }));
  }
  const content = 'x'.repeat(150000);
  expect(() => parseOutput('chat', { choices: [{ message: { content } }] })).toThrow(expect.objectContaining({
    reply: { reason: 'reply_too_long', clipped: true, raw: content.slice(0, 128 * 1024) },
  }));
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

test('a redo left in review at the upload deadline restores the previously filed transcript and summary', () => {
  const { EDIT_WINDOW, filingLocked, restoreExpired } = require('../../services/documentVault/workflow');
  const group = create();
  const uploaded = Date.now() - EDIT_WINDOW + 60000;
  group.createdAt = new Date(uploaded);
  const page = group.pages[0];
  complete(group, 'Original OCR');
  complete(group, receipt);
  reviewPage(group, page, owner, page.revision, { ...receipt, physical: { decision: 'dispose' } });
  redoPage(group, page, owner, page.revision, 'both');
  complete(group, 'Replacement OCR');
  complete(group, { ...receipt, title: 'Unapproved', description: 'Changed draft.' });
  const clock = jest.spyOn(Date, 'now');
  try {
    clock.mockReturnValue(uploaded + EDIT_WINDOW - 1);
    expect(filingLocked(group, page)).toBe(false);
    clock.mockReturnValue(uploaded + EDIT_WINDOW);
    expect(filingLocked(group, page)).toBe(true);
    restoreExpired(group);
    expect(page).toMatchObject({ state: 'stored', ocrText: 'Original OCR', title: receipt.title });
    expect(group.description).toBe(receipt.description);
    expect(page.beforeRedo).toBeUndefined();
    expect(group.beforeRedoDescription).toBeUndefined();
    expect(group.jobs).toHaveLength(0);
  } finally { clock.mockRestore(); }
});

test('OCR overlap normalizes Japanese spacing and weights repeated pairs at the 85 percent boundary', () => {
  const { overlap, characterPairs, THRESHOLD } = require('../../services/documentVault/duplicates');
  const score = (a, b) => overlap(characterPairs(a), characterPairs(b));
  expect(score('領　収　証：ＡＢＣ', '領収証abc')).toBe(100);
  expect(score('   ', '   ')).toBe(0);
  expect(score('領', '証')).toBe(0);
  expect(score('aaaa', 'aa')).toBe(50);
  const left = 'abcdefghijklmnopqrstu';
  expect(score(left, 'abcdefghijklmnopqrXYZ')).toBe(THRESHOLD);
  expect(score(left, 'abcdefghijklmnopqWXYZ')).toBeLessThan(THRESHOLD);
});
