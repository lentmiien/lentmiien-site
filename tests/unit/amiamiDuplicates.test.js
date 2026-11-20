jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createAmiAmiDuplicatesRouter } = require('../../routes/amiamiDuplicates');
const { createDuplicateService } = require('../../services/amiamiDuplicateService');
const hash = require('../../utils/amiamiListingHash');

const first = '000000000000000000000001';
const second = '000000000000000000000002';
const comparison = '/compare/' + first + '/' + second;
const roleModel = { findOne: jest.fn() };
let store, service, keep, remove, session, principal, server, url;
const query = value => ({ lean: () => ({ setOptions: async () => value }) });

beforeAll(async () => {
  store = { find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), collection: { replaceOne: jest.fn() }, aggregate: jest.fn() };
  service = createDuplicateService(store);
  const app = express();
  app.set('view engine', 'pug');
  app.set('views', path.resolve(__dirname, '../../views'));
  app.use((req, res, next) => {
    req.isAuthenticated = () => Boolean(principal);
    req.user = principal;
    req.session = session;
    res.locals.gtag = true;
    next();
  });
  app.use('/admin/amiami-items/duplicates', createAmiAmiDuplicatesRouter({ service, roleModel }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  url = 'http://127.0.0.1:' + server.address().port + '/admin/amiami-items/duplicates';
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
beforeEach(() => {
  jest.clearAllMocks();
  session = { csrfToken: 'a'.repeat(43) };
  principal = { _id: first, name: 'operator', type_user: 'admin' };
  roleModel.findOne.mockResolvedValue(null);
  keep = { _id: first, __v: 0, gcode: 'A', listing: { brand: 'old' }, details: { janCode: '0123', remarks: 'keep me' } };
  remove = { _id: second, __v: 3, gcode: 'B', listing: { brand: 'new' }, details: { janCode: '0123', remarks: '<script>test()</script>' } };
  store.find.mockImplementation(() => query([keep, remove]));
  store.findOneAndUpdate.mockReturnValue({ lean: async () => ({ ...remove, __v: 4 }) });
  store.updateOne.mockResolvedValue({ matchedCount: 1 });
  store.collection.replaceOne.mockResolvedValue({ matchedCount: 1 });
});
async function form() {
  const pair = await service.compare(first, second);
  return { snapshot: pair.snapshot, _csrf: session.csrfToken, listing_brand: 'remove', details_remarks: 'keep' };
}
function post(body, headers = {}) {
  return fetch(url + comparison, { method: 'POST', redirect: 'manual', body: new URLSearchParams(body), headers });
}

test('renders a read-only comparison with survivor defaults and escaped values', async () => {
  const response = await fetch(url + comparison);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  const html = await response.text();
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    expect(doc.querySelector('main script')).toBeNull();
    expect(doc.querySelectorAll('input:checked')).toHaveLength(2);
    expect(doc.querySelector('form').textContent).toContain('<script>test()</script>');
    expect(doc.querySelector('button[type=submit]').textContent).toContain('Merge into A');
    expect(html).not.toContain('googletagmanager');
    expect(store.findOneAndUpdate).not.toHaveBeenCalled();
  } finally { dom.window.close(); }
});

test.each(['anonymous', 'user', 'family'])('denies ungranted %s before database work', async role => {
  principal = role === 'anonymous' ? null : { ...principal, type_user: role };
  expect((await fetch(url)).status).toBe(role === 'anonymous' ? 401 : 403);
  expect((await post({})).status).toBe(role === 'anonymous' ? 401 : 403);
  expect(store.aggregate).not.toHaveBeenCalled();
  expect(store.find).not.toHaveBeenCalled();
});

test('an explicitly granted operator can choose each value independently', async () => {
  principal.type_user = 'user';
  roleModel.findOne.mockResolvedValue({ permissions: ['amiami.items.read', 'amiami.items.merge'] });
  expect((await post(await form())).status).toBe(303);
  expect(store.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: first, __v: 0 }), {
    $inc: { __v: 1 }, $set: { 'listing.brand': 'new', listingChangedAt: expect.any(Date), listingHash: hash(remove.listing) },
  }, expect.any(Object));
  expect(store.collection.replaceOne).toHaveBeenCalledWith(expect.objectContaining({ _id: second, __v: 4 }), { _id: second, gcode: 'B', mergedInto: first }, expect.any(Object));
});

test('requires a valid session token and trusted origin', async () => {
  expect((await post({})).status).toBe(403);
  expect((await post({ _csrf: session.csrfToken }, { Origin: 'https://foreign.example' })).status).toBe(403);
  expect(store.find).not.toHaveBeenCalled();
});

test('rejects stale content, mismatched JANs, invalid IDs and forged choices', async () => {
  const body = await form();
  for (const change of [{ listing_brand: 'bad' }, { listing_brand: [] }, { gcode: 'new' }]) {
    expect((await post({ ...body, ...change })).status).toBe(400);
  }
  keep.listing.brand = 'modified';
  expect((await post(body)).status).toBe(409);
  remove.details.janCode = '123';
  expect((await fetch(url + comparison)).status).toBe(409);
  expect((await fetch(url + '/compare/invalid/' + first)).status).toBe(400);
  expect((await fetch(url + '/compare/' + first + '/' + first)).status).toBe(400);
  expect(store.findOneAndUpdate).not.toHaveBeenCalled();
});

test('a changed survivor or a database failure stops redirect creation', async () => {
  const body = await form();
  store.updateOne.mockResolvedValueOnce({ matchedCount: 0 }).mockRejectedValueOnce(new Error('private diagnostic'));
  expect((await post(body)).status).toBe(409);
  const response = await post(body);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private diagnostic');
  expect(store.collection.replaceOne).not.toHaveBeenCalled();
});

test('reports a concurrent duplicate change after the copy', async () => {
  store.collection.replaceOne.mockResolvedValueOnce({ matchedCount: 0 });
  const response = await post(await form());
  expect(response.status).toBe(409);
  expect(await response.text()).toContain('selected details were saved');
});

test('matching product fields need just the reviewed pair, even with different source metadata', async () => {
  remove.listing = { ...keep.listing, gcode: 'B' };
  remove.details = { ...keep.details, scode: 'B-source', raw: { source: 'B' } };
  const pair = await service.compare(first, second);
  expect(pair.differences).toEqual([]);
  expect((await post({ snapshot: pair.snapshot, _csrf: session.csrfToken })).status).toBe(303);
  expect(store.updateOne.mock.calls[0][1]).toEqual({ $inc: { __v: 1 } });
});

test('read-only access does not grant merge authority', async () => {
  principal.type_user = 'user';
  roleModel.findOne.mockResolvedValue({ permissions: ['amiami.items.read'] });
  expect((await post({})).status).toBe(403);
  expect(store.find).not.toHaveBeenCalled();
});

test('lists duplicate groups and links straight to the comparison for a pair', async () => {
  store.aggregate.mockReturnValue({ option: async () => [
    { _id: '00123', count: 2, first, last: second }, { _id: '00456', count: 3 },
  ] });
  const response = await fetch(url);
  expect(response.status).toBe(200);
  const dom = new JSDOM(await response.text());
  try {
    const links = [...dom.window.document.querySelectorAll('tbody a')].map(a => a.getAttribute('href'));
    expect(links).toEqual(['/admin/amiami-items/duplicates' + comparison, '/admin/amiami-items/duplicates/group?jan=00456']);
  } finally { dom.window.close(); }
});
