/* Shared browser/server mapper. Gateway policy digests are opaque version IDs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.localAiWorkflows = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const fail = code => { throw Object.assign(new Error(code), { code, status: 422 }); };
  const canonical = v => JSON.stringify(sort(v));
  function sort(v) { return Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v; }
  function checkValue(value, rule) {
    let valid = false;
    if (rule.type === 'string') valid = typeof value === 'string' && Array.from(value).length <= rule.max_length && !value.includes('\0');
    else if (rule.type === 'resource') valid = typeof value === 'string' && value.length <= rule.max_length && /^[A-Za-z0-9_./ -]+$/.test(value)
      && value.split('/').every(p => !['', '.', '..'].includes(p)) && rule.suffixes.some(s => value.endsWith(s));
    else if (rule.type === 'boolean') valid = typeof value === 'boolean';
    else if (rule.type === 'enum') valid = rule.values.includes(value);
    else if (['integer', 'number'].includes(rule.type)) valid = typeof value === 'number' && Number.isFinite(value)
      && (rule.type !== 'integer' || Number.isSafeInteger(value)) && value >= rule.minimum && value <= rule.maximum
      && (!rule.multiple_of || (value - (rule.offset || 0)) % rule.multiple_of === 0);
    if (!valid) fail('invalid_workflow_override');
  }
  function validate(policy, request) {
    if (!request || request.workflow_id !== policy.workflow_id || request.template_sha256 !== policy.template_sha256) fail('invalid_workflow_reference');
    if (canonical(Object.keys(request.bindings || {}).sort()) !== canonical(Object.keys(policy.bindings).sort())) fail('workflow_bindings_mismatch');
    for (const [key, value] of Object.entries(request.overrides || {})) {
      if (!Object.hasOwn(policy.overrides, key)) fail('unsupported_workflow_override');
      checkValue(value, policy.overrides[key]);
    }
    return request;
  }
  function map(policy, prepared, bindings = {}) {
    if (!prepared || canonical(Object.keys(prepared).sort()) !== canonical(Object.keys(policy.graph).sort())) fail('unsupported_workflow_structure');
    const overrides = {};
    for (const [id, expected] of Object.entries(policy.graph)) {
      const node = prepared[id];
      if (!node || node.class_type !== expected.class_type || !node.inputs || Object.keys(node).some(k => !['inputs', 'class_type', '_meta'].includes(k))
        || canonical(Object.keys(node.inputs).sort()) !== canonical(Object.keys(expected.inputs).sort())) fail('unsupported_workflow_structure');
      for (const [field, value] of Object.entries(node.inputs)) {
        const key = `${id}/${field}`;
        if (Object.hasOwn(policy.overrides, key)) { checkValue(value, policy.overrides[key]); overrides[key] = value; }
        else if (field === 'image' && Object.hasOwn(policy.bindings, id)) {
          if (typeof value !== 'string' || !bindings[id]) fail('reference_requires_private_upload_or_import');
        } else if (field === 'filename_prefix' && policy.outputs.some(o => o.node_id === id)) {
          // Only this legacy UI field is intentionally normalized: private names
          // are always selected by Gateway, never by the browser.
          if (typeof value !== 'string' || !value || value.length > 256 || /[\\%\[\]\x00-\x1f]/.test(value) || value.startsWith('/') || value.includes('..')) fail('invalid_output_prefix');
        } else if (['rgthree_comparer', 'video-preview'].includes(field)) {
          // Non-executable preview widget state; the registered graph is retained.
          if (!Object.hasOwn(expected.inputs, field)) fail('unsupported_workflow_structure');
        } else if (canonical(value) !== canonical(expected.inputs[field])) fail('unsupported_workflow_edit');
      }
    }
    return validate(policy, { workflow_id: policy.workflow_id, template_sha256: policy.template_sha256, overrides, bindings });
  }
  return { map, validate, checkValue, canonical };
});
