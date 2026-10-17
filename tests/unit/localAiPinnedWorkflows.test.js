const { spawnSync } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const policies = require('../fixtures/local-ai/workflows-8105a1b.json');
const mapper = require('../../public/js/local-ai-workflows');
const outputs = require('../../services/localAi/outputs');
const suite = process.env.LOCAL_AI_GATEWAY_SOURCE && process.env.LOCAL_AI_PROTOCOL_PYTHON ? describe : describe.skip;
suite('committed Gateway 8105a1b routes and Site collector, CPU only', () => {
  let answers, root;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-comfy-outputs-'));
    process.env.LOCAL_AI_OUTPUT_DATA_DIR = root;
    const ref = { artifact_id: 'in_' + 'a'.repeat(32), sha256: 'b'.repeat(64) };
    const cases = policies.map(p => ({ schema_version: 2, logical_job_id: 'job_site', type: 'comfy.workflow', request: mapper.map(p, p.graph, Object.fromEntries(Object.keys(p.bindings).map(k => [k, ref]))) }));
    const overrides = policies.map((p, i) => {
      const body = structuredClone(cases[i]);
      for (const [key, rule] of Object.entries(p.overrides)) {
        let value = rule.type === 'string' ? 'Synthetic 日本語' : rule.type === 'boolean' ? true : rule.type === 'enum' ? rule.values.at(-1) : rule.type === 'resource' ? rule.known_values[0] : rule.minimum;
        if (rule.multiple_of) while ((value - (rule.offset || 0)) % rule.multiple_of) value++;
        body.request.overrides[key] = value;
      }
      return body;
    });
    cases.push(...overrides);
    const r = spawnSync(process.env.LOCAL_AI_PROTOCOL_PYTHON, ['tests/helpers/localAiPinnedWorkflows.py', process.env.LOCAL_AI_GATEWAY_SOURCE], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 ** 2 });
    if (r.status !== 0) throw new Error(r.stderr);
    answers = JSON.parse(r.stdout);
  }, 200000);
  afterAll(async () => { delete process.env.LOCAL_AI_OUTPUT_DATA_DIR; await fs.rm(root, { recursive: true, force: true }); });
  test.each(policies.map((p, i) => [p.workflow_id, i]))('%s exact policy, Python digest, ordered output receipt, full Site validation and durable replay', async (_, i) => {
    const answer = answers[i];
    expect(require('../../services/localAi/gatewayJson').parseResponse(answer.raw_operation).integrity_error).toBeUndefined();
    expect(answers[i + 20].ack).toBe(200);
    expect(require('../../services/localAi/gatewayJson').parseResponse(answers[i + 20].raw_operation).integrity_error).toBeUndefined();
    expect(answer.policy).toEqual(policies[i]);
    expect(answer.import_replay).toBe(200);
    require('../../services/localAi/inputs').verifyReceipt({ _id: answer.imported.artifact_id, source: { kind: 'shared-library', import: { schema_version: 2, source: { filename: 'reference.png', subfolder: '' } } }, descriptor: answer.imported }, answer.imported);
    expect(answer.incomplete_seal).toBe(409); expect(answer.ack).toBe(200);
    const op = answer.operation;
    const job = { ownerId: 'owner', request: { workflow_id: answer.policy.workflow_id, template_sha256: answer.policy.template_sha256 }, source: { workflowPolicy: answer.policy } };
    const gateway = { artifact: jest.fn(async (_id, artifact) => {
      const slot = op.result.artifacts.findIndex(a => a.artifact_id === artifact); const item = answer.downloads[slot];
      return { status: item.status, headers: item.headers, data: Readable.from([Buffer.from(item.bytes, 'base64')]) };
    }) };
    const db = { OutputQuota: { updateOne: async () => ({ matchedCount: 1 }), exists: async () => true } };
    const result = await outputs.collect(gateway, db, job, op);
    expect(result.artifacts).toEqual(op.result.artifacts); expect(result.resultDigest).toBe(op.result_digest);
    expect(gateway.artifact).toHaveBeenCalledTimes(op.result.artifacts.length);
    await outputs.collect(gateway, db, job, op); expect(gateway.artifact).toHaveBeenCalledTimes(op.result.artifacts.length);
    for (let slot = 0; slot < result.artifacts.length; slot++) expect(await outputs.read(result.artifacts[slot])).toEqual(Buffer.from(answer.downloads[slot].bytes, 'base64'));
    const malformed = structuredClone(op); malformed.result.artifacts[0].url = 'https://foreign.invalid/';
    expect(() => outputs.manifest(job, malformed)).toThrow('malformed_workflow_result');
    if (answer.policy.limits.require_audio) {
      const bytes = Buffer.from(answer.downloads[0].bytes, 'base64');
      expect(() => outputs.checkMp4(bytes.subarray(0, bytes.length - 9))).toThrow();
    }
  });
});
