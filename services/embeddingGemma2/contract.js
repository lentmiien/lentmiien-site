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
// Retain only bounded preprocessing/mapping fields from the authoritative contract.
function metadata(value, depth = 0) {
  if (depth > 4) fail('Invalid Gateway metadata.', 502);
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 256) return value;
  if (Array.isArray(value) && value.length <= 32) return value.map(v => metadata(v, depth + 1));
  if (value && typeof value === 'object' && Object.keys(value).length <= 40) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (!/^[a-z][a-z0-9_]{0,50}$/i.test(key) || /text$|title$|path|url|secret|prompt|token(?!s$)/i.test(key)) continue;
      out[key] = metadata(v, depth + 1);
    }
    return out;
  }
  fail('Invalid Gateway metadata.', 502);
}
function response(data, source, role) {
  if (!data || data.model !== MODEL || data.revision !== REVISION || data.space_id !== SPACE || data.dimensions !== 768 || data.normalized !== true || data.preprocessing?.version !== 'pilot-v1' || !['bfloat16', 'float32'].includes(data.precision)
    || data.vectors?.length !== 1 || data.chunks?.length !== 1) fail('Gateway returned an incompatible model space or response.', 502);
  const chunk = data.chunks[0];
  if (chunk.index !== 0 || chunk.input_index !== 0 || chunk.kind !== source.kind || (source.kind === 'text' && (chunk.role !== role || chunk.title_supplied !== Boolean(source.title)))) fail('Gateway returned an invalid input mapping.', 502);
  const normalized = vector(data.vectors[0]);
  if (Math.abs(Math.hypot(...data.vectors[0]) - 1) > 0.02) fail('Gateway returned an unnormalized vector.', 502);
  return { model: MODEL, revision: REVISION, space_id: SPACE, dimensions: 768, normalized: true, precision: data.precision, preprocessing: metadata(data.preprocessing), mapping: metadata(chunk), vector: normalized };
}
module.exports = { MODEL, REVISION, SPACE, KINDS, PilotError, fail, vector, input, response };
