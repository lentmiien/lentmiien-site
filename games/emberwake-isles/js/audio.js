export class Audio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.last = 0;
  }
  enable(enabled) {
    this.enabled = enabled;
    if (enabled) {
      try {
        this.context ||= new (window.AudioContext || window.webkitAudioContext)();
        this.context.resume();
      } catch {
        this.enabled = false;
      }
    }
  }
  tone(freq = 220, length = .12, type = 'sine', volume = .03) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context,
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length);
  }
  effect(kind) {
    if (!this.enabled) return;
    if (kind === 'mine') this.tone(130, .1, 'triangle');else if (kind === 'place') this.tone(280, .14, 'triangle');else if (kind === 'craft') {
      this.tone(440, .2);
      setTimeout(() => this.tone(660, .25), 100);
    } else if (kind === 'music') {
      [262, 330, 392, 523, 440, 392].forEach((f, n) => setTimeout(() => this.tone(f, .65, 'sine', .018), n * 210));
    } else if (kind === 'storm') this.tone(45, 5, 'triangle', .16);else this.tone(330, .16);
  }
  ambient(time, ocean) {
    if (!this.enabled || time - this.last < 6) return;
    this.last = time;
    this.tone(ocean ? 110 : 780, 1.7, 'sine', .007);
  }
}
