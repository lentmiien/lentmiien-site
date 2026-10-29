// Synthetic CPU-only fixtures; no human voice or generated personal data.
function wav(rate = 16000, seconds = 1, channels = 1) {
  const size = Math.floor(rate * seconds) * channels * 2, bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  return bytes;
}
function vision(task) {
  return { schema_version: 1, model: 'wevisone-vl', upstream_model: 'tencent/WeVisOne-VL-4B', task, raw_text: 'Synthetic', text: 'Synthetic',
    regions: [], count: task.startsWith('count') ? 0 : null, declared_count: null, complete: true, finish_reason: 'stop',
    coordinates: { bins: 1000, normalized_range: [0, 1], pixel_space: 'exif_oriented_original', original_size: { width: 128, height: 128 }, model_input_size: { width: 128, height: 128 }, resized: false },
    image: { source_size: [128, 128], original_size: [128, 128], model_input_size: [128, 128], exif_orientation_applied: true, scale_xy: [1, 1] }, text_order: 'model_generation_order' };
}
module.exports = { wav, vision };
