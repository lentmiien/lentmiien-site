jest.mock('marked', () => ({ ...jest.requireActual('marked'), parse: jest.fn((...args) => jest.requireActual('marked').parse(...args)) }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
jest.mock('../../services/codexToolService', () => ({ getSessionDetail: jest.fn(), getTurnDetail: jest.fn(), listPromptTemplates: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/codexQueueWorker', () => ({}));
const { JSDOM } = require('jsdom');
const { MAX_MARKDOWN_CHARACTERS, presentCodexTranscripts, renderTranscriptMarkdown } = require('../../utils/codexTranscriptPresentation');
const service = require('../../services/codexToolService');
const controller = require('../../controllers/codexController');
const fragment = (html) => JSDOM.fragment(html);
beforeEach(() => require('marked').parse.mockImplementation((...args) => jest.requireActual('marked').parse(...args)));

test('renders Markdown headings, lists, code, tables and safe links without changing original text', () => {
  const prompt = '# Request\n\n**Bold** and *italic*\n\n- item\n\n```js\nconst x = "<script>";\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Local](/codex) [Docs](https://example.com/path)';
  const state = presentCodexTranscripts({ turns: [{ prompt, finalResponse: 'Done **now**' }] });
  const turn = state.turns[0];
  const dom = fragment(turn.promptHtml);
  expect(turn.prompt).toBe(prompt);
  expect(turn.finalResponse).toBe('Done **now**');
  expect(dom.querySelector('h1').textContent).toBe('Request');
  expect(dom.querySelector('strong').textContent).toBe('Bold');
  expect(dom.querySelector('li').textContent).toBe('item');
  expect(dom.querySelector('pre code').textContent).toContain('<script>');
  expect(dom.querySelector('table')).not.toBeNull();
  expect(dom.querySelector('a').getAttribute('href')).toBe('/codex');
  expect(dom.querySelectorAll('a')[1].getAttribute('rel')).toBe('noopener noreferrer nofollow');
});

test.each([
  '<script>alert(1)</script><img src="/mutation" onerror="alert(1)">',
  '<svg onload="alert(1)"><a href="javascript:alert(1)">x</a></svg>',
  '<iframe src="https://tracker.test"></iframe><form action="/mutate"><input autofocus></form>',
  '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
  '<a href="data:text/html,hi">x</a><a href="//tracker.test">x</a>',
  '<a href="/\\tracker.test">x</a><a href="/&#10;/tracker.test">x</a>',
  '![tracker](https://tracker.test/pixel) [bad](javascript:alert(1))',
  '<p id="codex-followup-form" style="position:fixed" onmouseover="alert(1)">x</p>',
])('keeps active HTML, remote resources, unsafe links and DOM clobbering inert: %s', (text) => {
  const dom = fragment(renderTranscriptMarkdown(text));
  expect(dom.querySelector('script, img, svg, iframe, form, input, [id], [style], [onclick], [onerror], [onload]')).toBeNull();
  expect([...dom.querySelectorAll('a')].every((node) => !node.hasAttribute('href'))).toBe(true);
});

test('large legacy transcripts remain complete as inert plain text', () => {
  const text = '# ' + 'x'.repeat(MAX_MARKDOWN_CHARACTERS) + '<script>tail</script>';
  const dom = fragment(renderTranscriptMarkdown(text));
  expect(dom.querySelector('pre').textContent).toBe(text);
  expect(dom.querySelector('script')).toBeNull();
});

test('renderer failure is safely logged and preserves text', () => {
  const marked = require('marked');
  const spy = jest.spyOn(marked, 'parse').mockImplementationOnce(() => { throw new Error('private prompt'); });
  expect(fragment(renderTranscriptMarkdown('<private> & text')).textContent).toBe('<private> & text');
  expect(require('../../utils/logger').warning).toHaveBeenCalledWith(
    'Unable to render Codex transcript Markdown; showing plain text',
    { category: 'codex_tool', metadata: { errorName: 'Error' } }
  );
  spy.mockRestore();
});

test.each(['renderSession', 'renderTurn', 'getSession', 'getTurn'])('%s decorates existing reads while forwarding the validated user', async (method) => {
  const turn = { id: 'turn-1', prompt: '**Prompt**\n\n</script><script>bad()</script>', finalResponse: '**Response**', promptHtml: '<img src=x>' };
  const state = { session: { id: 'session-1' }, ...(method.endsWith('Session') ? { turns: [turn] } : { turn }) };
  const read = method.endsWith('Session') ? service.getSessionDetail : service.getTurnDetail;
  read.mockResolvedValue(state);
  const req = { params: { sessionId: 'session-1', turnId: 'turn-1' }, user: { _id: 'owner-1' } };
  const res = { locals: {}, render: jest.fn(), json: jest.fn() };
  await controller[method](req, res);
  expect(read).toHaveBeenLastCalledWith(method.endsWith('Session') ? 'session-1' : 'turn-1', { user: req.user });
  const payload = method.startsWith('render') ? res.render.mock.calls[0][1].codexState : res.json.mock.calls[0][0];
  if (method.startsWith('render')) {
    expect(res.render.mock.calls[0][1].codexStateJson).not.toContain('<');
    expect(JSON.parse(res.render.mock.calls[0][1].codexStateJson).session.id).toBe('session-1');
  }
  const presented = payload.turn || payload.turns[0];
  expect(presented.promptHtml).toContain('<strong>Prompt</strong>');
  expect(presented.responseHtml).toContain('<strong>Response</strong>');
  expect(turn.promptHtml).toBe('<img src=x>');
});
