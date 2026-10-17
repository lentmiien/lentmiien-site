const { randomUUID } = require('crypto');
const { problem, digest } = require('./policy');
const { config } = require('./gateway');
const mapper = require('../../public/js/local-ai-workflows');
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9_-]{1,100}$/;
class Workflows {
  constructor(service) { this.service = service; this.gateway = service.gateway; }
  async negotiate() {
    if (!config().media) throw problem('batch_media_disabled', 503);
    const c = await this.gateway.capabilities();
    if (c.protocol !== 'durable-local-ai' || c.version !== 1 || !c.enabled || !c.operation_schema_versions?.includes(2)
      || !c.features?.immutable_inputs || !c.features.registered_comfy_workflows || !c.features.artifact_manifests
      || !c.schema2?.supported_types?.includes('comfy.workflow') || !c.schema2.run_manifest_required) throw problem('gateway_workflows_unavailable', 503);
  }
  async catalog() {
    await this.negotiate();
    const result = await this.gateway.workflows();
    if (result.schema_version !== 2 || !result.enabled || !HASH.test(result.catalog_sha256) || !Array.isArray(result.workflows) || result.workflows.length > 100) throw problem('gateway_registry_invalid', 503);
    return result;
  }
  async policy(id, hash) {
    if (!NAME.test(id) || !HASH.test(hash)) throw problem('invalid_workflow_reference');
    const p = await this.gateway.workflow(id, hash);
    if (p.workflow_id !== id || p.template_sha256 !== hash || p.schema_version !== 2 || !p.graph || !p.bindings || !p.overrides
      || !HASH.test(p.runtime_source_sha256) || !Array.isArray(p.outputs) || !p.outputs.length || p.outputs.length > 16
      || !Number.isSafeInteger(p.limits?.max_output_bytes) || p.limits.max_output_bytes > 512 * 1024 ** 2) throw problem('gateway_registry_invalid', 503);
    return p;
  }
  async references(actor, request, policy) {
    for (const ref of Object.values(request.bindings)) {
      const record = await this.service.inputs.resolve(actor, ref);
      const { width, height } = record.descriptor;
      if (Math.max(width / height, height / width) > policy.limits.max_input_aspect_ratio) throw problem('workflow_input_dimensions', 413);
    }
  }
  async freeze(request, actor) {
    await this.negotiate();
    const policy = await this.policy(request.workflow_id, request.template_sha256);
    mapper.validate(policy, request);
    await this.references(actor, request, policy);
    const reservationBytes = 3 * policy.limits.max_output_bytes + Object.keys(policy.bindings).length * 33554432 + 4194304;
    const graph = JSON.parse(JSON.stringify(policy.graph));
    let unknown = false;
    for (const [key, rule] of Object.entries(policy.overrides)) {
      const [node, field] = key.split('/');
      const value = Object.hasOwn(request.overrides, key) ? request.overrides[key] : graph[node].inputs[field];
      graph[node].inputs[field] = rule.type === 'string' || ['seed', 'noise_seed', 'sampling_mode.seed'].includes(field) ? '<job-value>' : value;
      if (rule.type === 'resource' && !rule.known_values.includes(value)) unknown = true;
    }
    for (const id of Object.keys(policy.bindings)) graph[id].inputs.image = '<immutable-input>';
    return { schemaVersion: 2, type: 'comfy.workflow', request, source: { workflowPolicy: policy, reservationBytes,
      affinity: `workflow:${digest({ graph, runtime: policy.runtime_image, sources: policy.runtime_source_sha256, policy: policy.runtime_policy, isolated: unknown ? randomUUID() : null })}` } };
  }
}
module.exports = { Workflows };
