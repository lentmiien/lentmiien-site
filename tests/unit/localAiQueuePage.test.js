const pug = require('pug');
const { createRouter } = require('../../routes/localAi');
let JSDOM;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
const now = Date.parse('2026-10-18T12:00:00Z');
const day = 86400000;
const actor = { ownerId: 'synthetic-owner' };
const makeJob = (id, age) => ({
  _id: id, ownerId: actor.ownerId, type: 'comfy.workflow', state: 'succeeded', createdAt: new Date(now - age),
  attempts: [], published: true, request: {}, result: { artifacts: [{ slot: 0, media_type: 'image/png' }] },
});
function fixture(jobs) {
  const query = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(jobs) };
  const service = { db: { Job: { find: jest.fn().mockReturnValue(query) }, Control: { findById: () => ({ lean: async () => null }) } }, get: jest.fn() };
  const router = createRouter({ service, worker: {} });
  const run = async (path, id) => {
    const res = { render: jest.fn() }, next = jest.fn();
    await router.stack.find(layer => layer.route?.path === path).route.stack[0].handle({ localAiActor: actor, params: { id } }, res, next);
    return { res, next };
  };
  return { service, query, run };
}
function render(locals) {
  return new JSDOM(pug.renderFile('views/local_ai_queue.pug', { csrfToken: 'synthetic', ...locals })).window.document;
}
afterEach(() => jest.restoreAllMocks());

test('queue scopes the five-day database window to its owner and hides previews at 24 hours', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  const { service, query, run } = fixture([makeJob('recent', day - 1), makeJob('boundary', day), makeJob('older', 4 * day)]);
  const { res, next } = await run('/queue');
  expect(next).not.toHaveBeenCalled();
  expect(service.db.Job.find).toHaveBeenCalledWith({ ownerId: actor.ownerId, createdAt: { $gte: new Date(now - 5 * day) } });
  expect(query.limit).toHaveBeenCalledWith(100);
  const locals = res.render.mock.calls[0][1];
  const document = render(locals);
  expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(Array.from(document.querySelectorAll('img'), img => img.getAttribute('src'))).toEqual(['/local-ai/api/v1/jobs/recent/outputs/0']);
  expect(document.querySelector('[aria-label="GPU session"]')).toBeNull();
  expect(document.querySelector('a[href="/local-ai/queue/older"]')).not.toBeNull();
});

test('direct old job page retains its image and current details through the scoped get operation', async () => {
  const { service, run } = fixture([]);
  service.get.mockResolvedValue(makeJob('old-job', 20 * day));
  const { res, next } = await run('/queue/:id', 'old-job');
  expect(next).not.toHaveBeenCalled();
  expect(service.get).toHaveBeenCalledWith(actor, 'old-job');
  const document = render(res.render.mock.calls[0][1]);
  expect(document.querySelector('img').getAttribute('src')).toBe('/local-ai/api/v1/jobs/old-job/outputs/0');
  expect(document.querySelector('dl').textContent).toContain('succeeded');
  expect(service.db.Job.find).not.toHaveBeenCalled();
});

test('an inaccessible job does not render any preview or details', async () => {
  const { service, run } = fixture([]);
  const error = Object.assign(new Error('not_found'), { status: 404 });
  service.get.mockRejectedValue(error);
  const { res, next } = await run('/queue/:id', 'foreign-job');
  expect(res.render).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith(error);
});
