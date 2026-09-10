const { create, analyze } = require('../../public/js/miien_speech_motion');
function setup() {
  let tick, time = 0;
  const onShape = jest.fn(), cancel = jest.fn();
  const motion = create({ onShape, now: () => time, schedule: fn => { tick = fn; return 1; }, cancel });
  return { motion, onShape, cancel, tick: () => tick(), advance: ms => { time += ms; }, callback: () => tick };
}
const media = () => ({ currentTime: 0, paused: false, ended: false, seeking: false, muted: false, volume: 1, readyState: 4 });
function wav({ bits = 16, channels = 1, rate = 8000, seconds = 1, extra = false } = {}) {
  const align = channels * bits / 8, frames = rate * seconds, start = extra ? 56 : 44;
  const bytes = Buffer.alloc(start + frames * align);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * align, 28); bytes.writeUInt16LE(align, 32); bytes.writeUInt16LE(bits, 34);
  if (extra) { bytes.write('JUNK', 36); bytes.writeUInt32LE(3, 40); }
  bytes.write('data', start - 8); bytes.writeUInt32LE(frames * align, start - 4);
  for (let frame = 0; frame < frames; frame++) {
    const seconds = frame / rate;
    // Distinct silence / soft / loud regions, with opposing stereo channels.
    const amplitude = seconds < 0.2 || seconds >= 0.8 ? 0 : seconds < 0.4 ? 0.025 : 0.2;
    for (let channel = 0; channel < channels; channel++) {
      bytes.writeIntLE(Math.round(amplitude * (2 ** (bits - 1) - 1)) * (channel ? -1 : 1), start + frame * align + channel * bits / 8, bits / 8);
    }
  }
  return { bytes, blob: new Blob([bytes]) };
}
test.each([16, 24, 32].flatMap(bits => [1, 2].map(channels => [bits, channels])))('PCM %s-bit/%s-channel maps silence, quiet and loud audio, including padded chunks', async (bits, channels) => {
  const result = await analyze(wav({ bits, channels, extra: true }).blob, undefined, async () => {});
  expect(result.duration).toBe(1);
  expect([...result.shapes.slice(0, 5)]).toEqual([0, 0, 0, 0, 0]);
  expect(result.shapes[6]).toBe(1); expect(result.shapes[12]).toBe(2); expect(result.shapes[22]).toBe(0);
});
test.each(['size', 'riff', 'format', 'align', 'chunk', 'duration'])('unsupported or malformed %s falls back to rest', async kind => {
  const { bytes } = wav({ seconds: kind === 'duration' ? 181 : 1 });
  if (kind === 'riff') bytes.write('XXXX');
  if (kind === 'format') bytes.writeUInt16LE(3, 20);
  if (kind === 'align') bytes.writeUInt16LE(9, 32);
  if (kind === 'chunk') bytes.writeUInt32LE(bytes.length, 40);
  const blob = kind === 'size' ? { size: 9 * 1024 * 1024, arrayBuffer: jest.fn() } : new Blob([bytes]);
  expect(await analyze(blob, undefined, async () => {})).toBeNull();
  if (kind === 'size') expect(blob.arrayBuffer).not.toHaveBeenCalled();
});
test('silence stays closed and canceled analysis yields without retaining a result', async () => {
  const { bytes } = wav(); bytes.fill(0, 44);
  expect((await analyze(new Blob([bytes]), undefined, async () => {})).shapes.every(shape => shape === 0)).toBe(true);
  let current = true; const yieldTask = jest.fn(async () => { current = false; });
  expect(await analyze(wav().blob, () => current, yieldTask)).toBeNull(); expect(yieldTask).toHaveBeenCalledTimes(1);
});
test('media time selects energy through pauses, seek, Replay, changed rate, and all inaudible states', async () => {
  const f = setup(), audio = media(); await f.motion.load(audio, wav().blob); f.motion.start(audio);
  audio.currentTime = 0.28; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(1);
  f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  audio.currentTime = 0.52; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(2);
  audio.currentTime = 0.84; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  audio.currentTime = 0.5; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  audio.currentTime = 0.6; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(2);
  audio.currentTime = 0; f.motion.start(audio); audio.currentTime = 0.24; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(1);
  for (const patch of [{ paused: true }, { ended: true }, { seeking: true }, { muted: true }, { volume: 0 }, { readyState: 2 }]) {
    Object.assign(audio, media(), patch); f.motion.start(audio); audio.currentTime = 0.28;
    f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  }
});
test('Stop invalidates queued callbacks, reset discards envelope and new audio cannot borrow it', async () => {
  const f = setup(), audio = media(); await f.motion.load(audio, wav().blob); f.motion.start(audio); const old = f.callback();
  f.motion.stop(); audio.currentTime = 0.28; old(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  f.motion.start(audio); const count = f.onShape.mock.calls.length; old(); expect(f.onShape).toHaveBeenCalledTimes(count);
  audio.currentTime = 0.44; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(2);
  const other = media(); f.motion.start(other); other.currentTime = 0.44; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  f.motion.reset(); f.motion.start(audio); audio.currentTime = 0.6; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
});
test('late or failed blob decoding never reinstalls a discarded envelope', async () => {
  const f = setup(), audio = media(), { blob } = wav(); let resolve;
  const loading = f.motion.load(audio, { size: blob.size, arrayBuffer: () => new Promise(r => { resolve = r; }) });
  f.motion.reset(); resolve(await blob.arrayBuffer()); expect(await loading).toBe(false);
  expect(await f.motion.load(audio, { size: 50, arrayBuffer: async () => { throw new Error('Unavailable'); } })).toBe(false);
  f.motion.start(audio); audio.currentTime = 0.44; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
});
test('browser speech uses an approximate elapsed envelope between explicit lifecycle events only', () => {
  const f = setup(); f.advance(1000); expect(f.onShape).not.toHaveBeenCalled();
  f.motion.start(); f.advance(200); f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(1);
  f.motion.stop(); f.advance(1000); f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
});

test('excessive empty WAV chunks cannot monopolize optional analysis', async () => {
  const { bytes } = wav();
  const chunks = Buffer.alloc(129 * 8);
  for (let at = 0; at < chunks.length; at += 8) chunks.write('JUNK', at);
  const padded = Buffer.concat([bytes.subarray(0, 36), chunks, bytes.subarray(36)]);
  padded.writeUInt32LE(padded.length - 8, 4);
  expect(await analyze(new Blob([padded]), undefined, async () => {})).toBeNull();
});

test('unusual accepted sample rates retain exact frame timing without accumulating drift', async () => {
  const result = await analyze(wav({ rate: 8192 }).blob, undefined, async () => {});
  expect(result.step * 8192).toBe(328);
  expect(result.shapes[Math.floor(0.6 / result.step)]).toBe(2);
  expect(result.shapes[Math.floor(0.9 / result.step)]).toBe(0);
});
