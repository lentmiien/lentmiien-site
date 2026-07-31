'use strict';

(function exposeAudio(root) {
  const DEFAULT_MANIFEST_URL = 'assets/audio/en/audio-manifest.json';

  class GameAudio {
    constructor(options = {}) {
      this.element = options.element || null;
      this.captionElement = options.captionElement || null;
      this.captionTextElement = options.captionTextElement || null;
      this.progressElement = options.progressElement || null;
      this.status = typeof options.status === 'function' ? options.status : () => {};
      this.getSettings = typeof options.getSettings === 'function'
        ? options.getSettings
        : () => ({ voiceMuted: false, voiceVolume: 0.8, autoVoice: true });
      this.manifestUrl = options.manifestUrl || DEFAULT_MANIFEST_URL;
      this.manifest = null;
      this.clipById = new Map();
      this.loadPromise = null;
      this.unlocked = false;
      this.lastClipId = null;
      this.audioContext = null;
      this.failedIds = new Set();

      if (this.element) {
        this.element.addEventListener('timeupdate', () => this.updateProgress());
        this.element.addEventListener('ended', () => {
          this.updateProgress(true);
          this.status('Voice line finished.');
        });
        this.element.addEventListener('error', () => {
          if (this.lastClipId) this.failedIds.add(this.lastClipId);
          this.status('Voice audio could not be played. The complete caption remains available.');
          this.showCaption(this.getClip(this.lastClipId)?.text || '');
        });
      }
    }

    async loadManifest() {
      if (this.manifest) return this.manifest;
      if (this.loadPromise) return this.loadPromise;

      this.loadPromise = fetch(this.manifestUrl, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`Audio manifest returned ${response.status}`);
          return response.json();
        })
        .then((manifest) => {
          if (!manifest || !Array.isArray(manifest.clips)) {
            throw new Error('Audio manifest is missing its clips array');
          }
          this.manifest = manifest;
          this.clipById = new Map(manifest.clips.map((clip) => [clip.id, clip]));
          return manifest;
        })
        .catch((error) => {
          this.status('Voice files are unavailable. The story remains fully playable with captions.');
          console.warn('[The great adventure] Audio manifest unavailable:', error.message);
          return null;
        });

      return this.loadPromise;
    }

    unlock() {
      this.unlocked = true;
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (AudioContextClass) {
        try {
          if (!this.audioContext) this.audioContext = new AudioContextClass();
          if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
          }
        } catch (error) {
          console.warn('[The great adventure] Audio context unavailable:', error.message);
        }
      }
      this.loadManifest().catch(() => {});
    }

    getClip(id) {
      return id ? this.clipById.get(id) || null : null;
    }

    async play(id, options = {}) {
      if (!id) return false;
      const settings = this.getSettings();
      const force = options.force === true;
      this.lastClipId = id;

      await this.loadManifest();
      const clip = this.getClip(id);
      if (!clip) {
        this.status('This voice line is missing. Its text remains on screen.');
        return false;
      }

      this.showCaption(clip.text);
      if (!this.element || !this.unlocked || settings.voiceMuted || (!settings.autoVoice && !force)) {
        return false;
      }

      this.stop(false);
      this.lastClipId = id;
      this.element.volume = Math.max(0, Math.min(1, Number(settings.voiceVolume) || 0));
      this.element.muted = Boolean(settings.voiceMuted);
      this.element.src = clip.mp3;
      this.element.preload = 'metadata';

      try {
        await this.element.play();
        this.status(`${clip.speakerName} voice line playing.`);
        return true;
      } catch (error) {
        this.failedIds.add(id);
        this.status('Automatic voice playback was blocked or unavailable. Use Replay after a tap or key press.');
        console.warn(`[The great adventure] Could not play ${id}:`, error.message);
        return false;
      }
    }

    replay() {
      if (!this.lastClipId) {
        this.status('No voice line is ready to replay.');
        return Promise.resolve(false);
      }
      this.unlock();
      return this.play(this.lastClipId, { force: true });
    }

    stop(clearCaption = false) {
      if (this.element) {
        this.element.pause();
        this.element.removeAttribute('src');
        this.element.load();
      }
      if (clearCaption) this.showCaption('');
      this.updateProgress(true);
    }

    applySettings() {
      if (!this.element) return;
      const settings = this.getSettings();
      this.element.volume = Math.max(0, Math.min(1, Number(settings.voiceVolume) || 0));
      this.element.muted = Boolean(settings.voiceMuted);
      if (settings.voiceMuted) this.element.pause();
    }

    showCaption(text) {
      if (this.captionTextElement) this.captionTextElement.textContent = text || '';
      if (this.captionElement) {
        this.captionElement.hidden = !text;
      }
    }

    updateProgress(forceComplete = false) {
      if (!this.progressElement || !this.element) return;
      const duration = Number(this.element.duration);
      const current = Number(this.element.currentTime);
      const value = forceComplete && duration ? 100 : (
        Number.isFinite(duration) && duration > 0 && Number.isFinite(current)
          ? (current / duration) * 100
          : 0
      );
      this.progressElement.style.setProperty('--voice-progress', `${Math.max(0, Math.min(100, value))}%`);
    }

    playInterfaceTone(kind = 'confirm') {
      const settings = this.getSettings();
      if (!this.unlocked || settings.decorativeMotion === false || settings.voiceMuted || !this.audioContext) return;

      const now = this.audioContext.currentTime;
      const frequencies = kind === 'danger'
        ? [174.61, 146.83]
        : kind === 'checkpoint'
          ? [392, 523.25, 659.25]
          : [440, 554.37];

      frequencies.forEach((frequency, index) => {
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.025, now + index * 0.065 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.065 + 0.24);
        oscillator.connect(gain);
        gain.connect(this.audioContext.destination);
        oscillator.start(now + index * 0.065);
        oscillator.stop(now + index * 0.065 + 0.26);
      });
    }
  }

  root.GameAudio = GameAudio;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameAudio;
  }
}(typeof window !== 'undefined' ? window : globalThis));

