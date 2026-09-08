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
module.exports = { MAX_AUDIO_BYTES, validMiienWav };
