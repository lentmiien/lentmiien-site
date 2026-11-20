/* =====================================================================
 * sound.js — tiny WebAudio bleeps (retro 1991 vibes), always safe to call
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  let ctx = null;
  let muted = false;

  function ac() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  function tone(freq, at, dur, vol, type) {
    const a = ac();
    if (!a) return;
    try {
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      const t0 = a.currentTime + at;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* audio not available: ignore */ }
  }

  Civ.sound = {
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },

    /* soft end-of-turn blip */
    turn() {
      if (muted) return;
      tone(660, 0, 0.08, 0.05);
    },

    /* the classic two-note "discovery!" chime */
    tech() {
      if (muted) return;
      tone(523.25, 0, 0.14, 0.09, 'triangle');   // C5
      tone(783.99, 0.14, 0.3, 0.09, 'triangle');  // G5
    },

    /* short war-drum-ish hit */
    war() {
      if (muted) return;
      tone(196, 0, 0.18, 0.12, 'sawtooth');       // G3
      tone(147, 0.1, 0.25, 0.12, 'sawtooth');     // D3
    },

    /* fanfare for victory, dirge-ish for defeat */
    victory() {
      if (muted) return;
      const seq = [523.25, 659.25, 783.99, 1046.5];
      seq.forEach((f, i) => tone(f, i * 0.16, 0.25, 0.1, 'triangle'));
    },
    defeat() {
      if (muted) return;
      const seq = [392, 349.23, 293.66, 261.63];
      seq.forEach((f, i) => tone(f, i * 0.2, 0.3, 0.1, 'triangle'));
    },
  };

})(window.Civ);
