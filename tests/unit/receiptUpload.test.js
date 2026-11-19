const express = require('express');
const path = require('node:path');
const sharp = require('sharp');
const mockComplete = jest.fn();
jest.mock('openai', () => jest.fn(() => ({ chat: { completions: { create: mockComplete } } })));
jest.mock('../../utils/openaiModelDeprecation', () => ({ assertOpenAIModelActive: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn(async () => null) }));
jest.mock('../../database', () => ({ Receipt: { findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/budgetService', () => ({}));
jest.mock('../../services/creditCardService', () => ({}));

const { Receipt } = require('../../database');
const logger = require('../../utils/logger');
let owner;
const other = '507f191e810c19729de860eb';
const token = 'R'.repeat(43);
const stored = new Map();
let site, server, firstImage, secondImage;
const details = date => ({ choices: [{ message: { content: JSON.stringify({
  date, time: '10:00', total_amount: 123, payment_method: 'cash', business_info: { name: 'PRIVATE shop', address: '' },
}) } }] });

beforeAll(async () => {
  const app = express();
  app.set('views', path.resolve(__dirname, '../../views'));
  app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.session = { csrfToken: token };
    req.user = { _id: req.get('x-test-account') || owner, name: 'fixture', type_user: req.get('x-test-role') || 'admin' };
    res.locals.user = req.user;
    next();
  });
  app.use('/receipt', require('../../routes/receipt'));
  const makeImage = background => sharp({ create: { width: 20, height: 40, channels: 3, background } }).png().toBuffer();
  [firstImage, secondImage] = await Promise.all([makeImage('white'), makeImage('blue')]);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  site = 'http://127.0.0.1:' + server.address().port + '/receipt';
});

beforeEach(() => {
  owner = new (require('mongoose').Types.ObjectId)().toString();
  stored.clear();
  mockComplete.mockReset();
  Receipt.findOne.mockImplementation(filter => {
    const entry = stored.get(filter._id);
    const allowed = entry && (filter.ownerId ? filter.ownerId === entry.ownerId && filter.uploadDigest === entry.uploadDigest
      : filter.$or.some(clause => clause.ownerId === entry.ownerId));
    return { then: resolve => resolve(allowed ? entry : null), select: async () => allowed ? entry : null };
  });
  Receipt.create.mockImplementation(async entry => {
    if (stored.has(entry._id)) throw Object.assign(new Error(), { code: 11000 });
    stored.set(entry._id, entry);
    return entry;
  });
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

function upload(bytes, { headers = {}, date, native = false } = {}) {
  const form = new FormData();
  bytes.forEach(buffer => form.append('imgs', new Blob([buffer], { type: 'image/png' }), 'PRIVATE.png'));
  if (date) form.append('purchase_date', date);
  if (native) form.append('_csrf', token);
  return fetch(site + '/upload_receipt', {
    method: 'POST', body: form,
    headers: { ...(native ? {} : { Accept: 'application/json', 'X-CSRF-Token': token }), ...headers },
  });
}

test('mixed upload isolates invalid calendar dates, saves a private JPEG, and replays only the failed extraction', async () => {
  mockComplete.mockResolvedValueOnce(details('2026-02-30')).mockResolvedValueOnce(details('2026-11-12'));
  const mixed = await upload([firstImage, secondImage]);
  expect(mixed.status).toBe(207);
  const body = await mixed.json();
  expect(body.failures).toEqual([{ index: 0, field: 'date', kind: 'invalid_date', message: expect.any(String) }]);
  expect(body.receipts).toHaveLength(1);
  const id = body.receipts[0].id;
  expect(logger.warning).toHaveBeenCalledWith('Receipt file failed validation', { category: 'receipt', metadata: { field: 'date', kind: 'invalid_date' } });
  expect(JSON.stringify(logger.warning.mock.calls)).not.toMatch(/PRIVATE|2026-02-30/);
  expect(stored.size).toBe(1);
  expect(stored.get(id).file).toBeUndefined();
  const media = await fetch(site + '/scan/' + id);
  expect(media.headers.get('cache-control')).toContain('private, no-store');
  expect(media.headers.get('content-type')).toContain('image/jpeg');
  const jpeg = Buffer.from(await media.arrayBuffer());
  expect(jpeg).toEqual(stored.get(id).scanJpeg);
  expect((await sharp(jpeg).metadata()).format).toBe('jpeg');

  mockComplete.mockResolvedValueOnce(details('2026-10-12'));
  const replay = await upload([firstImage, secondImage]);
  expect(replay.status).toBe(200);
  const result = await replay.json();
  expect(result.failures).toEqual([]);
  expect(result.receipts[1].id).toBe(id);
  expect(result.raw_data).toHaveLength(2);
  expect(mockComplete).toHaveBeenCalledTimes(3);
  expect(stored.size).toBe(2);
  expect((await fetch(site + '/scan/' + id, { headers: { 'x-test-account': other } })).status).toBe(404);
  expect((await fetch(site + '/view_receipt/' + id, { headers: { 'x-test-account': other } })).status).toBe(404);
  expect((await fetch(site + '/scan/' + id, { headers: { 'x-test-role': 'user' } })).status).toBe(403);
});

test('a native multipart form reports the unreadable date and accepts a single-file correction', async () => {
  mockComplete.mockResolvedValue(details('unknown'));
  const invalid = await upload([firstImage], { native: true });
  expect(invalid.status).toBe(422);
  expect(await invalid.text()).toContain('File 1 (date)');
  expect(stored.size).toBe(0);
  const corrected = await upload([firstImage], { native: true, date: '2024-02-29' });
  expect(corrected.status).toBe(200);
  expect(await corrected.text()).toContain('2024-02-29');
  expect(stored.size).toBe(1);
});

test('forged uploads and corrupt images never reach extraction or persistence', async () => {
  expect((await upload([firstImage], { headers: { 'X-CSRF-Token': 'invalid' } })).status).toBe(403);
  expect((await upload([firstImage], { headers: { Origin: 'https://foreign.invalid' } })).status).toBe(403);
  const bad = await upload([Buffer.from('not an image')]);
  expect(bad.status).toBe(422);
  expect((await bad.json()).failures[0].field).toBe('image');
  expect(Receipt.create).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
});

test('a model validation error reports the failed field without retaining its scan or logging its value', async () => {
  mockComplete.mockResolvedValue(details('2026-11-12'));
  Receipt.create.mockRejectedValueOnce(Object.assign(new Error('PRIVATE model value'), {
    name: 'ValidationError', errors: { method: { kind: 'required', value: 'PRIVATE method' } },
  }));
  const response = await upload([firstImage]);
  expect(response.status).toBe(422);
  expect((await response.json()).failures[0]).toMatchObject({ field: 'method', kind: 'required' });
  expect(stored.size).toBe(0);
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('PRIVATE');
});

test('retry recovers a committed receipt after a lost database acknowledgement', async () => {
  mockComplete.mockResolvedValue(details('2026-11-12'));
  Receipt.create.mockImplementationOnce(async row => {
    stored.set(row._id, row);
    throw Object.assign(new Error('PRIVATE data'), { code: 'ECONNRESET' });
  });
  expect((await upload([firstImage])).status).toBe(503);
  const retry = await upload([firstImage]);
  expect(retry.status).toBe(200);
  expect((await retry.json()).receipts[0].id).toBe([...stored.keys()][0]);
  expect(mockComplete).toHaveBeenCalledTimes(1);
  expect(Receipt.create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('PRIVATE');
});

test('concurrent identical uploads converge on one receipt per uploader', async () => {
  mockComplete.mockResolvedValue(details('2026-11-12'));
  const both = await Promise.all([upload([firstImage]), upload([firstImage])]);
  const results = await Promise.all(both.map(reply => reply.json()));
  expect(results[0].receipts[0].id).toBe(results[1].receipts[0].id);
  expect(stored.size).toBe(1);
  const separate = await upload([firstImage], { headers: { 'x-test-account': other } });
  expect((await separate.json()).receipts[0].id).not.toBe(results[0].receipts[0].id);
  expect(stored.size).toBe(2);
});
