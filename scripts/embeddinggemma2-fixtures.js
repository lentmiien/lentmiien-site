// Public synthetic fixtures only. No network, database, inference or external binaries.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
function wav(seconds = 1) {
  const samples = Math.round(seconds * 16000);
  if (samples < 160 || samples > 176000) throw new Error('Fixture duration out of range');
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(4096 * Math.sin(2 * Math.PI * 440 * i / 16000)), 44 + i * 2);
  return bytes;
}
async function generate(directory) {
  // New directory only; never overwrite an existing operator directory.
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'red-square.txt'), 'A red square on a plain background.\n', { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'tone.wav'), wav(), { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'too-long.wav'), wav(10.1), { flag: 'wx' });
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } }).png().toBuffer();
  await fs.writeFile(path.join(directory, 'red-square.png'), png, { flag: 'wx' });
}
if (require.main === module) {
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error('Supply a new absolute fixture directory');
  generate(directory).catch(error => { process.stderr.write(`Synthetic fixture generation failed (${error.code || error.name}).\n`); process.exitCode = 1; });
}
module.exports = { wav, generate };
