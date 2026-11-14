// audio.js — procedural Web Audio SFX (no external files)
export const Audio = (() => {
  let ctx = null, master = null, noiseBuf = null, muted = false, lastPlay = {};

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function beep({ freq = 440, type = "sine", dur = 0.12, gain = 0.2, attack = 0.004,
                 decay = null, slide = null, when = 0 }) {
    if (muted) return;
    ensure(); if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, slide), t0 + (dur));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay ?? dur));
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + (decay ?? dur) + 0.03);
  }

  function noise({ dur = 0.2, gain = 0.15, filter = 1200, type = "lowpass", when = 0, sweep = null }) {
    if (muted) return;
    ensure(); if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filter, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // Throttle identical SFX so we don't machine-gun the same sound.
  function gate(name, ms) {
    const n = performance.now();
    if (lastPlay[name] && n - lastPlay[name] < ms) return false;
    lastPlay[name] = n; return true;
  }

  const defs = {
    shoot:  () => gate("shoot", 70) && beep({ freq: 620, type: "triangle", dur: 0.08, gain: 0.06, slide: 320 }),
    hit:    () => gate("hit", 45) && (beep({ freq: 180, type: "square", dur: 0.05, gain: 0.05, slide: 90 }), noise({ dur: 0.05, gain: 0.03, filter: 900 })),
    kill:   () => gate("kill", 55) && (beep({ freq: 300, type: "sawtooth", dur: 0.12, gain: 0.06, slide: 70 }), noise({ dur: 0.14, gain: 0.06, filter: 1600, sweep: 300 })),
    pickup: () => gate("pickup", 40) && beep({ freq: 900, type: "sine", dur: 0.06, gain: 0.04, slide: 1400 }),
    ore:    () => gate("ore", 60) && beep({ freq: 1200, type: "triangle", dur: 0.07, gain: 0.045, slide: 1900 }),
    hurt:   () => gate("hurt", 120) && (beep({ freq: 120, type: "sawtooth", dur: 0.22, gain: 0.14, slide: 55 }), noise({ dur: 0.25, gain: 0.1, filter: 500, type: "lowpass" })),
    level:  () => [0, 0.08, 0.16].forEach((w, i) => beep({ freq: 520 * Math.pow(1.25, i), type: "triangle", dur: 0.18, gain: 0.1, when: w, slide: 520 * Math.pow(1.5, i) })),
    upgrade:() => [0, 0.06, 0.12, 0.2].forEach((w, i) => beep({ freq: 440 * Math.pow(1.33, i), type: "sine", dur: 0.16, gain: 0.11, when: w, slide: 440 * Math.pow(1.5, i) })),
    combo:  () => { [0,0.07,0.14,0.22,0.32].forEach((w,i)=>beep({freq:392*Math.pow(1.26,i),type:"triangle",dur:0.22,gain:0.12,when:w,slide:392*Math.pow(1.5,i)})); noise({dur:0.5,gain:0.08,filter:2200,sweep:200,when:0.05}); },
    boss:   () => { beep({ freq: 60, type: "sawtooth", dur: 1.1, gain: 0.16, slide: 40 }); noise({ dur: 1.0, gain: 0.1, filter: 300, sweep: 90 }); },
    start:  () => { beep({ freq: 200, type: "sine", dur: 0.6, gain: 0.12, slide: 820 }); noise({ dur: 0.4, gain: 0.05, filter: 800, sweep: 2400 }); },
    over:   () => { [0,0.12,0.24,0.4].forEach((w,i)=>beep({freq:440/Math.pow(1.3,i),type:"triangle",dur:0.4,gain:0.12,when:w,slide:220/Math.pow(1.3,i)})); },
    buy:    () => [0,0.05].forEach((w,i)=>beep({freq:660*Math.pow(1.4,i),type:"sine",dur:0.12,gain:0.1,when:w,slide:660*Math.pow(1.5,i)})),
    deny:   () => beep({ freq: 200, type: "square", dur: 0.1, gain: 0.06, slide: 140 }),
    ui:     () => beep({ freq: 520, type: "sine", dur: 0.05, gain: 0.05, slide: 640 }),
  };

  return {
    unlock() { ensure(); if (ctx && ctx.state === "suspended") ctx.resume(); },
    sfx(name, opts) { const d = defs[name]; if (d) d(opts); },
    setMuted(b) { muted = !!b; },
    isMuted() { return muted; },
  };
})();
