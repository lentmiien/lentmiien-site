const MAX_AUDIO_BYTES = 44 + 16000 * 2 * 60;
function validMiienWav(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 44 && buffer.length <= MAX_AUDIO_BYTES
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 16) === 'WAVEfmt '
    && buffer.readUInt32LE(4) === buffer.length - 8
    && buffer.readUInt32LE(16) === 16 && buffer.readUInt16LE(20) === 1
    && buffer.readUInt16LE(22) === 1 && buffer.readUInt32LE(24) === 16000
    && buffer.readUInt32LE(28) === 32000 && buffer.readUInt16LE(32) === 2
    && buffer.readUInt16LE(34) === 16 && buffer.toString('ascii', 36, 40) === 'data'
    && buffer.readUInt32LE(40) === buffer.length - 44 && (buffer.length - 44) % 2 === 0;
}
const MAX_SPEECH_BYTES = 8 * 1024 * 1024;
function validSpeechWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > MAX_SPEECH_BYTES
    || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE'
    || buffer.readUInt32LE(4) !== buffer.length - 8) return false;
  let offset = 12, format = false, data = false, blockAlign = 0;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) return false;
    if (tag === 'fmt ') {
      if (format || size < 16 || size > 40) return false;
      const channels = buffer.readUInt16LE(start + 2), rate = buffer.readUInt32LE(start + 4);
      const bits = buffer.readUInt16LE(start + 14);
      blockAlign = channels * bits / 8;
      if (buffer.readUInt16LE(start) !== 1 || ![1, 2].includes(channels) || rate < 8000 || rate > 48000
        || ![16, 24, 32].includes(bits) || buffer.readUInt16LE(start + 12) !== blockAlign
        || buffer.readUInt32LE(start + 8) !== rate * blockAlign) return false;
      format = true;
    } else if (tag === 'data') {
      if (!format || data || !size || size % blockAlign) return false;
      data = true;
    }
    offset = start + size + (size % 2);
  }
  return format && data && offset === buffer.length;
}
module.exports = { MAX_AUDIO_BYTES, validMiienWav, MAX_SPEECH_BYTES, validSpeechWav };
