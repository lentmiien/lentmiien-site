const {
  buildCodexEventPresentation,
  extractCodexItem,
  presentCodexEvents,
  renderAgentMessageMarkdown,
  sanitizeRawEvent,
} = require('../../utils/codexEventPresentation');

describe('codexEventPresentation', () => {
  test('extracts items from current and legacy payload envelopes', () => {
    const direct = { type: 'agentMessage', text: 'Direct' };
    const nested = { type: 'todo_list', items: [] };
    const legacy = { type: 'reasoning', text: 'Legacy' };

    expect(extractCodexItem({ item: direct })).toBe(direct);
    expect(extractCodexItem({ payload: { item: nested } })).toBe(nested);
    expect(extractCodexItem({ data: { item: legacy } })).toBe(legacy);
    expect(extractCodexItem(null)).toBeNull();
  });

  test('renders agent Markdown while removing unsafe and local links', () => {
    const html = renderAgentMessageMarkdown([
      'Fixed **successfully**.',
      '',
      '- [Documentation](https://example.com/docs?token=private)',
      '- [Local file](/private/file)',
      '- [Unsafe](javascript:alert(1))',
      '',
      '<script>alert("unsafe")</script>',
    ].join('\n'));

    expect(html).toContain('<strong>successfully</strong>');
    expect(html).toContain('href="https://example.com/docs?token=%5Bredacted%5D"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('href="/private/file"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>');
  });

  test('presents rich agent updates with questions and workspace-relative citations', () => {
    const presentation = buildCodexEventPresentation({
      id: 'event-message',
      seq: 12,
      eventType: 'item.completed',
      stream: 'stdout-json',
      createdAt: '2026-09-04T01:02:03.000Z',
      payload: {
        item: {
          id: 'message-1',
          type: 'agentMessage',
          phase: 'commentary',
          text: 'The **schema** is current.',
          questions: [{
            header: 'Order',
            question: 'Which order?',
            options: [{ label: 'Newest', description: 'Newest first.' }],
          }],
          memoryCitation: {
            entries: [{ path: '/workspace/utils/parser.js', lineStart: 7, note: 'Parser' }],
          },
        },
      },
    }, { workspaceRoot: '/workspace' });

    expect(presentation).toEqual(expect.objectContaining({
      id: 'event-message',
      seq: 12,
      itemId: 'message-1',
      category: 'message',
      kind: 'agent_message',
      label: 'Update',
      status: 'succeeded',
      phase: 'completed',
      rawEventType: 'item.completed',
    }));
    expect(presentation.details.html).toContain('<strong>schema</strong>');
    expect(presentation.details.questions).toEqual([{
      header: 'Order',
      question: 'Which order?',
      options: [{ label: 'Newest', description: 'Newest first.' }],
    }]);
    expect(presentation.details.memoryCitation[0]).toEqual(expect.objectContaining({
      path: 'utils/parser.js',
      lineStart: 7,
    }));
  });

  test('keeps user messages inert and includes delivery failures in Issues', () => {
    const presentation = buildCodexEventPresentation({
      eventType: 'user.message.failed',
      severity: 'error',
      payload: {
        item: {
          type: 'user_message',
          text: '<img src=x onerror=alert(1)> **literal text**',
        },
        deliveryStatus: 'failed',
      },
    });

    expect(presentation).toEqual(expect.objectContaining({
      category: 'message',
      kind: 'user_message',
      status: 'failed',
      isIssue: true,
    }));
    expect(presentation.details.text).toContain('<img src=x');
    expect(presentation.details.html).toBe('');
  });

  test('humanizes commands without depending on commandActions and cleans details', () => {
    const presentation = buildCodexEventPresentation({
      seq: 20,
      eventType: 'item.completed',
      severity: 'info',
      createdAt: '2026-09-04T01:02:05.000Z',
      payload: {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: "bash -lc 'rg needle .; echo token=private'",
          commandActions: [{ type: 'unknown' }],
          aggregatedOutput: '\u001b[31mfailed\u001b[0m /home/person/private token=private',
          cwd: '/workspace',
          status: 'failed',
          exitCode: 1,
          durationMs: 1400,
        },
      },
    }, { workspaceRoot: '/workspace' });

    expect(presentation).toEqual(expect.objectContaining({
      category: 'work',
      kind: 'command',
      label: 'Terminal',
      summary: 'Searched the workspace',
      status: 'failed',
      severity: 'error',
      durationMs: 1400,
      isIssue: true,
    }));
    expect(presentation.details.command).toContain('token=[redacted]');
    expect(presentation.details.output).toBe('failed ~/private token=[redacted]');
    expect(presentation.details.cwd).toBe('.');
    expect(presentation.details.exitCode).toBe(1);
  });

  test('presents web results with safe URLs and result counts', () => {
    const presentation = buildCodexEventPresentation({
      eventType: 'item.completed',
      payload: {
        item: {
          type: 'webSearch',
          action: { type: 'search', query: 'Codex app server schema' },
          results: [
            { title: 'Docs', url: 'https://example.com/docs?api_key=private#fragment' },
            { title: 'Unsafe', url: 'file:///private/result' },
          ],
        },
      },
    });

    expect(presentation.summary).toBe('Searched for “Codex app server schema” · 2 results');
    expect(presentation.details.results[0]).toEqual({
      title: 'Docs',
      domain: 'example.com',
      url: 'https://example.com/docs?api_key=%5Bredacted%5D',
    });
    expect(presentation.details.results[1].url).toBe('');
  });

  test('uses tool titles, redacts structured data, and detects explicit failures', () => {
    const presentation = buildCodexEventPresentation({
      eventType: 'item.completed',
      payload: {
        item: {
          id: 'tool-1',
          type: 'mcpToolCall',
          server: 'github',
          tool: 'search_code',
          arguments: { title: 'Find parser', token: 'private', path: '/workspace/app.js' },
          result: { path: '/workspace/controllers/codex.js' },
          success: false,
        },
      },
    }, { workspaceRoot: '/workspace' });

    expect(presentation).toEqual(expect.objectContaining({
      kind: 'mcp_tool',
      label: 'github',
      summary: 'Find parser',
      status: 'failed',
      isIssue: true,
    }));
    expect(presentation.details.arguments).toEqual({
      title: 'Find parser',
      token: '[redacted]',
      path: 'app.js',
    });
    expect(presentation.details.result).toEqual({ path: 'controllers/codex.js' });
  });

  test('presents collaboration state without exposing agent thread identifiers', () => {
    const presentation = buildCodexEventPresentation({
      eventType: 'item.completed',
      payload: {
        item: {
          id: 'agent-activity-1',
          type: 'subAgentActivity',
          kind: 'started',
          agentPath: '/root/reviewer',
          agentThreadId: 'thread-private',
        },
      },
    });

    expect(presentation).toEqual(expect.objectContaining({
      category: 'collaboration',
      kind: 'collaboration',
      summary: 'Agent started',
      status: 'running',
    }));
    expect(presentation.details.agentPath).toBe('/root/reviewer');
    expect(JSON.stringify(presentation)).not.toContain('thread-private');
  });

  test('preserves file kinds, rename destinations, bounded diffs, and line counts', () => {
    const presentation = buildCodexEventPresentation({
      eventType: 'item.completed',
      payload: {
        item: {
          type: 'fileChange',
          status: 'completed',
          changes: [{
            path: '/workspace/app.js',
            kind: { type: 'rename', movePath: '/workspace/server.js' },
            diff: '--- a/app.js\n+++ b/server.js\n-old\n+new',
          }],
        },
      },
    }, { workspaceRoot: '/workspace' });

    expect(presentation.summary).toBe('Edited 1 file');
    expect(presentation.details.changes).toEqual([{
      path: 'app.js',
      kind: 'rename',
      destination: 'server.js',
      additions: 1,
      deletions: 1,
      diff: '--- a/app.js\n+++ b/server.js\n-old\n+new',
    }]);
  });

  test('preserves current plan states for the sticky side rail', () => {
    const presentation = buildCodexEventPresentation({
      eventType: 'item.completed',
      payload: {
        item: {
          type: 'todoList',
          items: [
            { text: 'Inspect', status: 'completed' },
            { text: 'Implement', status: 'inProgress' },
            { text: 'Verify', status: 'pending' },
          ],
        },
      },
    });

    expect(presentation.status).toBe('running');
    expect(presentation.summary).toBe('Plan updated · 1/3 complete · Implement');
    expect(presentation.details.items.map((item) => item.status))
      .toEqual(['completed', 'inProgress', 'pending']);
  });

  test('classifies warnings, cancellations, truncation, and failed actions as Issues', () => {
    const events = [
      { seq: 1, eventType: 'configWarning', severity: 'warning', text: '\u001b[33mBad config\u001b[0m' },
      { seq: 2, eventType: 'turn/cancelled', severity: 'warning', text: 'Cancelled' },
      { seq: 3, eventType: 'events.truncated', severity: 'warning', text: 'Storage limit reached' },
      {
        seq: 4,
        eventType: 'item.completed',
        payload: { item: { type: 'fileChange', status: 'failed', changes: [] } },
      },
    ];

    const presentations = events.map((event) => buildCodexEventPresentation(event));
    expect(presentations.every((event) => event.isIssue)).toBe(true);
    expect(presentations[0]).toEqual(expect.objectContaining({
      category: 'issue',
      summary: 'Bad config',
      tone: 'warning',
    }));
    expect(presentations[1]).toEqual(expect.objectContaining({
      category: 'lifecycle',
      status: 'cancelled',
    }));
    expect(presentations[3]).toEqual(expect.objectContaining({
      status: 'failed',
      severity: 'error',
      tone: 'danger',
    }));
  });

  test('groups empty model updates, merges action starts, and drops routine telemetry', () => {
    const events = [
      {
        seq: 1,
        eventType: 'item.completed',
        createdAt: '2026-09-04T01:00:00.000Z',
        payload: { item: { type: 'reasoning', text: '' } },
      },
      {
        seq: 2,
        eventType: 'item.completed',
        createdAt: '2026-09-04T01:00:28.000Z',
        payload: { item: { type: 'reasoning', text: '' } },
      },
      {
        seq: 3,
        eventType: 'item.started',
        createdAt: '2026-09-04T01:00:30.000Z',
        payload: { item: { id: 'command-1', type: 'commandExecution', command: 'npm test' } },
      },
      {
        seq: 4,
        eventType: 'item.completed',
        createdAt: '2026-09-04T01:00:32.000Z',
        payload: {
          item: { id: 'command-1', type: 'commandExecution', command: 'npm test', exitCode: 0 },
        },
      },
      { seq: 5, eventType: 'thread/tokenUsage/updated', payload: { total: 10 } },
    ];

    const presentations = presentCodexEvents(events);

    expect(presentations).toHaveLength(2);
    expect(presentations[0]).toEqual(expect.objectContaining({
      kind: 'model_activity',
      repeatCount: 2,
      summary: 'Model activity · 2 updates over 28s',
    }));
    expect(presentations[1]).toEqual(expect.objectContaining({
      kind: 'command',
      seq: 4,
      startedSeq: 3,
      startedAt: '2026-09-04T01:00:30.000Z',
      completedAt: '2026-09-04T01:00:32.000Z',
      durationMs: 2000,
    }));
  });

  test('gives unknown future events a readable generic row', () => {
    const presentation = buildCodexEventPresentation({
      seq: 44,
      eventType: 'future/newEvent',
      text: 'A future update happened',
    });

    expect(presentation).toEqual(expect.objectContaining({
      seq: 44,
      category: 'system',
      kind: 'event',
      label: 'Process update',
      summary: 'A future update happened',
    }));
  });

  test('sanitizes raw events independently and marks clipped data', () => {
    const raw = sanitizeRawEvent({
      id: 'raw-1',
      seq: 90,
      eventType: 'future.event',
      text: '/home/private/project/app.js /home/another/notes token=secret',
      payload: {
        cwd: '/home/private/project',
        password: 'secret',
        imageUrl: 'data:image/png;base64,private-image',
        nested: {
          apiKey: 'secret',
          path: '/home/private/project/controllers/codex.js',
          output: 'x'.repeat(13000),
          jsonPreview: '{"password":"legacy secret value"}',
        },
      },
    }, { workspaceRoot: '/home/private/project' });

    expect(raw.text).toBe('./app.js ~/notes token=[redacted]');
    expect(raw.summary).not.toContain('/home/private/project');
    expect(raw.payload).toEqual(expect.objectContaining({
      cwd: '.',
      password: '[redacted]',
      imageUrl: '[binary data omitted]',
      nested: expect.objectContaining({
        apiKey: '[redacted]',
        path: 'controllers/codex.js',
        jsonPreview: '{"password":[redacted]}',
      }),
    }));
    expect(raw.payload.nested.output).toContain('[output truncated]');
    expect(raw.truncated).toBe(true);
  });
});
