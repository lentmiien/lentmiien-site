const crypto = require('crypto');
const { z } = require('zod');
const CAP = Object.freeze({ use: 'local_ai.jobs.use', manage: 'local_ai.scheduler.manage', importShared: 'local_ai.inputs.import_shared' });
const BUNDLES = Object.freeze({ admin: Object.values(CAP), family: [], user: [] });
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DAY = 86400000;
const HOUR = 3600000;
function problem(code, status = 422) { return Object.assign(new Error(code), { code, status }); }
function digest(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function windowAt(now = new Date()) {
  const n = +now;
  const midnight = Math.floor((n + 9 * HOUR) / DAY) * DAY - 9 * HOUR;
  const start = midnight + HOUR;
  const end = midnight + 6 * HOUR;
  return { key: new Date(midnight + 9 * HOUR).toISOString().slice(0, 10),
    start: new Date(start), end: new Date(end), inside: n >= start && n < end,
    next: new Date(n < start ? start : start + DAY) };
}
function runWire(mode, now = new Date()) {
  const w = windowAt(now);
  if (mode === 'automatic' && !w.inside) throw problem('outside_window', 409);
  const cutoff = +now < +w.end ? +w.end : +w.end + DAY;
  return { mode, not_before: now.toISOString(), deadline: new Date(Math.min(+now + 5 * HOUR, cutoff)).toISOString() };
}
function safeReplacement(op) {
  return !!op && ['failed', 'interrupted', 'deferred'].includes(op.status)
    && op.termination_proven === true && ['verified', 'not_required'].includes(op.cleanup);
}
const inputReference = z.object({ artifact_id: z.string().regex(/^in_[a-f0-9]{32}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const textRequest = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(20000), images: z.array(inputReference).min(1).max(3).optional() }).strict().refine(m => !m.images || m.role === 'user')).min(1).max(100),
  max_tokens: z.number().int().min(1).max(8192),
  temperature: z.number().min(0).max(2).optional(),
  context_tokens: z.number().int().min(512).max(131072).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  think: z.boolean().optional(),
}).strict();
const filename = z.string().min(1).max(200).refine(s => !s.startsWith('/') && !s.includes('..') && !s.includes('\\') && !s.includes(':'));
const link = (id, index = 0) => z.tuple([z.literal(id), z.literal(index)]);
const node = (type, inputs) => z.object({ class_type: z.literal(type), inputs: z.object(inputs).strict(), _meta: z.record(z.string(), z.unknown()).optional() }).strict();
const dimension = z.number().int().min(256).max(1536).multipleOf(16);
const graph = z.object({
  '1': node('UNETLoader', { unet_name: filename, weight_dtype: z.literal('default') }),
  '2': node('CLIPLoader', { clip_name: filename, type: z.literal('qwen_image'), device: z.literal('default') }),
  '3': node('VAELoader', { vae_name: filename }),
  '4': node('TextEncodeQwenImage21', { clip: link('2'), prompt: z.string().max(20000), negative_prompt: z.string().max(20000), resolution: z.number().int().min(256).max(1536) }),
  '5': node('EmptyLatentImage', { width: dimension, height: dimension, batch_size: z.literal(1) }),
  '6': node('KSampler', { model: link('1'), positive: link('4'), negative: link('4', 1), latent_image: link('5'), seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), steps: z.number().int().min(1).max(60), cfg: z.number().min(0).max(30), sampler_name: z.literal('euler'), scheduler: z.literal('simple'), denoise: z.literal(1) }),
  '7': node('VAEDecode', { samples: link('6'), vae: link('3') }),
  '8': node('SaveImage', { images: link('7'), filename_prefix: z.string().max(200) }),
}).strict();
const submission = z.discriminatedUnion('type', [
  z.object({ type: z.literal('comfy.workflow'), request: z.object({ workflow_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), template_sha256: z.string().regex(/^[a-f0-9]{64}$/), overrides: z.record(z.string().max(200), z.union([z.string().max(20000), z.number().finite(), z.boolean()])), bindings: z.record(z.string().max(100), inputReference) }).strict() }).strict(),
  z.object({ type: z.literal('llm.chat'), request: textRequest }).strict(),
  z.object({ type: z.literal('comfy.image'), request: z.object({ prompt: graph }).strict() }).strict(),
  z.object({ type: z.literal('chat5.response'), conversation_id: z.string().regex(/^[a-f0-9]{24}$/i), prompt: z.string().max(20000), settings: z.object({
    model: z.string().max(200), contextPrompt: z.string().max(20000), maxMessages: z.number().int().min(1).max(999),
    tools: z.array(z.string()).max(100), reasoning: z.string().max(20), mode: z.string().max(20), verbosity: z.string().max(20), outputFormat: z.string().max(20),
  }).strict().optional() }).strict(),
]);
function parseSubmission(input) {
  if (Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) throw problem('request_too_large', 413);
  const parsed = submission.safeParse(input);
  if (!parsed.success) throw problem(input?.type === 'comfy.image' ? 'unsupported_workflow_use_qwen_image_2_1_nodes_1_to_8' : 'invalid_or_unsupported_input');
  return parsed.data;
}
function affinity(type, request) {
  return type === 'llm.chat' ? `llm:${request.model}` : `comfy:${digest(['1', '2', '3'].map(k => ({ class_type: request.prompt[k].class_type, inputs: request.prompt[k].inputs })))}`;
}
module.exports = { CAP, BUNDLES, ID, problem, digest, windowAt, runWire, safeReplacement, parseSubmission, textRequest, inputReference, affinity };
