const { detailFixture } = require('./codexDetails');

function turnScrollFixture() {
  const fixture = detailFixture();
  const lines = Array.from({ length: 80 }, (_, i) => `Synthetic output ${i}: ${'wide_value_'.repeat(18)}`).join('\n');
  const markdown = `## Synthetic details\n\n[Safe link](https://example.com) and **formatted text**.\n\n\`\`\`text\n${lines}\n\`\`\`\n\n| Key | Value |\n| --- | --- |\n| wide | ${'column_'.repeat(80)} |`;
  fixture.state.turns[0].prompt = markdown;
  fixture.state.turns[0].finalResponse = markdown;
  const events = Array.from({ length: 24 }, (_, i) => ({
    id: `event-${i + 1}`, seq: i + 1, category: 'work', kind: 'command_execution',
    label: 'Synthetic command', summary: `Synthetic activity ${i + 1}`, status: 'completed',
    timestamp: `2026-09-19T10:00:${String(i + 2).padStart(2, '0')}Z`,
    details: { command: 'echo synthetic', output: lines },
  }));
  events[0] = { ...events[0], category: 'plan', kind: 'plan', details: {
    items: Array.from({ length: 40 }, (_, i) => ({ text: `Synthetic plan step ${i}`, status: 'pending' })),
  } };
  events[1] = { ...events[1], category: 'message', kind: 'agent_message', details: {
    html: fixture.payload('turn').turn.responseHtml,
  } };
  events[2] = { ...events[2], isIssue: true, category: 'issue', status: 'failed' };
  const rawEvents = events.map(event => ({
    ...event, eventType: 'item.completed', stream: 'stdout', severity: 'info',
    createdAt: event.timestamp, text: lines, payload: { synthetic: true, lines: lines.split('\n') },
  }));
  return { ...fixture, events, rawEvents, markdown };
}

module.exports = { turnScrollFixture };
