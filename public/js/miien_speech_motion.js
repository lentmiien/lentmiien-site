((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiienSpeechMotion = factory();
})(typeof window === 'object' ? window : this, () => {
  'use strict';
  // Deliberately approximate, not phonemes or PCM amplitude. Media time prevents
  // motion during a stalled clock; browser speech offers only lifecycle events.
  const envelope = seconds => [0, 1, 1, 2, 1, 0, 1, 2, 1, 0, 1][Math.floor(seconds * 9) % 11] || 0;
  function create({ onShape, now = () => performance.now(), schedule = setInterval, cancel = clearInterval }) {
    let timer, epoch = 0;
    function stop() { epoch += 1; cancel(timer); timer = null; onShape(0); }
    return {
      stop,
      start(media) {
        stop();
        const version = epoch, started = now();
        let previous = media?.currentTime;
        timer = schedule(() => {
          if (version !== epoch) return;
          if (!media) { onShape(envelope((now() - started) / 1000)); return; }
          const time = media.currentTime;
          const advancing = Number.isFinite(time) && time > previous && time - previous < 0.5;
          previous = time;
          onShape(advancing && !media.paused && !media.ended && !media.seeking && !media.muted
            && media.volume > 0 && media.readyState >= 3 ? envelope(time) : 0);
        }, 80);
      },
    };
  }
  return { create, envelope };
});
