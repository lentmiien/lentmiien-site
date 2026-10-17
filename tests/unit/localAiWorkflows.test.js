const policies = require('../fixtures/local-ai/workflows-8105a1b.json');
const mapper = require('../../public/js/local-ai-workflows');
const { parseSubmission } = require('../../services/localAi/policy');
const { Workflows } = require('../../services/localAi/workflows');
const { Worker } = require('../../services/localAi/worker');
const ref = { artifact_id: 'in_' + 'a'.repeat(32), sha256: 'b'.repeat(64) };
const bindings = p => Object.fromEntries(Object.keys(p.bindings).map(k => [k, ref]));
const clone = x => structuredClone(x);
test('exact release inventory has sixteen image and four audio video policies', () => {
  expect(policies).toHaveLength(20);
  expect(policies.filter(p => p.limits.require_audio)).toHaveLength(4);
  expect(policies.find(p => p.workflow_id === 'Z-Anime-Workflow-v1').outputs).toHaveLength(2);
});
test.each(policies.map(p => [p.workflow_id, p]))('%s maps complete defaults and all permitted scalars without changing the opaque policy digest', (_name, p) => {
  const graph = clone(p.graph);
  const request = mapper.map(p, graph, bindings(p));
  expect(request.template_sha256).toBe(p.template_sha256);
  expect(() => parseSubmission({ type: 'comfy.workflow', request })).not.toThrow();
  for (const [key, rule] of Object.entries(p.overrides)) {
    const [node, field] = key.split('/');
    let value = rule.type === 'string' ? 'Fixture 日本語' : rule.type === 'boolean' ? !graph[node].inputs[field]
      : rule.type === 'resource' ? rule.known_values[0] : rule.type === 'enum' ? rule.values.at(-1) : rule.minimum;
    if (rule.multiple_of) while ((value - (rule.offset || 0)) % rule.multiple_of) value++;
    graph[node].inputs[field] = value;
  }
  expect(() => mapper.map(p, graph, bindings(p))).not.toThrow();
  const attack = clone(graph); attack.extra = { class_type: 'SaveImage', inputs: {} };
  expect(() => mapper.map(p, attack, bindings(p))).toThrow('unsupported_workflow_structure');
  for (const [node, spec] of Object.entries(graph)) for (const [field, value] of Object.entries(spec.inputs)) {
    if (!p.overrides[`${node}/${field}`] && !['image', 'filename_prefix', 'rgthree_comparer', 'video-preview'].includes(field)) {
      const changed = clone(graph); changed[node].inputs[field] = Array.isArray(value) ? ['foreign', 0] : 'changed';
      expect(() => mapper.map(p, changed, bindings(p))).toThrow();
    }
  }
});
test.each(['../model.gguf', 'https://x/model.gguf', 'x%2fmodel.gguf', 'x\\model.gguf', 'x[output].gguf', 'x//model.gguf'])('unsafe resources reject %s', value => {
  expect(() => mapper.checkValue(value, { type: 'resource', suffixes: ['.gguf'], max_length: 256 })).toThrow();
});
test('binding order/slots and fixed fonts, cache, expression, switch links and TextGenerate settings fail closed', () => {
  for (const p of policies) {
    if (Object.keys(p.bindings).length) expect(() => mapper.map(p, p.graph, {})).toThrow();
    for (const key of ['font', 'expression', 'sampling_mode.temperature', 'on_true', 'cache_threshold']) {
      for (const [id, node] of Object.entries(p.graph)) if (Object.hasOwn(node.inputs, key) && !p.overrides[`${id}/${key}`]) {
        const g = clone(p.graph); g[id].inputs[key] = 'unsupported';
        expect(() => mapper.map(p, g, bindings(p))).toThrow();
      }
    }
  }
});
test('affinity includes all static branches/options and isolates unknown resource names', async () => {
  const p = policies.find(p => p.workflow_id === 'image_krea2_turbo_t2i');
  const service = { gateway: {}, inputs: { resolve: jest.fn() } };
  const w = new Workflows(service); w.negotiate = async () => {}; w.policy = async () => p;
  const base = mapper.map(p, p.graph, {});
  const a = await w.freeze(base, {});
  const b = await w.freeze({ ...base, overrides: { ...base.overrides, '30:19/value': 'new prompt', '30:3/seed': 42 } }, {});
  expect(a.source.affinity).toBe(b.source.affinity);
  const c = await w.freeze({ ...base, overrides: { ...base.overrides, '30:23/value': true } }, {});
  expect(c.source.affinity).not.toBe(a.source.affinity);
  const unknown = { ...base, overrides: { ...base.overrides, '30:10/unet_name': 'other.gguf' } };
  expect((await w.freeze(unknown, {})).source.affinity).not.toBe((await w.freeze(unknown, {})).source.affinity);
});
test('2 GiB cohort fitting accounts for full template budgets and inputs before staging eight videos', async () => {
  const service = { gateway: { input: async () => { throw Object.assign(new Error(), { status: 404 }); }, capacity: async () => ({ available_bytes: 2 * 1024 ** 3, remaining_records: 1000 }) }, inputs: { resolve: async () => ({ descriptor: { bytes: 33554432 } }) } };
  const w = new Worker(service);
  const jobs = Array.from({ length: 8 }, () => ({ type: 'comfy.workflow', source: { reservationBytes: 836 * 1024 ** 2 }, request: { bindings: { a: ref } } }));
  expect(await w.fitCohort(jobs, {}, true)).toHaveLength(2);
  service.gateway.capacity = async () => ({ available_bytes: 850 * 1024 ** 2, remaining_records: 1000 });
  await expect(w.fitCohort(jobs, {}, true)).rejects.toMatchObject({ status: 507 });
  expect(await w.fitCohort(jobs, {}, false)).toHaveLength(1);
});
test('Python float lexemes verify source result digest without JavaScript recanonicalization', () => {
  const { parseResponse } = require('../../services/localAi/gatewayJson');
  const { createHash } = require('crypto');
  const result = '{"duration_seconds":1.0,"x":1e-06}';
  const hash = createHash('sha256').update(result).digest('hex');
  const raw = `{"schema_version":2,"type":"comfy.workflow","status":"succeeded","result":${result},"result_digest":"${hash}"}`;
  expect(parseResponse(raw).integrity_error).toBeUndefined();
  expect(parseResponse(raw.replace(hash, 'a'.repeat(64))).integrity_error).toBe('gateway_result_digest_mismatch');
  expect(parseResponse('{"text":"v1 unchanged"}')).toEqual({ text: 'v1 unchanged' });
});
