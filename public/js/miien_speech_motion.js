((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiienSpeechMotion = factory();
})(typeof window === 'object' ? window : this, () => {
  'use strict';
  // Only browser speech needs an approximation: it exposes no downstream PCM.
  const envelope = seconds => [0, 1, 1, 2, 1, 0, 1, 2, 1, 0, 1][Math.floor(seconds * 9) % 11] || 0;
  const STEP = 0.04;
  // The speech route accepts only bounded integer PCM WAV. Decode it locally,
  // without an AudioContext, another fetch, or retaining full decoded samples.
  async function analyze(blob, current = () => true, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))) {
    if (!blob || blob.size < 44 || blob.size > 8 * 1024 * 1024 || !current()) return null;
    const buffer = await blob.arrayBuffer();
    if (!current() || buffer.byteLength !== blob.size) return null;
    const view = new DataView(buffer);
    const tag = offset => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) !== buffer.byteLength - 8) return null;
    let offset = 12, chunks = 0, format, data;
    while (offset + 8 <= buffer.byteLength) {
      if (++chunks > 128) return null; // Bound header scanning before cooperative sample work.
      const name = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > buffer.byteLength) return null;
      if (name === 'fmt ') {
        if (format || size < 16 || size > 40 || view.getUint16(start, true) !== 1) return null;
        const channels = view.getUint16(start + 2, true), rate = view.getUint32(start + 4, true), bits = view.getUint16(start + 14, true);
        const align = channels * bits / 8;
        if (![1, 2].includes(channels) || rate < 8000 || rate > 48000 || ![16, 24, 32].includes(bits)
          || view.getUint16(start + 12, true) !== align || view.getUint32(start + 8, true) !== rate * align) return null;
        format = { channels, rate, bits, align };
      } else if (name === 'data') {
        if (!format || data || !size || size % format.align) return null;
        data = { start, size };
      }
      offset = start + size + (size % 2);
    }
    if (offset !== buffer.byteLength || !format || !data) return null;
    const { rate, bits, align, channels } = format;
    const frames = data.size / align, duration = frames / rate;
    if (duration <= 0 || duration > 180) return null;
    const windowSize = Math.ceil(rate * STEP), levels = new Float32Array(Math.ceil(frames / windowSize));
    for (let window = 0; window < levels.length; window++) {
      // Yield before analysis and every second of PCM, so play() is never gated
      // by this optional work. Superseding audio stops at the next yield.
      if (window % 25 === 0) { await yieldTask(); if (!current()) return null; }
      const end = Math.min(frames, (window + 1) * windowSize);
      let sum = 0;
      for (let frame = window * windowSize; frame < end; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          const at = data.start + frame * align + channel * bits / 8;
          const sample = bits === 16 ? view.getInt16(at, true) / 32768 : bits === 32 ? view.getInt32(at, true) / 2147483648
            : ((view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getInt8(at + 2) << 16) / 8388608);
          sum += sample * sample;
        }
      }
      levels[window] = Math.sqrt(sum / ((end - window * windowSize) * channels));
    }
    // Use the upper voiced range rather than one peak; do not amplify silence.
    const voiced = levels.filter(value => value >= 0.004).sort();
    const reference = voiced.length ? voiced[Math.floor((voiced.length - 1) * 0.9)] : 0;
    const closed = Math.max(0.004, reference * 0.08), open = Math.max(closed * 2, reference * 0.5);
    return { step: windowSize / rate, duration, shapes: Uint8Array.from(levels, value => value < closed ? 0 : value < open ? 1 : 2) };
  }
  function create({ onShape, now = () => performance.now(), schedule = setInterval, cancel = clearInterval }) {
    let timer, epoch = 0, analysisEpoch = 0, analyzedMedia, energy;
    function stop() { epoch += 1; cancel(timer); timer = null; onShape(0); }
    return {
      stop,
      reset() { stop(); analysisEpoch += 1; analyzedMedia = null; energy = null; },
      async load(media, blob) {
        const version = ++analysisEpoch;
        analyzedMedia = media; energy = null;
        try {
          const result = await analyze(blob, () => version === analysisEpoch);
          if (version !== analysisEpoch) return false;
          energy = result;
          return Boolean(result);
        } catch (_) { return false; } // Unsupported/malformed audio keeps a resting mouth.
      },
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
            && media.volume > 0 && media.readyState >= 3 && media === analyzedMedia && energy
            ? energy.shapes[Math.floor(time / energy.step)] || 0 : 0);
        }, 40);
      },
    };
  }
  return { create, envelope, analyze };
});
