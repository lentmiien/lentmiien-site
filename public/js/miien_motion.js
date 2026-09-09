((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./miien_layers'));
  else root.MiienMotion = factory(root.MiienLayers);
})(typeof window === 'object' ? window : this, Layers => {
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
    // Keep the original neutral contract; optional additional rigs are bounded
    // and unique, so legacy still-only manifests continue to work.
    if (manifest.expressions !== undefined && (!Array.isArray(manifest.expressions) || manifest.expressions.length > 4)) return null;
    const rigs = [...(manifest.layered !== undefined ? [manifest.layered] : []), ...(manifest.expressions || [])];
    const rigMoods = new Set();
    for (const rig of rigs) {
      if (!rig || rig.version !== 1 || !moods.includes(rig.mood) || rigMoods.has(rig.mood) || rig.reviewStatus !== 'prototype'
        || rig.width !== 768 || rig.height !== 1024 || !local(rig.provenance, 'json') || !rig.mouths) return null;
      if ((rig === manifest.layered) !== (rig.mood === 'neutral')) return null;
      rigMoods.add(rig.mood);
      for (const item of [rig.base, rig.blink, rig.mouths.small, rig.mouths.open]) {
        if (!item || !local(item.src, 'webp') || !hash(item.sha256)
          || !Number.isInteger(item.x) || item.x < 0 || !Number.isInteger(item.y) || item.y < 0
          || !Number.isInteger(item.width) || item.width < 1 || !Number.isInteger(item.height) || item.height < 1
          || item.x + item.width > rig.width || item.y + item.height > rig.height) return null;
      }
      if (rig.base.x !== 0 || rig.base.y !== 0 || rig.base.width !== rig.width || rig.base.height !== rig.height) return null;
    }
    return manifest;
  }
  // Clips are approved build assets, never generated or selected from user text.
  function create({ document, still, status, Image, mediaQuery, connection }) {
    let manifest = null, generation = 0, video = null, timer, enabled = true, rig = null, disposed = false;
    let mouthShape = 0, rigMood = '';
    let mood = 'neutral', state = 'idle', hidden = Boolean(document.hidden), currentKey = '';
    const preload = new Map();
    const load = src => {
      let entry = preload.get(src);
      if (!entry) {
        const image = new Image(); image.src = src;
        entry = { image, ready: Promise.resolve().then(() => image.decode()) };
        entry.ready.catch(() => { if (preload.get(src) === entry) preload.delete(src); });
      }
      preload.delete(src); preload.set(src, entry);
      // At most two complete expression sets retained by this controller.
      // Browser HTTP/decoded-image caching remains browser managed.
      while (preload.size > 10) preload.delete(preload.keys().next().value);
      return entry.ready;
    };
    const halt = (keepRig = false) => {
      generation += 1;
      clearTimeout(timer);
      rig?.mouth(0);
      if (!keepRig) { rig?.dispose(); rig = null; rigMood = ''; still.hidden = false; }
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; }
      currentKey = '';
    };
    async function show(nextMood = mood, nextState = state, force = false) {
      if (disposed) return;
      mood = moods.includes(nextMood) ? nextMood : 'neutral';
      state = states.includes(nextState) ? nextState : 'idle';
      if (state !== 'speaking') { mouthShape = 0; rig?.mouth(0); }
      // Activity changes must not restart the independent breathing/blink clocks.
      const layered = Layers && (mood === 'neutral' ? manifest?.layered : manifest?.expressions?.find(item => item.mood === mood));
      const key = `${mood}:${layered ? 'layered' : state}:${enabled}:${mediaQuery.matches}:${hidden}:${Boolean(connection?.saveData)}`;
      if (!force && key === currentKey) return;
      const animate = enabled && !mediaQuery.matches && !hidden && !connection?.saveData;
      halt(Boolean(layered && animate && rig)); currentKey = key;
      const version = generation;
      const asset = manifest?.stills.find(item => item.mood === mood);
      const src = asset?.src || `/i/miien/${mood}.webp`;
      if (!hidden) timer = setTimeout(() => {
        if (version !== generation) return;
        // A never-settling decode must not poison subsequent explicit retries.
        for (const path of [src, layered?.base.src, layered?.blink.src, layered?.mouths.small.src, layered?.mouths.open.src]) preload.delete(path);
        halt(); status.textContent = 'Expression loading timed out; showing the current portrait.';
      }, 10000);
      try {
        await load(src);
        if (version !== generation) return;
        still.src = src; still.hidden = Boolean(rig); still.alt = `Miien with a ${mood} expression`;
        status.textContent = '';
      } catch (_) {
        if (version === generation) { halt(); status.textContent = 'Expression image unavailable; keeping the current portrait.'; }
        return;
      }
      if (!animate) { clearTimeout(timer); return; }
      if (layered) {
        const asset = layered;
        const items = [asset.base, asset.blink, asset.mouths.small, asset.mouths.open];
        const fail = () => {
          if (version !== generation) return;
          halt(); still.src = src;
          status.textContent = 'Character layers unavailable; showing the expression portrait.';
        };
        try {
          await Promise.all(items.map(item => load(item.src)));
          if (version !== generation) return;
          clearTimeout(timer);
          rig?.dispose();
          rig = Layers.create({ document, still, asset, onError: fail });
          rigMood = asset.mood;
          rig.mouth(state === 'speaking' ? mouthShape : 0);
          still.hidden = true;
        } catch (_) { fail(); }
        return;
      }
      const clip = manifest?.clips.find(item => item.mood === mood && item.state === state);
      if (!clip) { clearTimeout(timer); return; }
      // The incoming first frame sits below the decoder, avoiding a portrait jump.
      try {
        await load(clip.poster);
        if (version !== generation) return;
        still.src = clip.poster;
      } catch (_) {
        if (version === generation) { clearTimeout(timer); status.textContent = 'Motion poster unavailable; showing the expression portrait.'; }
        return;
      }
      const candidate = document.createElement('video');
      video = candidate;
      candidate.className = 'character-motion'; candidate.hidden = true;
      candidate.muted = true; candidate.defaultMuted = true; candidate.playsInline = true;
      candidate.setAttribute('playsinline', ''); candidate.setAttribute('aria-hidden', 'true');
      candidate.loop = manifest.policy.loop; candidate.preload = 'auto'; candidate.poster = clip.poster;
      const fail = () => {
        if (version !== generation) return;
        halt(); still.src = src; status.textContent = 'Motion unavailable; showing the expression portrait.';
      };
      candidate.onerror = fail;
      candidate.onplaying = () => { if (version === generation) { clearTimeout(timer); candidate.hidden = false; } };
      candidate.oncanplay = () => {
        if (version !== generation) return;
        Promise.resolve(candidate.play()).catch(fail);
      };
      candidate.onended = fail;
      clearTimeout(timer); timer = setTimeout(fail, 10000);
      still.after(candidate); candidate.src = clip.src;
    }
    const refresh = () => show(mood, state, true);
    mediaQuery.addEventListener?.('change', refresh);
    connection?.addEventListener?.('change', refresh);
    return {
      show,
      mouth(value) { mouthShape = state === 'speaking' && [1, 2].includes(value) ? value : 0; rig?.mouth(rigMood === mood ? mouthShape : 0); },
      setManifest(value) { manifest = validate(value); return refresh(); },
      enable(value) { enabled = Boolean(value); return refresh(); },
      suspend(value) { if (hidden === Boolean(value)) return; hidden = Boolean(value); return refresh(); },
      dispose() { disposed = true; halt(); preload.clear(); mediaQuery.removeEventListener?.('change', refresh); connection?.removeEventListener?.('change', refresh); },
    };
  }
  return { moods, states, local, validate, create };
});
