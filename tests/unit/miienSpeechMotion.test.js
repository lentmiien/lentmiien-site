const { create } = require('../../public/js/miien_speech_motion');
function setup() {
  let tick, time = 0;
  const onShape = jest.fn(), cancel = jest.fn();
  const motion = create({ onShape, now: () => time, schedule: fn => { tick = fn; return 1; }, cancel });
  return { motion, onShape, cancel, tick: () => tick(), advance: ms => { time += ms; }, callback: () => tick };
}
const media = () => ({ currentTime: 0, paused: false, ended: false, seeking: false, muted: false, volume: 1, readyState: 4 });
test('only advancing media time opens the mouth; frozen, jumped and silent playback close it', () => {
  const f = setup(), audio = media(); f.motion.start(audio); expect(f.onShape).toHaveBeenLastCalledWith(0);
  audio.currentTime = 0.2; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(1);
  f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  audio.currentTime = 10; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  audio.currentTime = 0.1; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  for (const patch of [{ paused: true }, { ended: true }, { seeking: true }, { muted: true }, { volume: 0 }, { readyState: 2 }]) {
    Object.assign(audio, media(), patch); f.motion.start(audio); audio.currentTime = 0.2;
    f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  }
});
test('Stop and restarted playback invalidate even a queued old animation callback', () => {
  const f = setup(), audio = media(); f.motion.start(audio); const old = f.callback();
  f.motion.stop(); audio.currentTime = 0.2; old(); expect(f.onShape).toHaveBeenLastCalledWith(0);
  f.motion.start(audio); const count = f.onShape.mock.calls.length; old(); expect(f.onShape).toHaveBeenCalledTimes(count);
  audio.currentTime = 0.36; f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(2);
  f.motion.stop(); expect(f.cancel).toHaveBeenCalledWith(1); expect(f.onShape).toHaveBeenLastCalledWith(0);
});
test('browser speech uses a conservative elapsed envelope between explicit lifecycle events only', () => {
  const f = setup(); f.advance(1000); expect(f.onShape).not.toHaveBeenCalled();
  f.motion.start(); f.advance(200); f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(1);
  f.motion.stop(); f.advance(1000); f.tick(); expect(f.onShape).toHaveBeenLastCalledWith(0);
});
