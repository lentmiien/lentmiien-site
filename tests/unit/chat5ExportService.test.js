const { buildExport, parseOptions, createExportService, LIMITS, TYPES } = require('../../services/chat5ExportService');
const id = n => n.toString(16).padStart(24, '0');
const message = (n, role = 'user', contentType = 'text', content = {}, extra = {}) => ({
  _id: id(n), user_id: role === 'assistant' ? 'bot' : 'member', contentType,
  content: { text: `source ${n}\n日本語 😀`, ...content }, timestamp: new Date(1800000000000 - n * 1000), ...extra,
});
function run(documents, query = {}, refs = documents.map(d => d._id), source = 'conversation5') {
  return buildExport({ conversation: { _id: id(9000), members: ['member'], user_id: 'member', messages: refs, metadata: { maxMessages: 1 }, referenceCount: refs.length },
    documents, source, options: parseOptions(query), exportedAt: new Date('2026-01-01T00:00:00Z') });
}
const aggregateModel = handler => ({ aggregate: jest.fn(pipeline => ({ option: jest.fn(async options => { expect(options.maxTimeMS).toBe(10000); return handler(pipeline); }) })) });
function serviceFixture({ conversation, docs = [], legacy = false, changed = false, bytes = 100 } = {}) {
  const stored = conversation || { _id: id(9000), members: ['member'], user_id: 'member', messages: docs.map(d => d._id), referenceCount: docs.length };
  let calls = 0;
  const conv = aggregateModel(pipeline => {
    const filter = pipeline[0].$match;
    if (String(filter._id) !== String(stored._id) || (filter.members || filter.user_id) !== 'member') return [];
    calls += 1;
    return [{ ...stored, ...(changed && calls > 1 ? { messages: [] } : {}) }];
  });
  const absent = aggregateModel(() => []);
  const chat = aggregateModel(pipeline => docs.filter(d => pipeline[0].$match._id.$in.some(key => String(key) === String(d._id))).map(doc => ({ doc, size: bytes })));
  return { exportConversation: createExportService({ conversation5: legacy ? absent : conv, conversation4: legacy ? conv : absent, chat5: legacy ? absent : chat, chat4: legacy ? chat : absent }), conv, absent, chat };
}

test('ordered JSON preserves full history, exact Unicode/multiline text and source timestamps, with no settings or identity leakage', () => {
  const docs = Array.from({ length: 100 }, (_, n) => message(n + 1, n % 2 ? 'assistant' : 'user'));
  docs[0].content.text = ' \r\n雪\n\t😀 </script>  ';
  docs[0].content.raw = { credentials: 'SECRET', type: 'message', content: [{ type: 'reasoning', text: 'HIDDEN' }] };
  const { body, manifest } = run(docs.reverse(), {}, docs.map(d => d._id).reverse());
  const data = JSON.parse(body);
  expect(manifest.summary).toMatchObject({ reference_count: 100, selected_records: 100, pair_candidates: 50 });
  expect(data.records[0]).toMatchObject({ position: 0, message_id: id(1), content: { text: ' \r\n雪\n\t😀 </script>  ' } });
  expect(data.records[0].timestamp > data.records[1].timestamp).toBe(true);
  expect(body).not.toMatch(/SECRET|HIDDEN|user_id|members|maxMessages|contextPrompt/);
  expect(data.limitations).toMatchObject({ training_ready: false, historical_effective_prompts_available: false, transactional_snapshot: false });
});

test('synthetic 179-reference shape yields 79 candidates and one intact 2x2 ambiguous group at 36–39', () => {
  const docs = [];
  let number = 1;
  for (let n = 0; n < 18; n++) docs.push(message(number++), message(number++, 'assistant'));
  docs.push(message(number++), message(number++), message(number++, 'assistant'), message(number++, 'assistant'));
  for (let n = 0; n < 61; n++) {
    docs.push(message(number++));
    const responseId = n < 36 ? `response-${n}` : undefined;
    if (n < 17) docs.push(message(number++, 'assistant', n < 10 ? 'reasoning' : 'tool', { responseId, text: n < 2 ? undefined : 'hidden source' }, { hideFromBot: true }));
    docs.push(message(number++, 'assistant', 'text', { responseId }));
  }
  const result = run(docs, { format: 'jsonl' });
  expect(result.manifest.summary).toMatchObject({ reference_count: 179, selected_records: 162, excluded_records: 17, pair_candidates: 79, ambiguous_groups: 1, review_groups: 0 });
  const lines = result.body.trimEnd().split('\n').map(line => JSON.parse(line));
  const ambiguous = lines.find(line => line.record_type === 'ambiguous_group');
  expect(ambiguous).toMatchObject({ position_start: 36, position_end: 39, context_sufficiency: 'unreviewed', causality: 'positional_unverified' });
  expect(ambiguous.prompt_refs).toHaveLength(2);
  expect(ambiguous.response_refs).toHaveLength(2);
  expect(lines).toHaveLength(81);
  expect(result.body).not.toContain('hidden source');
  expect(lines.filter(l => l.record_type === 'pair_candidate').every(l => l.review_status === 'unreviewed')).toBe(true);
});

test.each(TYPES)('selection %s requires independent hidden opt-in; raw is never implicitly exported', type => {
  const contentType = type.endsWith('_text') ? 'text' : type;
  const doc = message(1, type === 'sent_text' ? 'user' : 'assistant', contentType, { text: 'selected payload', raw: { type: 'output_text', text: 'RAW-SECRET' } }, { hideFromBot: true });
  const excluded = run([doc], { types: type });
  expect(excluded.manifest.summary.selected_records).toBe(0);
  expect(excluded.body).not.toContain('selected payload');
  const selected = run([doc], { types: type, hidden: '1' });
  expect(selected.manifest.summary.selected_records).toBe(1);
  expect(selected.body).toContain('selected payload');
  expect(selected.body).not.toContain('RAW-SECRET');
});

test('raw text retains typed text and citations but cannot include reasoning, tools, envelope secrets or media paths', () => {
  const raw = { type: 'message', status: 'completed', api_key: 'CREDENTIAL', path: '/private/SECRET', content: [
    { type: 'output_text', text: 'exact\ntext', annotations: [{ type: 'url_citation', url: 'https://example.org/source', title: 'Source', start_index: 0, end_index: 4 }, { type: 'file_citation', filename: '/private/SECRET' }] },
    { type: 'reasoning', text: 'REASONING-SECRET' }, { type: 'function_call', arguments: 'TOOL-SECRET' },
  ] };
  const result = run([message(1, 'assistant', 'text', { raw }), message(2, 'user', 'image', { image: '/private/SECRET' })], { raw: '1', types: 'received_text,image' });
  const data = JSON.parse(result.body);
  expect(data.records[0].raw.content).toHaveLength(1);
  expect(data.records[0].raw.content[0].annotations).toHaveLength(1);
  expect(result.body).toContain('https://example.org/source');
  expect(result.body).not.toMatch(/CREDENTIAL|SECRET/);
  expect(data.records[1].attachment.locations_omitted).toBe(true);
});

test('reasoning, search actions and function strings require selected types and raw opt-in', () => {
  const docs = [
    message(1, 'assistant', 'reasoning', { raw: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'summary exact' }], encrypted_content: 'SECRET' } }),
    message(2, 'assistant', 'tool', { raw: { type: 'web_search_call', status: 'completed', action: { type: 'search', queries: ['one', 'two'], local_path: 'SECRET' } } }),
    message(3, 'assistant', 'function_call', { callId: 'call-1', arguments: '{"x":1}', raw: { type: 'function_call', call_id: 'call-1', arguments: '{"x":1}' } }),
    message(4, 'assistant', 'function_call_output', { callId: 'call-1', output: 'exact result', raw: { type: 'function_call_output', output: 'exact result' } }),
  ];
  const data = JSON.parse(run(docs, { types: 'reasoning,tool,function_call,function_call_output', raw: '1' }).body);
  expect(data.records[0].raw.summary[0].text).toBe('summary exact');
  expect(data.records[1].raw.action.queries).toEqual(['one', 'two']);
  expect(data.records[2].call_id).toBe('call-1');
  expect(data.records[3].content.output).toBe('exact result');
  expect(JSON.stringify(data)).not.toContain('SECRET');
});

test('missing/invalid and duplicate references preserve positions and create review boundaries', () => {
  const docs = [message(1), message(2, 'assistant')];
  const result = run(docs, {}, [id(1), 'invalid-ref', id(2), id(1), id(2)]);
  const data = JSON.parse(result.body);
  expect(data.records.map(e => e.position)).toEqual([0, 1, 2, 3, 4]);
  expect(result.manifest.summary).toMatchObject({ missing_references: 1, duplicate_positions: 2, pair_candidates: 0 });
  expect(data.records[1].flags).toContain('missing_reference');
  expect(data.records[3].flags).toContain('duplicate_reference');
});

test('filtering hidden intervening users or unknown records cannot create artificial pairs', () => {
  const docs = [message(1), message(2, 'user', 'text', { text: 'hidden user' }, { hideFromBot: true }), message(3, 'assistant')];
  const result = run(docs);
  expect(result.manifest.summary.pair_candidates).toBe(0);
  expect(result.groups[0].record_type).toBe('ambiguous_group');
  expect(result.groups[0].prompt_refs).toHaveLength(2);
  expect(result.body).not.toContain('hidden user');
  const unknown = run([message(1), message(2, 'assistant', 'unexpected'), message(3, 'assistant')]);
  expect(unknown.manifest.summary.pair_candidates).toBe(0);
});

test('extra responses remain ambiguous; reliable multipart response IDs group without concatenating hidden reasoning', () => {
  const extra = run([message(1), message(2, 'assistant'), message(3, 'assistant')]);
  expect(extra.groups[0].record_type).toBe('ambiguous_group');
  const parts = run([message(1), message(2, 'assistant', 'reasoning', { responseId: 'resp', text: 'private reasoning' }, { hideFromBot: true }),
    message(3, 'assistant', 'text', { responseId: 'resp', outputIndex: 0 }), message(4, 'assistant', 'text', { responseId: 'resp', outputIndex: 1 })]);
  expect(parts.groups[0].record_type).toBe('pair_candidate');
  expect(parts.groups[0].response_refs).toHaveLength(2);
  expect(parts.groups[0].response_groups[0].refs).toHaveLength(3);
  expect(parts.body).not.toContain('private reasoning');
  const crossing = run([message(1), message(2, 'assistant', 'text', { responseId: 'resp' }), message(3), message(4, 'assistant', 'text', { responseId: 'resp' })]);
  expect(crossing.manifest.summary.pair_candidates).toBe(0);
  expect(crossing.groups[0].reasons).toContain('response_crosses_turn_boundary');
});

test.each([{ text: '' }, { text: 'Pending response' }, { status: 'in_progress' }, { error: 'provider details' }, { raw: { status: 'failed' } }])('pending, empty and failed answers are never pair candidates: %j', content => {
  const result = run([message(1), message(2, 'assistant', 'text', content)], { hidden: '1' });
  expect(result.manifest.summary.pair_candidates).toBe(0);
  expect(result.groups[0].record_type).toBe('review');
  expect(result.body).not.toContain('provider details');
});

test('leading answers and trailing prompts are review records and absent reasoning text is not an empty answer', () => {
  const result = run([message(1, 'assistant'), message(2), message(3, 'assistant', 'reasoning', { text: undefined, responseId: 'resp' }), message(4, 'assistant', 'text', { responseId: 'resp' }), message(5)]);
  expect(result.manifest.summary).toMatchObject({ review_groups: 2, pair_candidates: 1 });
});

test('legacy parts have stable source ID + part identity, source timestamps, and no synthetic IDs or paths', () => {
  const doc = { _id: id(1), user_id: 'member', prompt: 'prompt\n雪', response: 'response\n😀', images: [{ filename: '/private/secret', use_flag: 'do not use' }], sound: '/private/sound', timestamp: new Date('2020-01-01') };
  const result = run([doc], { types: 'sent_text,received_text,image,audio', hidden: '1' }, [id(1)], 'conversation4');
  const records = JSON.parse(result.body).records;
  expect(records.map(e => e.source_part)).toEqual(['images[0]', 'sound', 'prompt', 'response']);
  expect(records.every(e => e.message_id === id(1) && e.position === 0 && e.source_collection === 'chat4')).toBe(true);
  expect(records[2].content.text).toBe(doc.prompt);
  expect(result.body).not.toContain('/private/');
});

test.each([{ types: '' }, { types: ['sent_text'] }, { raw: 'true' }, { hidden: {} }, { format: 'csv' }, { owner: 'other' }, { types: 'sent_text,sent_text' }])('rejects malformed options %j', query => {
  expect(() => parseOptions(query)).toThrow();
});

test('bounded output rejects repeated large references before building an unbounded download', () => {
  const doc = message(1, 'user', 'text', { text: 'x'.repeat(100000) });
  expect(() => run([doc], {}, Array(200).fill(id(1)))).toThrow(/safety limits/);
});

test.each([false, true])('service resolves only authorized complete reference list and rechecks membership, legacy=%s', async legacy => {
  const docs = [message(1), message(2, 'assistant')];
  if (legacy) docs.forEach(d => { d.prompt = 'prompt'; d.response = 'response'; });
  const fixture = serviceFixture({ docs, legacy });
  const result = await fixture.exportConversation(id(9000), { name: 'member' }, parseOptions());
  expect(result.manifest.summary.reference_count).toBe(2);
  expect(fixture.chat.aggregate.mock.calls[0][0][0].$match._id.$in.map(String)).toEqual([id(1), id(2)]);
  expect(fixture.conv.aggregate).toHaveBeenCalledTimes(2);
  expect(Object.keys(fixture.conv)).toEqual(['aggregate']); // No mutation API needed.
});

test.each([false, true])('foreign/missing objects return identical 404 and never fetch linked records, legacy=%s', async legacy => {
  const fixture = serviceFixture({ docs: [message(1)], legacy });
  for (const [key, principal] of [[id(9000), { name: 'foreign', type_user: 'admin' }], [id(9999), { name: 'member' }]]) {
    await expect(fixture.exportConversation(key, principal, parseOptions())).rejects.toMatchObject({ status: 404, message: 'Conversation not found.' });
  }
  expect(fixture.chat.aggregate).not.toHaveBeenCalled();
});

test('invalid ID is rejected before lookup; reference count, record size and concurrent edits fail safely', async () => {
  const bad = serviceFixture();
  await expect(bad.exportConversation('../file', { name: 'member' }, parseOptions())).rejects.toMatchObject({ status: 400 });
  expect(bad.conv.aggregate).not.toHaveBeenCalled();
  const tooMany = serviceFixture({ conversation: { _id: id(9000), messages: [], referenceCount: LIMITS.references + 1 } });
  await expect(tooMany.exportConversation(id(9000), { name: 'member' }, parseOptions())).rejects.toMatchObject({ status: 413 });
  expect(tooMany.chat.aggregate).not.toHaveBeenCalled();
  const large = serviceFixture({ docs: [message(1)], bytes: LIMITS.recordBytes + 1 });
  await expect(large.exportConversation(id(9000), { name: 'member' }, parseOptions())).rejects.toMatchObject({ status: 413 });
  const changed = serviceFixture({ docs: [message(1)], changed: true });
  await expect(changed.exportConversation(id(9000), { name: 'member' }, parseOptions())).rejects.toMatchObject({ status: 409 });
});

test('hidden and raw switches never override type selection', () => {
  const docs = [message(1, 'assistant', 'reasoning', { text: 'HIDDEN-SECRET', raw: { type: 'reasoning', text: 'RAW-SECRET' } }, { hideFromBot: true }),
    message(2, 'assistant', 'tool', { text: 'TOOL-SECRET' }, { hideFromBot: true })];
  const result = run(docs, { hidden: '1', raw: '1' });
  expect(result.manifest.summary.selected_records).toBe(0);
  expect(result.body).not.toContain('SECRET');
});

test('call IDs group function parts without declaring prompt causality', () => {
  const result = run([message(1), message(2, 'assistant', 'function_call', { callId: 'call-1', arguments: '{"key":"value"}' }),
    message(3, 'assistant', 'function_call_output', { toolCallId: 'call-1', output: 'result' }), message(4, 'assistant')], { types: 'sent_text,received_text,function_call,function_call_output' });
  expect(result.groups[0].call_groups[0].refs.map(ref => ref.position)).toEqual([1, 2]);
  expect(result.groups[0].causality).toBe('positional_unverified');
  expect(result.groups[0].record_type).toBe('review');
});

test('cumulative source size is bounded across batches even when all content is excluded', async () => {
  const fixture = serviceFixture({ docs: Array.from({ length: 65 }, (_, n) => message(n + 1)), bytes: LIMITS.recordBytes });
  await expect(fixture.exportConversation(id(9000), { name: 'member' }, parseOptions({ types: 'image' }))).rejects.toMatchObject({ status: 413 });
  expect(fixture.chat.aggregate).toHaveBeenCalledTimes(2);
});

test('membership revoked on the final read cannot return previously loaded content', async () => {
  let reads = 0;
  const conversation = aggregateModel(() => ++reads === 1 ? [{ _id: id(9000), messages: [], referenceCount: 0 }] : []);
  const never = aggregateModel(() => { throw new Error('unexpected query'); });
  const service = createExportService({ conversation5: conversation, conversation4: never, chat5: never, chat4: never });
  await expect(service(id(9000), { name: 'member' }, parseOptions())).rejects.toMatchObject({ status: 404 });
});

test('total read budget rejects a slow export before more message batches', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValue(31001);
  try {
    const fixture = serviceFixture({ docs: [message(1)] });
    await expect(fixture.exportConversation(id(9000), { name: 'member' }, parseOptions())).rejects.toMatchObject({ status: 503 });
  } finally { clock.mockRestore(); }
});
