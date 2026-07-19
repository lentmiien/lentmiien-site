export class NarrationController extends EventTarget {
  constructor(audioElement) {
    super();
    this.audio = audioElement;
    this.enabled = true;
    this.active = null;
    this.token = 0;
    this.userPaused = false;
    this.unlocked = false;
  }

  async unlock() {
    if (this.unlocked) return;
    this.unlocked = true;

    try {
      const sampleRate = 8000;
      const sampleCount = 400;
      const buffer = new ArrayBuffer(44 + sampleCount * 2);
      const view = new DataView(buffer);
      const writeString = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + sampleCount * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, sampleCount * 2, true);

      const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
      this.audio.muted = true;
      this.audio.src = objectUrl;
      await this.audio.play();
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio.muted = false;
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      this.audio.muted = false;
      this.audio.removeAttribute('src');
      this.audio.load();
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop('disabled');
    this.emitState(this.enabled ? 'ready' : 'disabled');
  }

  async loadTranscript(event) {
    try {
      const response = await fetch(`assets/audio/${event.id}.txt`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Transcript returned ${response.status}`);
      const transcript = (await response.text()).trim();
      return transcript || event.summary;
    } catch (error) {
      return event.summary;
    }
  }

  async hasAudio(eventId) {
    try {
      const response = await fetch(`assets/audio/${eventId}.mp3`, {
        method: 'HEAD',
        cache: 'no-store'
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async play(eventId) {
    this.stop('replaced');
    if (!this.enabled) return { played: false, reason: 'disabled' };

    const token = ++this.token;
    const exists = await this.hasAudio(eventId);
    if (!exists || token !== this.token) {
      this.emitState('transcript-only');
      return { played: false, reason: 'missing' };
    }

    const source = `assets/audio/${eventId}.mp3`;
    this.audio.src = source;
    this.audio.currentTime = 0;
    this.audio.preload = 'auto';

    const completion = new Promise((resolve) => {
      const finish = (reason) => {
        if (!this.active || this.active.token !== token) return;
        const active = this.active;
        this.active = null;
        this.audio.removeEventListener('ended', active.onEnded);
        this.audio.removeEventListener('error', active.onError);
        this.emitState(reason === 'ended' ? 'complete' : reason);
        resolve({ played: true, reason });
      };

      const onEnded = () => finish('ended');
      const onError = () => finish('error');
      this.active = { token, finish, onEnded, onError };
      this.audio.addEventListener('ended', onEnded, { once: true });
      this.audio.addEventListener('error', onError, { once: true });
    });

    try {
      await this.audio.play();
      if (token !== this.token) return { played: false, reason: 'replaced' };
      this.emitState('playing');
      if (this.userPaused) this.audio.pause();
      return await completion;
    } catch (error) {
      if (this.active?.token === token) this.active.finish('blocked');
      return await completion;
    }
  }

  setUserPaused(paused) {
    this.userPaused = Boolean(paused);
    if (!this.active) return;

    if (this.userPaused) {
      this.audio.pause();
      this.emitState('paused');
    } else if (this.enabled) {
      this.audio.play()
        .then(() => this.emitState('playing'))
        .catch(() => this.active?.finish('blocked'));
    }
  }

  stop(reason = 'skipped') {
    this.token += 1;
    if (!this.active) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      return;
    }

    const active = this.active;
    this.audio.pause();
    active.finish(reason);
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  emitState(state) {
    this.dispatchEvent(new CustomEvent('narrationstate', {
      detail: { state, enabled: this.enabled }
    }));
  }
}
