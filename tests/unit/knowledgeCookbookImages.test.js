const path = require('path');
const pug = require('pug');
const { resolveImageUrl } = require('../../public/js/libraryImageReference');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('sharp', () => jest.fn());
jest.mock('../../database', () => ({
  CookbookRecipeModel: Object.assign(jest.fn(), { findOne: jest.fn() }),
  Chat4KnowledgeModel: { findOne: jest.fn() },
  FileMetaModel: { find: jest.fn() },
}));
jest.mock('../../utils/ChatGPT', () => ({}));
jest.mock('../../utils/OpenAI_API', () => ({}));
jest.mock('../../services/messageService', () => jest.fn());
jest.mock('../../services/conversationService', () => jest.fn());
jest.mock('../../services/templateService', () => jest.fn());
jest.mock('../../services/knowledgeService', () => jest.fn());
jest.mock('../../services/embeddingApiService', () => jest.fn());
jest.mock('../../services/agentService', () => jest.fn());
jest.mock('../../services/batchService', () => jest.fn());
const sharp = require('sharp');
const logger = require('../../utils/logger');
const database = require('../../database');
const getKnowledgesById = jest.fn();
require('../../services/knowledgeService').mockImplementation(() => ({ getKnowledgesById }));
const knowledgeController = require('../../controllers/chat4controller');
const cookbookController = require('../../controllers/cookbookcontroller');
const privateName = 'gpt-image-private-11111111-2222-4333-8444-555555555555.png';
const privateUrl = `/gpt-image/media/${privateName}`;
const locals = { loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [], gtag: false, resolveImageUrl };
const id = 'a'.repeat(24);
let knowledge;
function response() {
  return { locals: { og_image: '/default.png', twitter_image: '/default.png' }, render: jest.fn(), redirect: jest.fn(), status: jest.fn().mockReturnThis() };
}
function query(value) {
  const chain = { select: () => chain, lean: () => chain, exec: async () => value, then: resolve => resolve(value) };
  return chain;
}
function render(name, data) { return pug.renderFile(path.join(__dirname, '../../views', name + '.pug'), { ...locals, ...data }); }
beforeEach(() => {
  knowledge = { _id: id, title: 'Fixture', images: [privateName], tags: [], contentMarkdown: '', contentHTML: '', category: 'Recipe', user_id: 'fixture', originType: 'chat5', originConversationId: 'b'.repeat(24) };
  getKnowledgesById.mockResolvedValue(knowledge);
  database.CookbookRecipeModel.findOne.mockReturnValue(query(null));
  database.Chat4KnowledgeModel.findOne.mockReturnValue(query(knowledge));
  database.FileMetaModel.find.mockResolvedValue([]);
  sharp.mockReturnValue({ metadata: async () => ({ width: 32, height: 24 }) });
});

test.each([privateName, privateUrl, `/img/${privateName}`, '../escape.png', '/admin/private.png', 'https://example.test/p.png'])('Knowledge avoids public file access and social URLs for %s', async reference => {
  knowledge.images = [reference];
  const res = response();
  await knowledgeController.viewknowledge({ params: { id }, user: { name: 'fixture' }, query: { raw: '1' } }, res);
  expect(sharp).not.toHaveBeenCalled();
  expect(database.FileMetaModel.find).not.toHaveBeenCalled();
  expect(res.locals).toEqual(expect.objectContaining({ og_image: '/default.png', twitter_image: '/default.png' }));
  expect(res.render).toHaveBeenCalledWith('view_knowledge', expect.objectContaining({ knowledge }));
  const html = render(...res.render.mock.calls[0]);
  expect(html).not.toContain(`/img/${privateName}`);
  if (resolveImageUrl(reference)) expect(html).toContain(`src="${privateUrl}"`);
  else expect(html).not.toContain('<img');
});
test.each(['legacy.png', '/img/legacy.png', '/img/photo%20one.jpg'])('Knowledge retains public dimensions and social metadata for %s', async reference => {
  knowledge.images = [reference];
  const res = response();
  await knowledgeController.viewknowledge({ params: { id }, user: { name: 'fixture' }, query: {} }, res);
  const url = resolveImageUrl(reference);
  expect(sharp).toHaveBeenCalledWith(`./public/img/${decodeURIComponent(url.slice(5))}`);
  expect(res.locals).toEqual(expect.objectContaining({ og_image: `https://home.lentmiien.com${url}`, twitter_image: `https://home.lentmiien.com${url}`, og_image_width: '32', og_image_height: '24' }));
});
test('missing public image logs a bounded diagnostic and still renders', async () => {
  knowledge.images = ['missing.png'];
  sharp.mockReturnValue({ metadata: async () => { throw Object.assign(new Error('private details'), { code: 'ENOENT' }); } });
  const res = response();
  await knowledgeController.viewknowledge({ params: { id }, user: { name: 'fixture' }, query: {} }, res);
  expect(res.render).toHaveBeenCalled();
  expect(logger.warning).toHaveBeenCalledWith(expect.any(String), { category: 'knowledge', metadata: { code: 'ENOENT' } });
  expect(res.locals.og_image).toBe('/default.png');
});
test('Knowledge redirects transitioned recipes unless raw view requested', async () => {
  database.CookbookRecipeModel.findOne.mockReturnValue(query({ _id: 'c'.repeat(24) }));
  const res = response();
  await knowledgeController.viewknowledge({ params: { id }, user: { name: 'fixture' }, query: {} }, res);
  expect(res.redirect).toHaveBeenCalledWith(`/cooking/cookbook/${'c'.repeat(24)}`);
  expect(getKnowledgesById).not.toHaveBeenCalled();
});
test('Knowledge import form, create, update and Cookbook view preserve stored image references', async () => {
  knowledge.images = [privateName, privateUrl, '/img/legacy.png', 'UP-upload-123.jpg', '/admin/invalid.png'];
  let res = response();
  await cookbookController.newForm({ query: { knowledgeId: id }, user: { name: 'fixture' } }, res);
  const formData = res.render.mock.calls[0][1];
  expect(formData.formState.imagesText).toBe(knowledge.images.join(', '));
  let html = render('cookbook/form', formData);
  expect(html).toContain(`src="${privateUrl}"`);
  expect(html).toContain('src="/img/legacy.png"');
  expect(html).not.toContain('src="/admin/');
  const saved = { ...knowledge, save: jest.fn().mockResolvedValue({ _id: id }) };
  database.CookbookRecipeModel.mockImplementation(() => saved);
  const body = { ...formData.formState, title: 'Fixture' };
  res = response();
  await cookbookController.create({ body, user: { name: 'fixture' } }, res);
  expect(database.CookbookRecipeModel).toHaveBeenCalledWith(expect.objectContaining({ images: knowledge.images, originKnowledgeId: id, originType: 'chat5', originConversationId: knowledge.originConversationId }));
  expect(res.redirect).toHaveBeenCalledWith(`/cooking/cookbook/${id}`);
  database.CookbookRecipeModel.findOne.mockReturnValue(query(saved));
  res = response();
  await cookbookController.update({ body, params: { id }, user: { name: 'fixture' } }, res);
  expect(saved.images).toEqual(knowledge.images);
  expect(saved.save).toHaveBeenCalledTimes(2);
  res = response();
  await cookbookController.view({ params: { id }, query: {}, user: { name: 'fixture' } }, res);
  html = render(...res.render.mock.calls[0]);
  expect(html).toContain(`src="${privateUrl}"`);
  expect(html).toContain('src="/img/UP-upload-123.jpg"');
  expect(html).not.toContain('src="/admin/');
});
test.each(['cooking_index_v1', 'cooking_request_index'])('%s resolves private and public images and omits hostile references', name => {
  const meal = image => ({ image, name: 'Fixture', knowledge_id: id });
  const html = render(name, { cookingCalendar: [{ date: '2026-01-01', day: 4, lunch: meal(privateName), dinner: meal('/img/legacy.png'), dessert: meal('../escape.png') }], knowledge: [], cooking_knowledge: [], cooking_requests: [], cooking_request_lookup: {}, id_to_name_lookup: {} });
  expect(html).toContain(`src="${privateUrl}"`);
  expect(html).toContain('src="/img/legacy.png"');
  expect(html).not.toContain('escape.png');
});
test('knowledge chat image picker uses the same protected references', () => {
  const html = render('edit_knowledge', { id, knowledge, conversations: [{ _id: 'b'.repeat(24), title: 'Fixture', messages: ['message'] }], messageLookup: ['message'], messages: [{ _id: 'message', sound: '', images: [{ filename: privateName }, { filename: '../escape.png' }], prompt: '', response: '' }] });
  expect(html).toContain(`src="${privateUrl}"`);
  expect(html).not.toContain('/img/gpt-image-private-');
});
