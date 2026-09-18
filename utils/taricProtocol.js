const crypto = require('crypto');
const { fail, object, string, validateRequest, taric, hash } = require('./taricContracts');
const TEST_ADAPTER = 'taric-v1-20260917-2';
const BASE_MODEL = 'Qwen/Qwen3-4B-Instruct-2507';
const TRAINING_SHA = '22ea56418479ecc6d962ad1328eef54c3897aa5b99095093e8231984e8d070be';
const CLEANED_SHA = '799e95dcce447381ca49aeaae65fb7937896971e0d3f943d12c40996b9f51ef8';
const SYSTEM = 'You are an EU customs classification assistant. Analyze one product request using its category, item name, specifications, and HS code. Return exactly one valid JSON object with two keys: taric_code, containing a single 10-digit EU TARIC code, and description, containing a concise plain-language classification description of fewer than 256 characters. Choose the most likely code and do not list alternatives. Include the product\'s form, material, function, and classification rationale when supported by the request. Output no Markdown, prose, comments, or extra keys.';
const VERSIONS = Object.freeze({ renderer: 'trained-csv/1', parser: 'strict-json/1', decoding: 'greedy/1', scoring: 'exact-all-cases/1', tokenBudget: 'utf8-upper-bound/1' });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function hs(value) {
  string(value, 7, 'INVALID_REQUEST', /^(?:[0-9]{6}|[0-9]{4}\.[0-9]{2})$/);
  return value.replace('.', '');
}
function input(value) {
  object(value, ['jan', 'item_code', 'descriptive_name', 'input_hs_code', 'test'], 'INVALID_REQUEST');
  if (Object.hasOwn(value, 'test') && typeof value.test !== 'boolean') fail('INVALID_REQUEST');
  const { test, ...rest } = value;
  return { ...validateRequest({ ...rest, input_hs_code: hs(rest.input_hs_code) }), test: test === true };
}
function render(row) {
  string(row.descriptive_name, 500, 'INVALID_REQUEST');
  string(row.full_item_name, 1000, 'INVALID_REQUEST');
  if (typeof row.specs !== 'string' || row.specs.length > 12000) fail('INVALID_REQUEST');
  const code = hs(row.hs_code);
  return `Please give me a description and suitable TARIC code for the following item:\n\nCategory: ${row.descriptive_name}\n\n### ${row.full_item_name}\n\n${row.specs}\n\nOur HS code: ${code.slice(0, 4)}.${code.slice(4)}`;
}
function messages(row) { return [{ role: 'system', content: SYSTEM }, { role: 'user', content: render(row) }]; }
function payload(row, adapter, maxTokens = 256) {
  string(adapter, 100, 'CONFIG_NOT_READY', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 512) fail('CONFIG_NOT_READY');
  const chat = messages(row);
  // Each UTF-8 byte is charged a token, plus 128 for chat framing. Deliberately
  // overrejects multilingual/long inputs until a matching tokenizer is available.
  if (chat.reduce((n, m) => n + Buffer.byteLength(m.content), 0) + maxTokens + 128 > 2048) fail('TOKEN_BUDGET');
  return { messages: chat, adapter_name: adapter, do_sample: false, temperature: 0,
    repetition_penalty: 1.05, max_new_tokens: maxTokens };
}
// Recursive descent only to enforce unique keys/prototype safety; JSON.parse handles
// string/number grammar. All callers cap bytes before this parser allocates objects.
function strictJson(text, code = 'INVALID_RESULT') {
  if (typeof text !== 'string') fail(code);
  let i = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[i] || '!')) i++; };
  function str() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') { try { return JSON.parse(text.slice(start, i)); } catch (_) { fail(code); } }
    }
    fail(code);
  }
  function value(depth) {
    if (depth > 20) fail(code);
    whitespace();
    const c = text[i];
    if (c === '"') return str();
    if (c === '{' || c === '[') {
      i++; whitespace();
      const obj = c === '{'; const out = obj ? {} : []; const keys = new Set(); const end = obj ? '}' : ']';
      if (text[i] === end) { i++; return out; }
      while (i < text.length) {
        whitespace();
        let key;
        if (obj) {
          if (text[i] !== '"') fail(code);
          key = str(); whitespace();
          if (keys.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || text[i++] !== ':') fail(code);
          keys.add(key);
        }
        const v = value(depth + 1);
        if (obj) out[key] = v; else out.push(v);
        whitespace();
        if (text[i] === end) { i++; return out; }
        if (text[i++] !== ',') fail(code);
      }
      fail(code);
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!match) fail(code);
    i += match[0].length;
    const v = JSON.parse(match[0]);
    if (typeof v === 'number' && !Number.isFinite(v)) fail(code);
    return v;
  }
  const result = value(0); whitespace();
  if (i !== text.length) fail(code);
  return result;
}
function validateOutput(envelope, codes, diagnostic) {
  diagnostic.stage = 'envelope';
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('INVALID_RESULT');
  if (envelope.tool_calls !== undefined && envelope.tool_calls !== null
    && (!Array.isArray(envelope.tool_calls) || envelope.tool_calls.length !== 0)) fail('INVALID_RESULT');
  const raw = envelope.raw_content;
  const content = envelope.content;
  if (typeof content !== 'string' || Buffer.byteLength(content) > 4096
    || (raw !== undefined && (typeof raw !== 'string' || raw !== content))) fail('INVALID_RESULT');
  diagnostic.stage = 'json';
  const result = strictJson(content);
  diagnostic.stage = 'proposal';
  object(result, ['taric_code', 'description'], 'INVALID_RESULT');
  taric(result.taric_code);
  string(result.description, 255, 'INVALID_RESULT');
  diagnostic.proposal = { taric_code: result.taric_code, description: result.description };
  diagnostic.recognizedCode = codes.includes(result.taric_code);
  diagnostic.stage = 'catalog';
  if (!diagnostic.recognizedCode) fail('CATALOG_REJECTED');
  return { ...result, description_source: 'model_generated', verification: 'unverified', training_approved: false };
}
function output(envelope, codes, capture) {
  const diagnostic = { label: 'UNVALIDATED', stage: 'envelope', reasons: [],
    proposal: null, recognizedCode: null, applicable: false, training_approved: false,
    ...(typeof envelope?.content === 'string' ? require('./taricDiagnostics').preview(envelope.content) : { visibleText: null, outputBytes: 0, truncated: false }) };
  try {
    const result = validateOutput(envelope, codes, diagnostic);
    diagnostic.stage = 'validated';
    return result;
  } catch (error) {
    diagnostic.label = 'REJECTED';
    diagnostic.reasons = [error.code || 'INVALID_RESULT'];
    throw error;
  } finally {
    // Copy before publishing: callbacks cannot change the validated suggestion.
    if (capture) capture(JSON.parse(JSON.stringify(diagnostic)));
  }
}
const TEMPLATE = Object.freeze({ ...VERSIONS, systemHash: sha(SYSTEM),
  trainingSha: TRAINING_SHA, cleanedSha: CLEANED_SHA, matchedPrompts: 67,
  provenance: 'Local generated training CSV digest verified; all 67 system/prompt pairs matched on 2026-09-18.' });
function lexical(a, b) {
  const tokens = s => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const x = tokens(a); const y = tokens(b);
  const union = new Set([...x, ...y]);
  return union.size ? [...x].filter(t => y.has(t)).length / union.size : 0;
}
module.exports = { BASE_MODEL, TEST_ADAPTER, TRAINING_SHA, CLEANED_SHA, SYSTEM, VERSIONS, TEMPLATE, sha, hs, input, render, messages, payload, strictJson, output, lexical, hash };
