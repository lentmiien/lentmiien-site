const MODEL = 'google/embeddinggemma-2';
const REVISION = '914f7f89142e33e77833254d9c9b90c3cef7303b';
const SPACE = `${MODEL}@${REVISION}:768:l2:pilot-v1`;
const KINDS = ['text', 'image', 'audio', 'video'];
class PilotError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
function fail(message, status) { throw new PilotError(message, status); }
function vector(value) {
  if (!Array.isArray(value) || value.length !== 768 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) fail('Invalid embedding vector.', 502);
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm < 1e-12) fail('Invalid embedding vector.', 502);
  return value.map(n => n / norm);
}
function input(body, file, search) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['kind', 'text', 'title', ...(search ? ['topK', 'filter'] : [])].includes(k))) fail('Unsupported input fields.');
  const { kind, text, title } = body;
  if (!KINDS.includes(kind)) fail('Choose text, image, audio or video.');
  if (kind === 'text') {
    if (file || typeof text !== 'string' || !text.trim() || [...text].length > 16000 || /^\s*(task|title):/i.test(text) || /<\||\|>|<\/?(?:image|audio|video|start_of_image|end_of_image)\b/i.test(text)) fail('Enter raw, unprefixed text (1–16,000 characters).');
    if (title !== undefined && (search || typeof title !== 'string' || !title.trim() || [...title].length > 256)) fail('Only documents may have a nonempty title (up to 256 characters).');
  } else if (!file || text !== undefined || title !== undefined) fail('Choose one media file; media takes no text or title.');
  if (body.topK !== undefined && !(typeof body.topK === 'number' || typeof body.topK === 'string' && /^\d{1,2}$/.test(body.topK))) fail('Invalid top K.');
  const topK = body.topK === undefined ? 10 : Number(body.topK);
  if (search && (!Number.isInteger(topK) || topK < 1 || topK > 50)) fail('Top K must be 1–50.');
  if (body.filter !== undefined && !['all', ...KINDS].includes(body.filter)) fail('Invalid modality filter.');
  return { kind, ...(kind === 'text' ? { text, ...(title === undefined ? {} : { title }) } : {}), topK, filter: body.filter || 'all' };
}
// Exact fields from Gateway embeddinggemma2/{app,media}.py at b5df9d2.
// Source stream count/dimensions are checked by that decoder, not reported by this API.
function preprocessingMapping(chunk, kind) {
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const duration = (value, max) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
  const dimensions = (edge, pixels) => integer(chunk.width, 1, edge) && integer(chunk.height, 1, edge) && chunk.width * chunk.height <= pixels;
  let fields;
  let valid = integer(chunk.tokens, 1, 8192);
  if (kind === 'text') fields = ['role', 'title_supplied'];
  else if (kind === 'image') {
    valid &&= dimensions(4096, 4000000) && chunk.exif_orientation_applied === true && chunk.vision_soft_tokens_max === 280;
    fields = ['width', 'height', 'exif_orientation_applied', 'vision_soft_tokens_max'];
  } else if (kind === 'audio') {
    valid &&= duration(chunk.duration_seconds, 10) && integer(chunk.samples, 160, 160000) && chunk.sampling_rate === 16000 && chunk.channels === 1 && Math.abs(chunk.duration_seconds - chunk.samples / 16000) < 1e-9;
    fields = ['duration_seconds', 'samples', 'sampling_rate', 'channels'];
  } else if (kind === 'video') {
    valid &&= duration(chunk.duration_seconds, 8) && dimensions(768, 768 * 768) && integer(chunk.frames, 1, 8) && chunk.sample_fps === 1
      && Array.isArray(chunk.sample_grid_seconds) && chunk.sample_grid_seconds.length === chunk.frames && chunk.sample_grid_seconds.every((n, i) => n === i)
      && chunk.sampling === 'ffmpeg fps start_time=0 round=near; grid times, not original frame PTS'
      && chunk.rotation_applied === false && chunk.soundtrack === 'ignored' && chunk.vision_soft_tokens_per_frame_max === 140 && chunk.processor_resampling === false && chunk.model_timestamp_tokens === false;
    fields = ['duration_seconds', 'width', 'height', 'frames', 'sample_fps', 'sample_grid_seconds', 'sampling', 'rotation_applied', 'soundtrack', 'vision_soft_tokens_per_frame_max', 'processor_resampling', 'model_timestamp_tokens'];
  } else valid = false;
  if (!valid) fail('Gateway returned missing or invalid preprocessing metadata. Nothing was stored; operator must check the Gateway contract.', 502);
  return Object.fromEntries(['index', 'input_index', 'kind', 'tokens', ...fields].map(key => [key, chunk[key]]));
}
function response(data, source, role) {
  if (!data || data.model !== MODEL || data.revision !== REVISION || data.space_id !== SPACE || data.dimensions !== 768 || data.normalized !== true || data.preprocessing?.version !== 'pilot-v1' || data.preprocessing.batch_size !== 1 || data.preprocessing.truncation !== false || data.preprocessing.text_prefixes !== 'role-specific; text only' || !['bfloat16', 'float32'].includes(data.precision)
    || !Array.isArray(data.vectors) || data.vectors.length !== 1 || !Array.isArray(data.chunks) || data.chunks.length !== 1) fail('Gateway returned an incompatible model space or response.', 502);
  const chunk = data.chunks[0];
  if (!chunk || chunk.index !== 0 || chunk.input_index !== 0 || chunk.kind !== source.kind || (source.kind === 'text' && (chunk.role !== role || chunk.title_supplied !== Boolean(source.title)))) fail('Gateway returned an invalid input mapping.', 502);
  const normalized = vector(data.vectors[0]);
  if (Math.abs(Math.hypot(...data.vectors[0]) - 1) > 0.02) fail('Gateway returned an unnormalized vector.', 502);
  return { model: MODEL, revision: REVISION, space_id: SPACE, dimensions: 768, normalized: true, precision: data.precision, preprocessing: { version: 'pilot-v1', batch_size: 1, truncation: false, text_prefixes: 'role-specific; text only' }, mapping: preprocessingMapping(chunk, source.kind), vector: normalized };
}
module.exports = { MODEL, REVISION, SPACE, KINDS, PilotError, fail, vector, input, response };
