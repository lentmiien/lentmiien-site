((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiienMotion = factory();
})(typeof window === 'object' ? window : this, () => {
  'use strict';
  const moods = ['neutral', 'happy', 'thoughtful', 'concerned', 'surprised'];
  const states = ['idle', 'listening', 'thinking', 'speaking'];
  const local = (path, extension) => typeof path === 'string' && path.length <= 140
    && new RegExp(`^/i/miien/(?:[a-z0-9_-]+/)*[a-z0-9_-]+\\.${extension}$`).test(path);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const dimensions = item => Number.isInteger(item.width) && item.width >= 64 && item.width <= 1920
    && Number.isInteger(item.height) && item.height >= 64 && item.height <= 1920;
  function validate(manifest) {
    if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.assetVersion !== 'string'
      || !/^[a-z0-9.-]{1,40}$/.test(manifest.assetVersion) || !Array.isArray(manifest.stills)
      || manifest.stills.length !== 5 || !Array.isArray(manifest.clips) || manifest.clips.length > 20
      || !['not-produced', 'reviewed'].includes(manifest.clipStatus)
      || !manifest.policy || manifest.policy.crossfadeMs !== 0 || manifest.policy.loop !== true) return null;
    const seen = new Set();
    for (const still of manifest.stills) {
      if (!still || !moods.includes(still.mood) || seen.has(still.mood) || !local(still.src, 'webp')
        || !dimensions(still) || !hash(still.sha256) || !local(still.provenance, 'json')) return null;
      seen.add(still.mood);
    }
    const slots = new Set();
    for (const clip of manifest.clips) {
      const key = `${clip?.state}:${clip?.mood}`;
      if (!clip || !states.includes(clip.state) || !moods.includes(clip.mood) || slots.has(key)
        || !local(clip.src, 'mp4') || !local(clip.poster, 'webp') || !local(clip.provenance, 'json')
        || !hash(clip.sha256) || !hash(clip.posterSha256) || !dimensions(clip) || clip.silent !== true
        || !Number.isFinite(clip.fps) || clip.fps < 1 || clip.fps > 60
        || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0 || clip.durationSeconds > 10) return null;
      slots.add(key);
    }
    if (manifest.clips.length && manifest.clipStatus !== 'reviewed') return null;
    return manifest;
  }
  // Clips are approved build assets, never generated or selected from user text.
  function create({ document, still, status, Image, mediaQuery }) {
    let manifest = null, generation = 0, video = null, timer, enabled = true;
    let mood = 'neutral', state = 'idle', hidden = false, currentKey = '';
    const preload = new Map();
    const halt = () => {
      generation += 1;
      clearTimeout(timer);
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; }
      currentKey = '';
    };
    async function show(nextMood = mood, nextState = state, force = false) {
      mood = moods.includes(nextMood) ? nextMood : 'neutral';
      state = states.includes(nextState) ? nextState : 'idle';
      const key = `${mood}:${state}:${enabled}:${mediaQuery.matches}:${hidden}`;
      if (!force && key === currentKey) return;
      halt(); currentKey = key;
      const version = generation;
      const asset = manifest?.stills.find(item => item.mood === mood);
      const src = asset?.src || `/i/miien/${mood}.webp`;
      if (!preload.has(src)) { const image = new Image(); image.src = src; preload.set(src, image); }
      try {
        await preload.get(src).decode();
        if (version !== generation) return;
        still.src = src; still.hidden = false; still.alt = `Miien with a ${mood} expression`;
        status.textContent = '';
      } catch (_) {
        if (version === generation) status.textContent = 'Expression image unavailable; keeping the current portrait.';
        return;
      }
      if (!enabled || mediaQuery.matches || hidden) return;
      const clip = manifest?.clips.find(item => item.mood === mood && item.state === state);
      if (!clip) return;
      const candidate = document.createElement('video');
      video = candidate;
      candidate.className = 'character-motion'; candidate.hidden = true;
      candidate.muted = true; candidate.defaultMuted = true; candidate.playsInline = true;
      candidate.setAttribute('playsinline', ''); candidate.setAttribute('aria-hidden', 'true');
      candidate.loop = manifest.policy.loop; candidate.preload = 'auto'; candidate.poster = clip.poster;
      const fail = () => {
        if (version !== generation) return;
        halt(); status.textContent = 'Motion unavailable; showing the expression portrait.';
      };
      candidate.onerror = fail;
      candidate.onplaying = () => { if (version === generation) { clearTimeout(timer); candidate.hidden = false; } };
      candidate.oncanplay = () => {
        if (version !== generation) return;
        Promise.resolve(candidate.play()).catch(fail);
      };
      candidate.onended = fail;
      timer = setTimeout(fail, 10000);
      still.after(candidate); candidate.src = clip.src;
    }
    const refresh = () => show(mood, state, true);
    mediaQuery.addEventListener?.('change', refresh);
    return {
      show,
      setManifest(value) { manifest = validate(value); return refresh(); },
      enable(value) { enabled = Boolean(value); return refresh(); },
      suspend(value) { hidden = Boolean(value); return refresh(); },
      dispose() { halt(); mediaQuery.removeEventListener?.('change', refresh); },
    };
  }
  return { moods, states, local, validate, create };
});
