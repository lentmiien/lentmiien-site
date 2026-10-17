const { createHash } = require('crypto');
// Python's JSON distinguishes 1.0 from 1. JavaScript must not reconstruct these
// bytes from Number values. Preserve number lexemes from the authenticated wire
// solely for checking the source result fingerprint (Node 24 JSON.parse context).
const NUMBER = Symbol('wire-number');
function parseResponse(text) {
  if (typeof text !== 'string' || !text) return text;
  const parsed = JSON.parse(text);
  const shadow = JSON.parse(text, (_key, value, context) => typeof value === 'number' ? { [NUMBER]: context.source } : value);
  function canonical(value) {
    if (value && value[NUMBER] !== undefined) return value[NUMBER];
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function inspect(value, wire) {
    if (!value || typeof value !== 'object') return;
    if (value.schema_version === 2 && value.type === 'comfy.workflow' && value.status === 'succeeded') {
      if (!wire.result || typeof wire.result !== 'object') { value.integrity_error = 'gateway_result_digest_mismatch'; return; }
      const actual = createHash('sha256').update(canonical(wire.result)).digest('hex');
      if (value.result_digest !== actual) value.integrity_error = 'gateway_result_digest_mismatch';
    }
    if (Array.isArray(value.operations)) value.operations.forEach((op, i) => inspect(op, wire.operations[i]));
  }
  inspect(parsed, shadow);
  return parsed;
}
module.exports = { parseResponse };
