const mongoose = require('mongoose');
const Conversation5 = require('../models/conversation5');
const Conversation4 = require('../models/conversation4');
const Chat5 = require('../models/chat5');
const Chat4 = require('../models/chat4');

const SCHEMA_VERSION = 'chat5-source-export/1';
const LIMITS = Object.freeze({ references: 5000, recordBytes: 256 * 1024, bytes: 16 * 1024 * 1024, queryMs: 10000, durationMs: 30000 });
const TYPES = ['sent_text', 'received_text', 'image', 'audio', 'video', 'file', 'tool', 'reasoning', 'function_call', 'function_call_output'];
const CONTENT_TYPES = ['text', ...TYPES.slice(2)];
const isId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const scalar = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
class ExportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function parseOptions(query = {}) {
  if (Object.keys(query).some(key => !['format', 'types', 'hidden', 'raw'].includes(key))) throw new ExportError(400, 'Unknown export option.');
  const format = query.format === undefined ? 'json' : query.format;
  const types = query.types === undefined ? ['sent_text', 'received_text']
    : typeof query.types === 'string' && query.types.length <= 200 ? query.types.split(',') : [];
  if (!['json', 'jsonl'].includes(format) || !types.length || types.length > TYPES.length
    || new Set(types).size !== types.length || types.some(type => !TYPES.includes(type))
    || ['hidden', 'raw'].some(key => query[key] !== undefined && !['0', '1'].includes(query[key]))) {
    throw new ExportError(400, 'Choose a valid format and at least one message type.');
  }
  return { format, types: TYPES.filter(type => types.includes(type)), include_hidden: query.hidden === '1', include_raw: query.raw === '1' };
}
function timestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(+date) ? null : date.toISOString();
}

// Raw means selected typed source fields, never an unrestricted provider envelope.
function rawPart(raw, contentType, depth = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 4) return null;
  const allowedTypes = {
    text: ['message', 'output_text', 'text', 'refusal'],
    reasoning: ['reasoning', 'summary_text', 'reasoning_text'],
    tool: ['web_search_call', 'file_search_call', 'code_interpreter_call', 'computer_call', 'mcp_call', 'custom_tool_call'],
    function_call: ['function_call'], function_call_output: ['function_call_output'],
  };
  if (!(allowedTypes[contentType] || []).includes(raw.type)) return null;
  const out = {};
  for (const key of ['type', 'id', 'status', 'role', 'call_id', 'name']) {
    if (scalar(raw[key]) !== null) out[key] = raw[key];
  }
  for (const key of contentType === 'text' ? ['text', 'refusal']
    : contentType === 'reasoning' ? ['text'] : ['arguments', 'output']) {
    if (typeof raw[key] === 'string') out[key] = raw[key];
  }
  for (const key of ['content', 'summary']) {
    if (Array.isArray(raw[key])) out[key] = raw[key].map(part => rawPart(part, contentType, depth + 1)).filter(Boolean);
  }
  if (contentType === 'text' && Array.isArray(raw.annotations)) {
    out.annotations = raw.annotations.filter(a => a && a.type === 'url_citation').map(a => {
      const annotation = { type: 'url_citation' };
      for (const key of ['start_index', 'end_index', 'title']) if (scalar(a[key]) !== null) annotation[key] = a[key];
      try {
        const url = new URL(a.url);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) annotation.url = a.url;
      } catch (_) { /* Non-web/local source locations are never exported. */ }
      return annotation;
    });
  }
  // Search action queries are selected tool content, not arbitrary file locations.
  if (contentType === 'tool' && raw.type === 'web_search_call' && raw.action) {
    out.action = {};
    for (const key of ['type', 'query']) if (typeof raw.action[key] === 'string') out.action[key] = raw.action[key];
    if (Array.isArray(raw.action.queries)) out.action.queries = raw.action.queries.filter(v => typeof v === 'string');
  }
  return out;
}
function legacyParts(doc) {
  const base = { _id: doc._id, user_id: doc.user_id, timestamp: doc.timestamp };
  return [
    ...(doc.images || []).map((image, index) => ({ ...base, part: `images[${index}]`, contentType: 'image', hideFromBot: image.use_flag === 'do not use', content: {} })),
    ...(doc.sound ? [{ ...base, part: 'sound', contentType: 'audio', hideFromBot: true, content: {} }] : []),
    { ...base, part: 'prompt', contentType: 'text', content: { text: doc.prompt } },
    { ...base, part: 'response', user_id: 'bot', contentType: 'text', content: { text: doc.response } },
  ];
}
function makeEntry(doc, position, referenceId, source, duplicate, options) {
  const content = doc.content || {};
  const role = doc.user_id === 'bot' ? 'assistant' : typeof doc.user_id === 'string' && doc.user_id.length ? 'user' : 'unknown';
  const type = doc.contentType;
  const selector = type === 'text' ? role === 'assistant' ? 'received_text' : role === 'user' ? 'sent_text' : null : type;
  const selected = options.types.includes(selector) && (!doc.hideFromBot || options.include_hidden);
  const flags = [];
  if (duplicate) flags.push('duplicate_reference');
  if (role === 'unknown' || !CONTENT_TYPES.includes(type)) flags.push('unknown_record');
  if (content.error) flags.push('source_error');
  const status = scalar(content.status) || scalar(content.raw?.status) || 'unknown';
  if (!['completed', 'unknown'].includes(status)) flags.push('noncompleted_status');
  if (type === 'text' && (typeof content.text !== 'string' || !content.text.trim())) flags.push('empty_text');
  if (role === 'assistant' && content.text === 'Pending response') flags.push('pending_placeholder');
  const entry = {
    position, message_id: referenceId, source_collection: source === 'conversation5' ? 'chat5' : 'chat4',
    source_part: doc.part || null, role, content_type: type || null, hidden: !!doc.hideFromBot,
    timestamp: timestamp(doc.timestamp), selected, status, flags,
    response_id: scalar(content.responseId), output_id: scalar(content.outputId), output_index: scalar(content.outputIndex),
    call_id: scalar(content.callId), tool_call_id: scalar(content.toolCallId),
    exclusion_reason: selected ? null : !selector || !options.types.includes(selector) ? 'type_not_selected' : 'hidden_not_selected',
  };
  if (selected) {
    entry.content = {};
    // Text is copied byte-for-byte; media paths, bytes, credentials and provider envelopes are not serialized.
    const fields = type === 'text' ? ['text'] : type === 'reasoning' ? ['text']
      : ['tool', 'function_call', 'function_call_output'].includes(type) ? ['text', 'toolOutput', 'arguments', 'output']
        : ['text', 'transcript', 'revisedPrompt'];
    for (const field of fields) if (typeof content[field] === 'string') entry.content[field] = content[field];
    entry.structured_fields_omitted = ['arguments', 'output', 'result', 'summary'].filter(field => content[field] && typeof content[field] === 'object');
    if (['image', 'audio', 'video', 'file'].includes(type)) entry.attachment = { bytes_included: false, locations_omitted: true };
    if (options.include_raw) {
      entry.raw = rawPart(content.raw, type);
      entry.raw_policy = 'typed_allowlist_v1';
    }
  }
  return entry;
}

// Group the full sequence first. A run of user turns followed by assistant outputs
// stays together; no FIFO, latest-prompt, or timestamp-based pairing is inferred.
function candidateGroups(entries) {
  const groups = [];
  let current = [];
  function flush() { if (current.length) groups.push(current); current = []; }
  for (const entry of entries) {
    if (entry.flags.includes('missing_reference') || entry.flags.includes('unknown_record') || entry.flags.includes('duplicate_reference')) {
      flush(); groups.push([entry]); continue;
    }
    if (entry.role === 'user' && current.some(e => e.role === 'assistant')) flush();
    current.push(entry);
  }
  flush();
  // A response ID crossing a user boundary cannot establish prompt causality.
  const responseGroups = new Map();
  groups.forEach((group, index) => group.forEach(e => {
    if (e.response_id) {
      if (!responseGroups.has(e.response_id)) responseGroups.set(e.response_id, new Set());
      responseGroups.get(e.response_id).add(index);
    }
  }));
  return groups.map((group, index) => {
    const prompts = group.filter(e => e.role === 'user' && e.content_type === 'text');
    const answers = group.filter(e => e.role === 'assistant' && e.content_type === 'text');
    const answerUnits = new Set(answers.map(e => e.response_id || `position:${e.position}:${e.source_part}`));
    const reasons = [...new Set(group.flatMap(e => e.flags))];
    if (prompts.length > 1) reasons.push('multiple_prompts');
    if (answerUnits.size > 1) reasons.push('multiple_responses');
    if (!prompts.length || !answers.length) reasons.push('unpaired');
    if ([...prompts, ...answers].some(e => !e.selected)) reasons.push('text_filtered_out');
    if (group.some(e => e.role === 'user' && e.content_type !== 'text')) reasons.push('nontext_user_context');
    if (group.some(e => e.response_id && responseGroups.get(e.response_id).size > 1)) reasons.push('response_crosses_turn_boundary');
    if (group.some(e => e.role === 'assistant' && e.content_type !== 'text'
      && (!e.response_id || !answers.some(a => a.response_id === e.response_id)))) reasons.push('unlinked_assistant_part');
    const ambiguous = prompts.length > 1 || answerUnits.size > 1;
    return {
      record_type: ambiguous ? 'ambiguous_group' : reasons.length ? 'review' : 'pair_candidate',
      group_id: `group-${index}`, position_start: group[0].position, position_end: group[group.length - 1].position,
      prompt_refs: prompts.map(ref), response_refs: answers.map(ref),
      records: group,
      response_groups: [...new Set(group.map(e => e.response_id).filter(Boolean))].map(id => ({ response_id: id, refs: group.filter(e => e.response_id === id).map(ref) })),
      call_groups: [...new Set(group.map(e => e.call_id || e.tool_call_id).filter(Boolean))].map(id => ({ call_id: id, refs: group.filter(e => (e.call_id || e.tool_call_id) === id).map(ref) })),
      reasons, causality: 'positional_unverified', context_sufficiency: 'unreviewed', review_status: 'unreviewed',
      historical_context: { conversation_position_start: 0, before_position: group[0].position, effective_prompt_available: false },
    };
  });
}
function ref(entry) { return { position: entry.position, message_id: entry.message_id, source_part: entry.source_part }; }
function buildExport({ conversation, source, documents, options, exportedAt = new Date() }) {
  const byId = new Map(documents.map(doc => [String(doc._id).toLowerCase(), doc]));
  const seen = new Set();
  let expandedBytes = 0;
  let expandedCount = 0;
  const entries = conversation.messages.flatMap((id, position) => {
    const duplicate = seen.has(String(id).toLowerCase());
    seen.add(String(id).toLowerCase());
    const doc = byId.get(String(id).toLowerCase());
    if (!doc) return [{ position, message_id: id, source_collection: source === 'conversation5' ? 'chat5' : 'chat4', source_part: null, selected: false, flags: ['missing_reference', ...(duplicate ? ['duplicate_reference'] : [])] }];
    return (source === 'conversation5' ? [doc] : legacyParts(doc)).map(part => {
      const entry = makeEntry(part, position, id, source, duplicate, options);
      expandedBytes += Buffer.byteLength(JSON.stringify(entry));
      expandedCount += 1;
      if (expandedBytes > LIMITS.bytes || expandedCount > 20000) throw new ExportError(413, 'Expanded source exceeds export safety limits. Select fewer types or turn off raw content.');
      return entry;
    });
  });
  const groups = candidateGroups(entries);
  const summary = {
    reference_count: conversation.messages.length, record_count: entries.length,
    selected_records: entries.filter(e => e.selected).length,
    excluded_records: entries.filter(e => !e.selected && !e.flags.includes('missing_reference')).length,
    missing_references: entries.filter(e => e.flags.includes('missing_reference')).length,
    duplicate_positions: conversation.messages.length - seen.size,
    unknown_records: entries.filter(e => e.flags.includes('unknown_record')).length,
    pair_candidates: groups.filter(g => g.record_type === 'pair_candidate').length,
    ambiguous_groups: groups.filter(g => g.record_type === 'ambiguous_group').length,
    review_groups: groups.filter(g => g.record_type === 'review').length,
  };
  const manifest = {
    record_type: 'export_manifest', schema_version: SCHEMA_VERSION, exporter_version: '1.0.0', exported_at: timestamp(exportedAt),
    conversation: { id: String(conversation._id), source_collection: source, created_at: timestamp(conversation.createdAt), updated_at: timestamp(conversation.updatedAt || conversation.updated_date) },
    options, summary,
    limitations: {
      current_surviving_records_only: true, historical_effective_prompts_available: false, historical_settings_available: false,
      edit_history_available: false, copy_ancestry_available: false, transactional_snapshot: false,
      reference_list_rechecked: true, message_edits_during_read_not_detected: true,
      hidden_flag_is_not_provider_context_proof: true, training_ready: false,
      media_locations_and_bytes_omitted: true, raw_is_typed_allowlist: true,
    },
  };
  // JSON is the ordered source; JSONL keeps one manifest and whole candidate/review groups.
  const body = options.format === 'json' ? JSON.stringify({ ...manifest, records: entries, groups: groups.map(({ records, ...group }) => group) }, null, 2)
    : [JSON.stringify(manifest), ...groups.map(group => JSON.stringify({ schema_version: SCHEMA_VERSION, conversation_id: String(conversation._id), ...group }))].join('\n') + '\n';
  if (Buffer.byteLength(body, 'utf8') > LIMITS.bytes) throw new ExportError(413, 'Export exceeds 16 MiB. Select fewer types or turn off raw content.');
  return { body, manifest, groups };
}

function createExportService({ conversation5 = Conversation5, conversation4 = Conversation4, chat5 = Chat5, chat4 = Chat4 } = {}) {
  async function findConversation(model, filter, maxTimeMS) {
    const rows = await model.aggregate([
      { $match: filter },
      { $project: { _id: 1, members: 1, user_id: 1, createdAt: 1, updatedAt: 1, updated_date: 1,
        messages: { $slice: [{ $ifNull: ['$messages', []] }, LIMITS.references + 1] },
        referenceCount: { $size: { $ifNull: ['$messages', []] } } } },
      { $limit: 1 },
    ]).option({ maxTimeMS });
    return rows[0] || null;
  }
  return async function exportConversation(id, principal, options) {
    if (!isId(id)) throw new ExportError(400, 'Invalid conversation ID.');
    if (!principal || typeof principal.name !== 'string' || !principal.name.trim()) throw new ExportError(403, 'A validated account is required.');
    const deadline = Date.now() + LIMITS.durationMs;
    function queryBudget() {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ExportError(503, 'Export timed out. Please try again later.');
      return Math.min(LIMITS.queryMs, remaining);
    }
    const _id = new mongoose.Types.ObjectId(id);
    let model = conversation5;
    let filter = { _id, members: principal.name };
    let conversation = await findConversation(model, filter, queryBudget());
    let source = 'conversation5';
    if (!conversation) {
      model = conversation4; filter = { _id, user_id: principal.name }; source = 'conversation4';
      conversation = await findConversation(model, filter, queryBudget());
    }
    if (!conversation) throw new ExportError(404, 'Conversation not found.');
    if (conversation.referenceCount > LIMITS.references) throw new ExportError(413, 'Conversation exceeds the 5,000 reference export limit.');
    const ids = [...new Set(conversation.messages.filter(isId).map(id => id.toLowerCase()))];
    const messageModel = source === 'conversation5' ? chat5 : chat4;
    const documents = [];
    let bytes = 0;
    for (let offset = 0; offset < ids.length; offset += 50) {
      const rows = await messageModel.aggregate([
        { $match: { _id: { $in: ids.slice(offset, offset + 50).map(id => new mongoose.Types.ObjectId(id)) } } },
        { $project: { size: { $bsonSize: '$$ROOT' }, doc: { $cond: [{ $lte: [{ $bsonSize: '$$ROOT' }, LIMITS.recordBytes] }, '$$ROOT', null] } } },
        { $project: source === 'conversation5'
          ? { size: 1, 'doc._id': 1, 'doc.user_id': 1, 'doc.timestamp': 1, 'doc.hideFromBot': 1, 'doc.contentType': 1, 'doc.content': 1 }
          : { size: 1, 'doc._id': 1, 'doc.user_id': 1, 'doc.timestamp': 1, 'doc.prompt': 1, 'doc.response': 1, 'doc.images.use_flag': 1, 'doc.sound': 1 } },
      ]).option({ maxTimeMS: queryBudget() });
      for (const row of rows) {
        bytes += row.size;
        if (row.size > LIMITS.recordBytes || bytes > LIMITS.bytes || !row.doc) throw new ExportError(413, 'Stored source exceeds export safety limits (256 KiB per message, 16 MiB total).');
        documents.push(row.doc);
      }
    }
    const after = await findConversation(model, filter, queryBudget());
    queryBudget();
    if (!after) throw new ExportError(404, 'Conversation not found.');
    if (JSON.stringify(conversation) !== JSON.stringify(after)) throw new ExportError(409, 'Conversation changed during export. Wait for responses to finish and try again.');
    return buildExport({ conversation, source, documents, options });
  };
}
module.exports = { SCHEMA_VERSION, LIMITS, TYPES, ExportError, parseOptions, buildExport, createExportService };
