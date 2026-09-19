jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
// Exercise the real cooking router mount without importing application services/workers.
jest.mock('../../controllers/cookingcontroller', () => new Proxy({}, { get: () => (req, res) => res.sendStatus(204) }));
jest.mock('../../controllers/cookbookcontroller', () => new Proxy({}, { get: () => (req, res) => res.sendStatus(204) }));
jest.mock('../../models/cookbook_recipe', () => ({ findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/chat4_knowledge', () => ({ findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
const express = require('express');
const cookbook = require('../../models/cookbook_recipe');
const knowledge = require('../../models/chat4_knowledge');
const roleModel = require('../../models/role');
const logger = require('../../utils/logger');
const { hasPermission } = require('../../utils/authorization');
const id = '111111111111111111111111';
const canonicalId = '222222222222222222222222';
let server; let base; let principal; let authenticated; let grants; let notes; let recipes; let queries;
function findIn(collection) {
  return filter => {
    queries.push(filter);
    const chain = {
      select: () => chain, sort: () => chain,
      maxTimeMS(ms) { expect(ms).toBe(2000); return chain; }, lean: () => chain,
      async exec() {
        return collection().find(doc => Object.entries(filter).every(([key, value]) => value instanceof RegExp
          ? value.test(doc[key]) : String(doc[key]) === String(value))) || null;
      },
    };
    return chain;
  };
}
beforeEach(async () => {
  authenticated = true; principal = { name: 'fixture-owner', type_user: 'user' }; grants = ['cooking']; queries = [];
  notes = [{ _id: id, user_id: principal.name, category: 'Recipe', title: 'Fixture soup', contentMarkdown: '## Instructions\n\nSimmer **gently**.' }]; recipes = [];
  cookbook.findOne.mockImplementation(findIn(() => recipes)); knowledge.findOne.mockImplementation(findIn(() => notes));
  roleModel.findOne.mockImplementation(async filter => filter.type === 'user' ? { permissions: grants } : null);
  const app = express(); app.set('views', 'views'); app.set('view engine', 'pug');
  app.locals.formAssetUrl = require('../../utils/formAssets').createFormAssets().url;
  app.use((req, res, next) => {
    req.user = principal; req.isAuthenticated = () => authenticated;
    Object.assign(res.locals, { loggedIn: authenticated, bookmarks: [], htmlPaths: [], gtag: true }); next();
  });
  // Same authentication + legacy cooking permission order as app.js, then real route wiring.
  app.use('/cooking', (req, res, next) => authenticated ? next() : res.sendStatus(401), async (req, res, next) => {
    if (await hasPermission(req.user, 'cooking', { roleModel })) return next();
    return res.sendStatus(403);
  }, require('../../routes/cooking'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/cooking/cookbook/legacy`;
});
afterEach(async () => {
  expect(cookbook.create).not.toHaveBeenCalled(); expect(cookbook.updateOne).not.toHaveBeenCalled();
  expect(knowledge.create).not.toHaveBeenCalled(); expect(knowledge.updateOne).not.toHaveBeenCalled();
  await new Promise(resolve => server.close(resolve));
});
const read = (value = id, options = {}) => fetch(`${base}/${value}`, { redirect: 'manual', ...options });

test.each(['admin', 'family', 'user'])('%s may view its own legacy recipe with private headers and no conversion controls', async type => {
  principal.type_user = type;
  const response = await read(); const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(html).toContain('Fixture soup'); expect(html).toContain('<strong>gently</strong>');
  expect(html).toContain('Legacy recipe · Read-only'); expect(html).toContain('/css/color-theme.css');
  expect(html).not.toMatch(/googletagmanager|knowledgeId=|rating_label|Create recipe/);
  expect(html.match(/<main[\s\S]*?<\/main>/)[0]).not.toContain('/edit');
  expect(queries).toEqual([{ user_id: 'fixture-owner', originKnowledgeId: id }, { _id: id, user_id: 'fixture-owner', category: /^Recipe$/i }]);
});

test('converted owned recipe redirects to normal detail without reading legacy content', async () => {
  recipes = [{ _id: canonicalId, user_id: principal.name, originKnowledgeId: id }];
  const response = await read();
  expect(response.status).toBe(302); expect(response.headers.get('location')).toBe(`/cooking/cookbook/${canonicalId}`);
  expect(knowledge.findOne).not.toHaveBeenCalled();
});

test('foreign conversion does not redirect or disclose its title', async () => {
  recipes = [{ _id: canonicalId, user_id: 'foreign', originKnowledgeId: id, title: 'Hidden recipe' }];
  const response = await read();
  expect(response.status).toBe(200); expect(await response.text()).not.toContain('Hidden recipe');
});

test.each(['admin', 'family', 'user'])('%s cannot view another owner or non-recipe knowledge, indistinguishable from missing', async type => {
  principal.type_user = type;
  notes[0].user_id = 'foreign';
  const foreign = await read(); const message = await foreign.text(); expect(foreign.status).toBe(404);
  notes = []; const missing = await read(); expect(missing.status).toBe(404); expect(await missing.text()).toBe(message);
  notes = [{ _id: id, user_id: principal.name, category: 'Private note' }]; expect((await read()).status).toBe(404);
});

test('anonymous and missing semantic or mount capabilities fail before recipe reads; explicit grant works', async () => {
  authenticated = false; expect((await read()).status).toBe(401);
  authenticated = true; principal.type_user = 'custom'; expect((await read()).status).toBe(403);
  expect(queries).toHaveLength(0);
  grants.push('cooking.recipe.read'); expect((await read()).status).toBe(200);
  queries = []; grants = ['cooking.recipe.read']; expect((await read()).status).toBe(403); expect(queries).toHaveLength(0);
});

test.each(['bad-id', 'a'.repeat(25), '%24ne', '123'])('malformed ID %s is rejected before recipe queries', async value => {
  expect((await read(value)).status).toBe(400); expect(queries).toHaveLength(0);
});

test('oversized Markdown is not rendered and logs omit content', async () => {
  notes[0].contentMarkdown = 'x'.repeat(100001);
  expect((await read()).status).toBe(422);
  expect(logger.warning).toHaveBeenCalledWith('Legacy cookbook recipe exceeds rendering limit', { category: 'cookbook' });
});

test('recipe title, HTML and URL payloads remain inert; no remote or authenticated image requests', async () => {
  notes[0].title = '<script>alert(1)</script>';
  notes[0].contentMarkdown = '<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![remote](https://tracker.invalid/pixel)\n\n![action](/cooking/update_cooking_calendar)\n\n![local](/img/fixture.png)\n\n[reference](https://example.invalid/recipe)';
  const response = await read(); const html = await response.text();
  const article = html.match(/<article[\s\S]*?<\/article>/)[0];
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(article).not.toMatch(/<script|<img|javascript:|tracker\.invalid|onerror=/);
  expect(article).toContain('noopener noreferrer nofollow');
});

test('database failures produce generic errors and safe actionable logs', async () => {
  knowledge.findOne.mockImplementation(() => { throw new Error('Private content and credentials'); });
  const response = await read(); expect(response.status).toBe(503);
  expect(await response.text()).toBe('Unable to load recipe. Try again.');
  expect(logger.error).toHaveBeenCalledWith('Failed to load legacy cookbook recipe', { category: 'cookbook' });
});

test('compatibility route supports read-only HEAD and has no POST handler', async () => {
  const head = await read(id, { method: 'HEAD' }); expect(head.status).toBe(200); expect(await head.text()).toBe('');
  queries = []; expect((await read(id, { method: 'POST' })).status).toBe(404); expect(queries).toHaveLength(0);
});
