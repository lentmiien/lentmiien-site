// Version 1 mirrors successor_common/wevis_inspection.py. Only this admin lab opts in.
const { strictJson } = require('../../utils/taricProtocol');
const { WEVIS_TASKS } = require('./contracts');
const CAPABILITY = Object.freeze({ version: 1, field: 'experimental_inspect_failure', default: false,
  endpoint: '/perception/wevisone-vl', max_raw_bytes: 16384, raw_length_unit: 'unicode_code_points',
  max_body_bytes: 1048576, max_inspection_body_bytes: 102400 });
const OUTPUT_MESSAGES = Object.freeze({
  invalid_image_size: 'Model output used an invalid image size.',
  output_limit_exceeded: 'Model output exceeded the output limit.',
  generation_incomplete: 'Generation did not reach a terminal EOS token.',
  malformed_fence: 'Model output contained malformed fencing.',
  missing_region_label: 'A region label was missing.',
  invalid_region_label: 'A region label was invalid.',
  unexpected_geometry: 'Model output contained unexpected geometry.',
  invalid_coordinates: 'Model output contained invalid coordinates.',
  incomplete_geometry: 'Model output contained incomplete geometry.',
  invalid_box: 'Model output contained an invalid box.',
  region_limit_exceeded: 'Model output exceeded the region limit.',
  count_mismatch: 'Model declared count disagrees with returned regions; raw output retained.',
  unrecognized_output: 'Model output did not match the required format.',
  empty_output: 'The decoded model output was empty.',
});
const RUNTIME_REASONS = Object.freeze({ model_load: 'model_load_failed', preprocessing: 'preprocessing_failed',
  generation: 'generation_failed', raw_decode: 'raw_decode_failed', unknown: 'runtime_failed' });
const RUNTIME_MESSAGES = Object.freeze({ model_load: 'Model loading failed.', preprocessing: 'Image preprocessing failed.',
  generation: 'Model generation failed.', raw_decode: 'Raw generation decoding failed.', unknown: 'Model runtime failed at an unknown stage.' });
function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function compatible(value) { return exact(value, Object.keys(CAPABILITY)) && Object.entries(CAPABILITY).every(([k, v]) => value[k] === v); }
function decodeInspection(bytes, input) {
  const require = valid => { if (!valid) throw new Error('Invalid failure inspection'); };
  require(Buffer.isBuffer(bytes) && bytes.length <= CAPABILITY.max_inspection_body_bytes);
  const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  require(exact(value, ['detail']));
  const detail = value.detail;
  require(exact(detail, ['code', 'model_output_valid', 'diagnostics']) && detail.model_output_valid === false);
  const d = detail.diagnostics;
  require(exact(d, ['version', 'stage', 'reason', 'raw_text', 'raw_available', 'raw_length', 'raw_truncated',
    'task', 'max_new_tokens', 'generated_tokens', 'finish_reason', 'eos_observed']));
  const output = d.stage === 'normalize';
  require(d.version === 1 && typeof d.reason === 'string' && typeof d.stage === 'string');
  require(output ? Object.hasOwn(OUTPUT_MESSAGES, d.reason) : Object.hasOwn(RUNTIME_REASONS, d.stage) && RUNTIME_REASONS[d.stage] === d.reason);
  require(detail.code === (output ? 'model_output_invalid' : 'runtime_failed'));
  require(WEVIS_TASKS.includes(d.task) && d.task === input.task && Number.isInteger(d.max_new_tokens)
    && d.max_new_tokens >= 1 && d.max_new_tokens <= 4096 && d.max_new_tokens === input.max_new_tokens);
  require(typeof d.raw_available === 'boolean' && typeof d.raw_truncated === 'boolean');
  if (d.raw_available) {
    require(output && typeof d.raw_text === 'string' && d.raw_text.length <= 32768);
    // Reject unpaired surrogates; Buffer would otherwise silently replace them.
    require(Buffer.from(d.raw_text, 'utf8').toString('utf8') === d.raw_text);
    const length = Array.from(d.raw_text).length, rawBytes = Buffer.byteLength(d.raw_text);
    require(rawBytes <= CAPABILITY.max_raw_bytes && Number.isSafeInteger(d.raw_length) && d.raw_length >= length);
    require(d.raw_truncated === (d.raw_length > length));
    require(!d.raw_truncated || rawBytes > CAPABILITY.max_raw_bytes - 4);
  } else require(d.raw_text === null && d.raw_length === null && d.raw_truncated === false);
  const generated = d.generated_tokens, finish = d.finish_reason, eos = d.eos_observed;
  require(generated === null || Number.isInteger(generated) && generated >= 0 && generated <= d.max_new_tokens);
  require(finish === null || finish === 'stop' || finish === 'length');
  require(eos === null || typeof eos === 'boolean');
  require(finish === null && eos === null || generated !== null
    && (finish === 'stop' && eos === true && generated > 0 || finish === 'length' && eos === false));
  if (output) {
    require(d.raw_available && generated !== null && finish !== null);
    require(d.reason !== 'generation_incomplete' || finish === 'length');
    require(finish !== 'length' || ['generation_incomplete', 'output_limit_exceeded'].includes(d.reason));
  } else {
    require(!d.raw_available);
    if (['model_load', 'preprocessing', 'unknown'].includes(d.stage)) require(generated === null && finish === null && eos === null);
  }
  return detail;
}
function message(detail) {
  return detail.code === 'model_output_invalid' ? OUTPUT_MESSAGES[detail.diagnostics.reason] : RUNTIME_MESSAGES[detail.diagnostics.stage];
}
module.exports = { CAPABILITY, OUTPUT_MESSAGES, RUNTIME_REASONS, compatible, decodeInspection, message };
