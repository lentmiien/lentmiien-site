/* Shared deterministic validation and bounded media lifecycle. No network at import. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonsterVN = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const defaults = { chapter: 0, beat: 0, volume: 0.8, rate: 1, font: 1, voice: true, auto: false };
  function assetPath(value, kind) {
    const pattern = kind === 'image' ? /^assets\/images\/[a-z][a-z0-9-]{0,50}\.webp$/ : /^assets\/audio\/c\d{2}-b\d{3}-[a-f0-9]{12}\.mp3$/;
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Invalid local asset');
    return value;
  }
  function validateBook(book) {
    if (!book || book.version !== 1 || !Array.isArray(book.chapters) || book.chapters.length !== 17) throw new Error('Invalid story');
    let total = 0;
    for (const chapter of book.chapters) {
      if (typeof chapter.title !== 'string' || chapter.title.length > 80 || !Array.isArray(chapter.beats) || !chapter.beats.length || chapter.beats.length > 300) throw new Error('Invalid chapter');
      for (const beat of chapter.beats) {
        if (typeof beat.text !== 'string' || !beat.text.length || beat.text.length > 220 || !Number.isInteger(beat.scene) || beat.scene < 1) throw new Error('Invalid beat');
        assetPath(beat.background, 'image');
        assetPath(beat.audio, 'audio');
        if (!Array.isArray(beat.sprites) || beat.sprites.length > 3) throw new Error('Invalid cast');
        beat.sprites.forEach(p => assetPath(p, 'image'));
        if (!Number.isFinite(beat.duration) || beat.duration <= 0 || beat.duration > 120) throw new Error('Invalid duration');
        total++;
      }
    }
    if (total > 4000) throw new Error('Story too large');
    return book;
  }
  function readSave(raw, book) {
    const state = { ...defaults };
    try {
      if (typeof raw !== 'string' || raw.length > 1000) return state;
      const value = JSON.parse(raw);
      if (!value || value.version !== 1) return state;
      if (Number.isInteger(value.chapter) && value.chapter >= 0 && value.chapter < book.chapters.length) {
        state.chapter = value.chapter;
        if (Number.isInteger(value.beat) && value.beat >= 0 && value.beat < book.chapters[state.chapter].beats.length) state.beat = value.beat;
      }
      for (const [key, min, max] of [['volume', 0, 1], ['rate', 0.75, 1.5], ['font', 0.9, 1.5]]) {
        if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= min && value[key] <= max) state[key] = value[key];
      }
      if (![0.75, 1, 1.25, 1.5].includes(state.rate)) state.rate = defaults.rate;
      if (typeof value.voice === 'boolean') state.voice = value.voice;
      // Automatic playback always requires a fresh reader gesture.
    } catch (_) { /* Invalid/old saves restart safely. */ }
    return state;
  }
  function preloadPaths(book, chapter, beat) {
    return [...new Set(book.chapters[chapter].beats.slice(beat, beat + 2).flatMap(b => [b.background, ...b.sprites]))].slice(0, 8);
  }
  class Playback {
    constructor(createAudio, callbacks) { this.createAudio = createAudio; this.callbacks = callbacks; this.token = 0; this.audio = null; this.timer = null; }
    stop() {
      this.token++;
      clearTimeout(this.timer);
      if (this.audio) {
        this.audio.onended = this.audio.onerror = this.audio.ontimeupdate = this.audio.onplaying = this.audio.onwaiting = null;
        this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null;
      }
    }
    async play(beat, state) {
      this.stop();
      const token = this.token;
      const current = () => this.token === token;
      const audio = this.createAudio(); this.audio = audio;
      audio.preload = 'auto'; audio.src = assetPath(beat.audio, 'audio'); audio.volume = state.volume; audio.playbackRate = state.rate;
      const failure = () => { if (current()) { this.stop(); this.callbacks.error(); } };
      const watchdog = () => { clearTimeout(this.timer); this.timer = setTimeout(failure, 20000); };
      audio.onwaiting = () => { if (current()) { this.callbacks.loading(); watchdog(); } };
      audio.onplaying = () => { if (current()) { clearTimeout(this.timer); this.callbacks.playing(); } };
      audio.ontimeupdate = () => { if (current()) this.callbacks.progress(audio.currentTime / (audio.duration || beat.duration)); };
      audio.onerror = failure;
      audio.onended = () => { if (current()) { this.stop(); this.callbacks.progress(1); this.callbacks.ended(); } };
      this.callbacks.loading(); watchdog();
      try { await audio.play(); } catch (_) { failure(); }
    }
  }
  return { defaults, assetPath, validateBook, readSave, preloadPaths, Playback };
}));
