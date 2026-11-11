jest.mock('../../database', () => ({ AmiAmiItem: { findById: jest.fn(), find: jest.fn(), countDocuments: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ error: jest.fn() }));

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { AmiAmiItem } = require('../../database');
const logger = require('../../utils/logger');
const { createAmiAmiItemsRouter } = require('../../routes/amiamiItems');
const controller = require('../../controllers/amiamiItemsController');

const id = '0123456789abcdef01234567';
const roleModel = { findOne: jest.fn() };
let user, authenticated, server, base, query, item;

beforeAll(async () => {
  const app = express();
  app.set('views', path.join(__dirname, '../../views'));
  app.set('view engine', 'pug');
  app.use((req, res, next) => {
    req.user = user;
    req.isAuthenticated = () => authenticated;
    res.locals.gtag = true; // The private route must override analytics defaults.
    next();
  });
  app.use('/admin/amiami-items', createAmiAmiItemsRouter({ roleModel }));
  app.get('/admin/amiami-items', controller.index);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/admin/amiami-items`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  authenticated = true;
  user = { _id: id, name: 'fixture-admin', type_user: 'admin' };
  roleModel.findOne.mockResolvedValue(null);
  item = {
    _id: id, __v: 0, gcode: 'FIGURE-123', url: 'https://www.amiami.com/eng/detail/?gcode=FIGURE-123',
    source: 'amiami-new-products', sourceUrl: 'https://www.amiami.com/list',
    firstSeenAt: new Date('2026-11-01T01:02:03.456Z'), lastSeenAt: new Date('2026-11-02T01:02:03.456Z'),
    listingChangedAt: new Date('2026-11-01T01:02:03.456Z'), listingHash: 'saved-hash',
    createdAt: new Date('2026-11-01T01:02:03.456Z'), updatedAt: new Date('2026-11-02T01:02:03.456Z'),
    detailStatus: 'fetched', detailFetchedAt: new Date('2026-11-02T01:02:03.456Z'),
    detailError: { message: null, at: null },
    listing: { gcode: 'FIGURE-123', url: 'https://www.amiami.com/item', itemName: 'Listing name',
      brand: 'Listing brand', priceText: '1,500 JPY', imageUrl: 'https://images.invalid/listing.jpg', tags: ['NEW'] },
    details: { gcode: 'FIGURE-123', scode: '123', itemName: 'Saved figure',
      price: { currentJpy: 0, comparisonJpy: 1500, listJpy: 1800, points: 15 },
      releaseDate: '2026-11', brand: 'Saved brand', seriesTitle: 'Series', seriesTitles: ['Series', 'Second series'],
      originalTitles: ['Original'], characterName: 'Character', characterNames: ['Character'],
      sculptor: 'Sculptor', sculptorGroup: 'Group', specifications: 'Height: 20 cm\nMaterial: PVC',
      details: '<script>alert("saved")</script><img src=x onerror=alert(1)>', remarks: '',
      janCode: '1234567890123', copyright: 'Copyright', saleStatus: 'Available',
      flags: { sale: false, preOrder: true }, imageLinks: ['javascript:alert(1)', 'https://images.invalid/detail.jpg'],
      sourceUrl: 'https://www.amiami.com/api', apiFetchedAt: new Date('2026-11-02T01:02:03.456Z'),
      raw: { arbitrary: { html: '</pre><script>alert("raw")</script>', zero: 0, empty: [], flag: false } },
    },
    extraStoredField: { retained: true },
  };
  query = { maxTimeMS: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockImplementation(async () => item) };
  AmiAmiItem.findById.mockReturnValue(query);
});

test('renders every stored field, exact dates, nested data and inert markup', async () => {
  const response = await fetch(`${base}/${id}?ownerId=forged`);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(AmiAmiItem.findById).toHaveBeenCalledWith(id);
  expect(query.maxTimeMS).toHaveBeenCalledWith(5000);
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    const { listing, details, ...metadata } = item;
    const sections = [...document.querySelectorAll('.amiami-item-detail__section')];
    expect(sections).toHaveLength(3);
    for (const [index, saved] of [metadata, listing, details].entries()) {
      const fields = new Map([...sections[index].querySelectorAll('.amiami-item-detail__field')]
        .map(row => [row.querySelector('dt').textContent, row.querySelector('pre').textContent]));
      expect(fields.size).toBe(Object.keys(saved).length);
      for (const [name, value] of Object.entries(saved)) {
        const normalized = JSON.parse(JSON.stringify(value));
        expect(fields.get(name)).toBe(typeof normalized === 'string' && normalized !== ''
          ? normalized : JSON.stringify(normalized, null, 2));
      }
    }
    expect(document.querySelector('h1').textContent).toBe('Saved figure');
    expect(document.querySelector('main script, main img, main [onerror], a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('details pre').textContent).toContain('"empty": []');
    expect(html).not.toContain('googletagmanager');
    expect(html).toContain('/css/color-theme.css');
  } finally {
    dom.window.close();
  }
});

test.each(['pending', 'error'])('shows %s placeholders with missing details and saved errors', async status => {
  item.details = null;
  item.detailStatus = status;
  item.detailError = { message: 'AmiAmi lookup failed', at: new Date('2026-11-02T01:02:03.456Z') };
  const response = await fetch(`${base}/${id}`);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('Listing name');
  expect(html).toContain('AmiAmi lookup failed');
  expect(html).toContain('<pre>null</pre>');
});

test.each(['anonymous', 'missing-id', 'incomplete'])('denies %s principals before lookup', async kind => {
  if (kind === 'anonymous') authenticated = false;
  if (kind === 'missing-id') delete user._id;
  if (kind === 'incomplete') delete user.name;
  const response = await fetch(`${base}/${id}`);
  expect(response.status).toBe(kind === 'incomplete' ? 403 : 401);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(AmiAmiItem.findById).not.toHaveBeenCalled();
});

test.each(['family', 'user'])('denies ungranted %s and allows an explicit catalog read grant', async type => {
  user.type_user = type;
  expect((await fetch(`${base}/${id}`)).status).toBe(403);
  expect(AmiAmiItem.findById).not.toHaveBeenCalled();
  roleModel.findOne.mockImplementation(async filter => filter.type === 'user'
    ? { permissions: ['amiami.items.read'] } : null);
  expect((await fetch(`${base}/${id}`)).status).toBe(200);
});

test('fails closed when capability lookup fails', async () => {
  user.type_user = 'user';
  roleModel.findOne.mockRejectedValue(new Error('private authorization error'));
  const response = await fetch(`${base}/${id}`);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private authorization error');
  expect(AmiAmiItem.findById).not.toHaveBeenCalled();
});

test.each(['invalid', 'a'.repeat(25), 'g'.repeat(24), '%7B%22%24ne%22%3Anull%7D'])('rejects malformed ID %s without a query', async invalid => {
  const response = await fetch(`${base}/${invalid}`);
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('AmiAmi item not found.');
  expect(AmiAmiItem.findById).not.toHaveBeenCalled();
});

test('missing records return a private generic 404', async () => {
  item = null;
  const response = await fetch(`${base}/${id}`);
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(await response.text()).toBe('AmiAmi item not found.');
});

test('logs database failure without disclosing diagnostics or stored data', async () => {
  query.exec.mockRejectedValue(new Error('mongodb://private:secret@db/connection'));
  const response = await fetch(`${base}/${id}`);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('secret');
  expect(logger.error).toHaveBeenCalledWith('Unable to load saved AmiAmi item details', { category: 'amiami-items' });
});

test.each(['POST', 'PUT', 'DELETE'])('%s cannot run the detail handler', async method => {
  expect((await fetch(`${base}/${id}`, { method })).status).toBe(404);
  expect(AmiAmiItem.findById).not.toHaveBeenCalled();
});

test('the listing adds a saved-entry link while retaining the AmiAmi link', async () => {
  AmiAmiItem.countDocuments.mockResolvedValue(1);
  AmiAmiItem.find.mockReturnValue({ sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: async () => [item] });
  const response = await fetch(base);
  const dom = new JSDOM(await response.text());
  try {
    const links = [...dom.window.document.querySelectorAll('tbody a')];
    expect(links.find(link => link.textContent === 'View saved details').getAttribute('href')).toBe(`/admin/amiami-items/${id}`);
    expect(links.find(link => link.textContent === item.gcode).getAttribute('href')).toBe(item.url);
  } finally {
    dom.window.close();
  }
});

test('application mounts details after upload and before the legacy admin gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const detailMount = source.indexOf("app.use('/admin/amiami-items',");
  expect(detailMount).toBeGreaterThan(source.indexOf("app.use('/admin/amiami-items/upload',"));
  expect(detailMount).toBeLessThan(source.indexOf("app.use('/admin', isAuthenticated, isAdmin"));
});
