const {
  addCodexEventPresentation,
  buildCodexEventPresentation,
  extractCodexItem,
  renderAgentMessageMarkdown,
} = require('../../utils/codexEventPresentation');

describe('codexEventPresentation', () => {
  test('extracts Codex items from direct and nested payloads', () => {
    const direct = { type: 'agent_message', text: 'Direct' };
    const nested = { type: 'todo_list', items: [] };

    expect(extractCodexItem({ item: direct })).toBe(direct);
    expect(extractCodexItem({ payload: { item: nested } })).toBe(nested);
    expect(extractCodexItem(null)).toBeNull();
  });

  test('renders agent message text as safe GFM HTML', () => {
    const html = renderAgentMessageMarkdown([
      'Fixed **and deployed**.',
      '',
      '- First check',
      '- [Documentation](https://example.com/docs)',
      '',
      '[Unsafe link](javascript:alert(1))',
      '',
      '<script>alert("unsafe")</script>',
    ].join('\n'));

    expect(html).toContain('<strong>and deployed</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>');
  });

  test('builds agent message presentation from only the item text', () => {
    const presentation = buildCodexEventPresentation({
      payload: {
        type: 'item.completed',
        item: {
          id: 'item_203',
          type: 'agent_message',
          text: 'Result with `code`.',
          ignored: 'Do not render this field',
        },
      },
    });

    expect(presentation).toEqual({
      itemType: 'agent_message',
      html: '<p>Result with <code>code</code>.</p>\n',
    });
    expect(presentation.html).not.toContain('ignored');
  });

  test('builds a safe Markdown presentation for reasoning items', () => {
    const presentation = buildCodexEventPresentation({
      payload: {
        item: {
          type: 'reasoning',
          text: 'Checking **Ollama output**.\n\n- Inspect events\n- Update the view',
        },
      },
    });

    expect(presentation).toEqual({
      itemType: 'reasoning',
      html: [
        '<p>Checking <strong>Ollama output</strong>.</p>',
        '<ul>',
        '<li>Inspect events</li>',
        '<li>Update the view</li>',
        '</ul>',
        '',
      ].join('\n'),
    });
  });

  test('normalizes todo list items and their completed state', () => {
    const presentation = buildCodexEventPresentation({
      payload: {
        payload: {
          item: {
            type: 'todo_list',
            items: [
              { text: 'Complete task', completed: true },
              { text: 'Open task', completed: false },
              { text: 'String is not accepted as complete', completed: 'true' },
            ],
          },
        },
      },
    });

    expect(presentation).toEqual({
      itemType: 'todo_list',
      items: [
        { text: 'Complete task', completed: true },
        { text: 'Open task', completed: false },
        { text: 'String is not accepted as complete', completed: false },
      ],
    });
  });

  test('normalizes file changes for the focused edited-files summary', () => {
    const presentation = buildCodexEventPresentation({
      payload: {
        item: {
          type: 'file_change',
          changes: [
            { path: ' /workspace/app.js ', kind: 'UPDATE' },
            { path: '/workspace/models/item.js', kind: 'add' },
            { path: '', kind: 'delete' },
          ],
        },
      },
    });

    expect(presentation).toEqual({
      itemType: 'file_change',
      changes: [
        { path: '/workspace/app.js', kind: 'update' },
        { path: '/workspace/models/item.js', kind: 'add' },
      ],
    });
  });

  test('adds presentation without changing unsupported events', () => {
    const event = { seq: 1, payload: { item: { type: 'command_execution' } } };
    const presented = addCodexEventPresentation(event);

    expect(presented).toBe(event);
    expect(buildCodexEventPresentation({ payload: {} })).toBeNull();
  });
});
