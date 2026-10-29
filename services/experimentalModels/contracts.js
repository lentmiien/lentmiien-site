const { z } = require('zod');
const { ID, fail } = require('./policy');

const WEVIS_TASKS = ['ocr', 'detection', 'referring', 'point', 'count_box', 'count_point', 'ocr_grounding'];
const TAGS = ['Breathing', 'Cough', 'Sigh', 'Laughter', 'Surprise-ah', 'Surprise-oh', 'Dissatisfaction-hnn', 'Uhm', 'Confirmation-en', 'Question-ei', 'Question-ah', 'Question-en', 'Question-oh', 'Question-huh'];
const CONTROLS = { speed: ['慢速', '中速', '快速'], pitch: ['低', '中', '高'], volume: ['低', '中', '高'],
  emotion: ['高兴', '悲伤', '愤怒', '恐惧', '厌恶', '惊讶', '中性'], dialect: ['chuanyu dialect', 'cantonese'] };
// Validate the original length before trimming. These strings are model inputs,
// never markup, control tokens, URLs or executable prompts in another workflow.
const inputText = max => z.string().max(max).refine(value => !/[<>\x00-\x08\x0b-\x1f\x7f]/.test(value)).transform(value => value.trim());
const wevisInput = z.object({ fileId: z.string().regex(ID), task: z.enum(WEVIS_TASKS), query: inputText(1024).default(''),
  max_new_tokens: z.number().int().min(1).max(4096).default(1024) }).strict().refine(value => value.task === 'ocr' ? value.query === '' : value.query.length > 0);
const mingInput = z.object({ task: z.enum(['VOICE_DESIGN', 'FREEFORM', 'TTS', 'MULTILINGUAL', 'BASIC', 'EMOTION', 'DIALECT']).default('TTS'),
  text: inputText(500).refine(Boolean), language: z.enum(['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es']), reference_id: z.null().optional(),
  instruction: inputText(512).nullable().optional(), controls: z.object({ style: inputText(512),
    ...Object.fromEntries(Object.entries(CONTROLS).map(([key, values]) => [key, z.enum(values)])) }).partial().strict().default({}),
  max_decode_steps: z.number().int().min(8).max(400).default(200) }).strict();
function parseInput(model, input) {
  const parsed = (model === 'wevisone-vl' ? wevisInput : mingInput).safeParse(input);
  if (!parsed.success) fail('invalid_fields', 422, 'Invalid or unsupported fields. Check the task requirements and input limits.');
  const value = parsed.data;
  if (model === 'wevisone-vl') {
    // OCR requires the literal query to be empty, including before trim.
    if (value.task === 'ocr' && input.query !== undefined && input.query !== '') fail('invalid_fields', 422, 'OCR requires an empty query.');
    return value;
  }
  const residue = value.text.replace(/\[([^\[\]]+)\]/g, (match, tag) => TAGS.includes(tag) && ['zh', 'en'].includes(value.language) ? '' : match);
  if (/[\[\]]/.test(residue)) fail('invalid_tags', 422, 'Use only the documented, case-sensitive speech tags in zh/en text.');
  if (!['VOICE_DESIGN', 'FREEFORM'].includes(value.task)) {
    const keys = Object.keys(value.controls);
    const allowed = { TTS: [], MULTILINGUAL: [], BASIC: ['speed', 'pitch', 'volume'], EMOTION: ['emotion'], DIALECT: ['dialect'] }[value.task];
    const languages = value.task === 'MULTILINGUAL' ? ['ja', 'ko', 'de', 'fr', 'es'] : value.task === 'DIALECT' ? ['zh'] : ['zh', 'en'];
    if (!languages.includes(value.language) || keys.some(key => !allowed.includes(key)) || (allowed.length && !keys.length)
      || (input.instruction !== undefined && input.instruction !== null)) fail('invalid_fields', 422, 'Invalid language or mixed controls for this reference task.');
    fail('reference_pending', 503, 'Reference-conditioned tasks await the ephemeral reference endpoint. No voice is registered.');
  }
  if (!['zh', 'en'].includes(value.language)) fail('invalid_fields', 422, 'Voice design and freeform support zh/en only.');
  const keys = Object.keys(value.controls);
  if (value.task === 'VOICE_DESIGN' ? !(keys.length === 1 && value.controls.style && !value.instruction) : !(keys.length === 0 && value.instruction)) {
    fail('invalid_fields', 422, 'Voice design requires only style; freeform requires only instruction.');
  }
  if (value.task === 'VOICE_DESIGN' && input.instruction !== undefined && input.instruction !== null) fail('invalid_fields', 422, 'Voice design does not accept instruction.');
  return { task: value.task, text: value.text, language: value.language,
    ...(value.task === 'VOICE_DESIGN' ? { controls: { style: value.controls.style } } : { instruction: value.instruction }), max_decode_steps: value.max_decode_steps };
}
const size = z.object({ width: z.number().int().min(32).max(16384), height: z.number().int().min(32).max(16384) }).strict();
const pair = z.tuple([z.number().positive().finite(), z.number().positive().finite()]);
const count = z.number().int().nonnegative().nullable();
const wevisOutput = z.object({ schema_version: z.literal(1), model: z.literal('wevisone-vl'), upstream_model: z.literal('tencent/WeVisOne-VL-4B'),
  task: z.enum(WEVIS_TASKS), raw_text: z.string().max(262144), text: z.string().max(262144).nullable(),
  regions: z.array(z.object({ label: z.string().max(262144), shape: z.enum(['box', 'point', 'polygon']),
    normalized: z.array(z.number().finite().min(0).max(1)).max(8192), pixels: z.array(z.number().finite().nonnegative()).max(8192) }).strict()).max(1024),
  count, declared_count: count, complete: z.literal(true), finish_reason: z.literal('stop'),
  coordinates: z.object({ bins: z.literal(1000), normalized_range: z.tuple([z.literal(0), z.literal(1)]), pixel_space: z.literal('exif_oriented_original'),
    original_size: size, model_input_size: size, resized: z.boolean() }).strict(),
  image: z.object({ source_size: pair, original_size: pair, model_input_size: pair, exif_orientation_applied: z.literal(true), scale_xy: pair }).strict(),
  text_order: z.enum(['model_generation_order']).nullable() }).strict();
function validateWevis(value, request, asset) {
  const parsed = wevisOutput.safeParse(value);
  if (!parsed.success) fail('invalid_response', 502, 'Gateway returned an invalid or nonterminal WeVis response.');
  const data = parsed.data, { width, height } = data.coordinates.original_size, modelSize = data.coordinates.model_input_size;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (data.task !== request.task || width !== asset.width || height !== asset.height || width * height > 16000000
    || !same(data.image.original_size, [width, height]) || !same(data.image.source_size, [width, height])
    || !same(data.image.model_input_size, [modelSize.width, modelSize.height])
    || modelSize.width % 32 || modelSize.height % 32 || modelSize.width * modelSize.height < 16384 || modelSize.width * modelSize.height > 2073600
    || data.coordinates.resized !== (width !== modelSize.width || height !== modelSize.height)
    || (data.declared_count !== null && data.count !== data.declared_count)) fail('invalid_response', 502, 'Gateway image coordinates or counts do not match this experiment.');
  for (const region of data.regions) {
    const n = region.pixels.length;
    if (region.normalized.length !== n || (region.shape === 'box' ? n !== 4 : region.shape === 'point' ? n !== 2 : n < 6 || n % 2)
      || region.pixels.some((v, i) => v > (i % 2 ? height : width) || Math.abs(v / (i % 2 ? height : width) - region.normalized[i]) > 0.002)
      || (region.shape === 'box' && (region.pixels[0] > region.pixels[2] || region.pixels[1] > region.pixels[3]))) {
      fail('invalid_response', 502, 'Gateway returned invalid region coordinates.');
    }
  }
  if (['count_box', 'count_point'].includes(data.task) && data.count !== data.regions.length) fail('invalid_response', 502, 'Gateway region count does not match.');
  return data;
}
function validateWav(bytes) {
  const invalid = () => fail('invalid_audio', 502, 'Gateway returned invalid or incomplete PCM WAV audio.');
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > 6291456 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
  let fmt, dataSize, offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4); offset += 8;
    if (offset + length > bytes.length) invalid();
    if (type === 'fmt ') {
      if (fmt || length < 16) invalid();
      fmt = { codec: bytes.readUInt16LE(offset), channels: bytes.readUInt16LE(offset + 2), sampleRate: bytes.readUInt32LE(offset + 4),
        byteRate: bytes.readUInt32LE(offset + 8), blockAlign: bytes.readUInt16LE(offset + 12), bitsPerSample: bytes.readUInt16LE(offset + 14) };
    } else if (type === 'data') { if (dataSize !== undefined) invalid(); dataSize = length; }
    offset += length + length % 2;
  }
  if (offset !== bytes.length || !fmt || !dataSize || fmt.codec !== 1 || fmt.channels !== 1 || fmt.bitsPerSample !== 16
    || fmt.sampleRate < 16000 || fmt.sampleRate > 48000 || fmt.blockAlign !== 2 || fmt.byteRate !== fmt.sampleRate * 2 || dataSize % 2) invalid();
  const durationSeconds = dataSize / fmt.byteRate;
  if (durationSeconds <= 0 || durationSeconds > 60) invalid();
  return { sampleRate: fmt.sampleRate, channels: 1, bitsPerSample: 16, durationSeconds };
}
module.exports = { WEVIS_TASKS, TAGS, CONTROLS, parseInput, validateWevis, validateWav };
