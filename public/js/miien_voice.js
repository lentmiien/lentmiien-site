(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const room = el('miien-room');
  if (!room) return;
  const enabled = el('speech-enabled'), select = el('speech-voice'), mode = el('speech-mode');
  const status = el('speech-status'), synth = window.speechSynthesis;
  const base = `/chat5/miien/${encodeURIComponent(room.dataset.id)}`;
  const handleKey = `miienSpeech:${room.dataset.id}`;
  let generation = 0, watchdog, pollTimer, request, audio, objectUrl, audioMessage, currentJob;
  let voices = [], preferred = '', disposed = false, phase = 'idle', latestMessage = null;
  const activity = value => { phase = value; window.dispatchEvent(new CustomEvent('miien:voice', { detail: { phase } })); };
  const storage = (key, value) => {
    try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Optional tab preferences/handle. */ }
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem('miienVoice') || '{}');
    enabled.checked = saved.enabled === true;
    preferred = typeof saved.voice === 'string' ? saved.voice : '';
    const requested = ['off', 'browser', 'anny_en'].includes(saved.mode) ? saved.mode : enabled.checked ? 'browser' : 'off';
    mode.value = requested === 'anny_en' && room.dataset.speechAllowed !== 'true' ? 'off' : requested;
  } catch (_) { /* Optional preferences. */ }
  const save = () => storage('miienVoice', { enabled: enabled.checked, voice: select.value, mode: mode.value });
  function stop({ preserve = false } = {}) {
    generation += 1;
    clearTimeout(watchdog); clearTimeout(pollTimer); request?.abort(); request = null;
    synth?.cancel();
    if (audio) { audio.onplaying = audio.onended = audio.onerror = audio.onpause = audio.onwaiting = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null; audioMessage = null; currentJob = null;
    if (!preserve) storage(handleKey, null);
    activity('idle');
    status.textContent = 'Audio stopped. Accepted Anny generation may continue upstream. Replay is available.';
  }
  function populate() {
    const previous = select.value || preferred;
    voices = synth.getVoices(); select.replaceChildren(new Option('Browser default', ''));
    voices.forEach(voice => select.add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · device' : ' · online'}`, voice.voiceURI)));
    if (voices.some(voice => voice.voiceURI === previous)) select.value = previous;
  }
  function fail(message, version) {
    if (version !== generation) return;
    stop(); status.textContent = message;
  }
  async function api(path, options, version, binary = false) {
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(base + path, { credentials: 'same-origin', ...options, signal: controller.signal,
        headers: { Accept: binary ? 'audio/wav' : 'application/json', 'X-CSRF-Token': room.dataset.csrf, ...options?.headers } });
      if (!response.ok) {
        let data; try { data = await response.json(); } catch (_) { /* Session HTML. */ }
        throw new Error(data?.error || 'Speech unavailable. Reload to check your session.');
      }
      if (binary) {
        if (!response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('Speech audio is invalid.');
        // The server also caps the streamed provider response before retaining it.
        const blob = await response.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Speech audio exceeds the preview limit.');
        return blob;
      }
      return await response.json();
    } finally { clearTimeout(timeout); if (version === generation) request = null; }
  }
  const validJob = (job, expected) => job && /^[a-f\d-]{36}$/i.test(job.id)
    && /^[a-f\d]{24}$/i.test(job.messageId) && job.voiceId === 'anny_en' && job.backendId === 'omni_anny_en'
    && ['preparing', 'ready', 'failed', 'timeout'].includes(job.status)
    && (!expected || (job.id === expected.id && job.messageId === expected.messageId && job.backendId === expected.backendId))
    && (latestMessage === null || job.messageId === latestMessage);
  const notice = job => job.truncated
    ? 'Preview: first 600 characters only. The full reply remains in captions and history.'
    : `Preview: ${job.spokenCharacters} characters. Full reply retained.`;
  function play(version) {
    if (!audio || version !== generation) return;
    activity('preparing');
    status.textContent = 'Starting Anny audio…';
    // Playback follows the media playing event, never synthesis or play() itself.
    audio.onplaying = () => { if (version === generation) { activity('playing'); status.textContent = `Speaking · ${notice(currentJob)}`; } };
    audio.onwaiting = () => { if (version === generation) { activity('preparing'); status.textContent = 'Buffering Anny audio…'; } };
    audio.onpause = () => { if (version === generation) activity('idle'); };
    audio.onended = () => {
      if (version !== generation) return;
      generation += 1; clearTimeout(watchdog); activity('idle'); status.textContent = `Playback finished. ${notice(currentJob)}`;
      storage(handleKey, null);
    };
    audio.onerror = () => fail('Anny audio could not play. Choose browser voice or keep reading.', version);
    clearTimeout(watchdog);
    watchdog = setTimeout(() => fail('Playback stopped after three minutes. Full reply retained.', version), 180000);
    try {
      Promise.resolve(audio.play()).catch(() => {
        if (version !== generation) return;
        generation += 1; clearTimeout(watchdog); activity('idle');
        status.textContent = `Audio ready. Browser blocked autoplay; press Replay. ${notice(currentJob)}`;
      });
    } catch (_) { generation += 1; clearTimeout(watchdog); activity('idle'); status.textContent = 'Audio ready. Press Replay to allow playback.'; }
  }
  async function poll(job, version, autoplay) {
    if (version !== generation || disposed) return;
    if (job.status === 'preparing' && (!Number.isFinite(job.deadlineAt) || Date.now() > job.deadlineAt + 15000)) {
      fail('Anny polling deadline reached. Upstream generation may continue. Full reply is saved.', version); return;
    }
    try {
      const result = await api(`/speech/${encodeURIComponent(job.id)}`, {}, version);
      if (version !== generation || disposed) return;
      if (!validJob(result, job)) {
        fail('Anny preview does not match this job, backend or latest reply. Use Replay for the latest reply.', version); return;
      }
      currentJob = result;
      if (result.status === 'preparing') {
        if (!Number.isFinite(result.deadlineAt) || Date.now() > result.deadlineAt + 15000) {
          fail('Anny polling deadline reached. Upstream generation may continue. Full reply is saved.', version); return;
        }
        activity('preparing'); status.textContent = `Preparing Anny English · OmniVoice preview (20 minute limit). ${notice(result)}`;
        pollTimer = setTimeout(() => poll(result, version, autoplay), 5000);
      } else if (result.status === 'ready') {
        activity('idle');
        status.textContent = `Anny audio ready. Press Replay to play. ${notice(result)}`;
        if (!autoplay || document.hidden) return;
        activity('preparing'); status.textContent = `Loading Anny audio… ${notice(result)}`;
        const blob = await api(`/speech/${encodeURIComponent(job.id)}/audio`, {}, version, true);
        if (version !== generation || disposed) return;
        objectUrl = URL.createObjectURL(blob); audio = new Audio(objectUrl); audioMessage = result.messageId;
        play(version);
      } else fail(result.error || 'Anny failed. Text is saved; choose browser voice or keep reading.', version);
    } catch (error) { fail(`${error.message} No automatic retry was made.`, version); }
  }
  function speak(text, manual = false, messageId = '') {
    if (!manual && (mode.value === 'off' || !enabled.checked)) return;
    if (mode.value === 'anny_en' && manual && audio && audioMessage === messageId && currentJob) {
      const version = ++generation, expected = currentJob;
      clearTimeout(watchdog); clearTimeout(pollTimer); request?.abort(); audio.pause();
      activity('preparing'); status.textContent = 'Checking Anny playback permission…';
      api(`/speech/${encodeURIComponent(expected.id)}`, {}, version).then(result => {
        if (version !== generation || disposed || document.hidden) return;
        if (!validJob(result, expected) || result.status !== 'ready') {
          fail('Anny replay is no longer available for this reply. Text is saved.', version); return;
        }
        currentJob = result;
        try { audio.currentTime = 0; } catch (_) { /* Metadata may still be loading. */ }
        play(version);
      }).catch(() => fail('Anny replay permission could not be verified. Reload to check your session.', version));
      return;
    }
    stop();
    if (mode.value === 'off') { status.textContent = 'Voice is off. Choose a voice in Settings to use Replay.'; return; }
    if (disposed || !text) return;
    const version = generation;
    if (mode.value === 'anny_en') {
      if (!/^[a-f\d]{24}$/i.test(messageId)) { status.textContent = 'Select a saved assistant reply for Anny.'; return; }
      activity('preparing'); status.textContent = 'Preparing Anny English preview · up to 600 characters, up to 20 minutes. You can keep typing.';
      api('/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, voiceId: 'anny_en' }) }, version).then(job => {
        if (version !== generation || disposed) return;
        if (!validJob(job) || job.messageId !== messageId) { fail('Anny returned a mismatched preview. Text is saved.', version); return; }
        storage(handleKey, { id: job.id, messageId: job.messageId, voiceId: job.voiceId, backendId: job.backendId, deadlineAt: job.deadlineAt });
        return poll(job, version, true);
      }).catch(error => fail(`${error.message} No automatic retry was made.`, version));
      return;
    }
    if (!synth || !window.SpeechSynthesisUtterance) { status.textContent = 'Browser speech is unavailable. Text chat works normally.'; return; }
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 3000));
    utterance.voice = voices.find(voice => voice.voiceURI === select.value) || null;
    if (utterance.voice) utterance.lang = utterance.voice.lang;
    activity('preparing'); status.textContent = 'Starting browser voice… If silent, press Replay.';
    utterance.onstart = () => { if (version === generation) { activity('playing'); status.textContent = 'Speaking…'; } };
    utterance.onend = () => { if (version === generation) { generation += 1; clearTimeout(watchdog); activity('idle'); status.textContent = text.length > 3000 ? 'Played the first 3,000 characters. Full reply is in history.' : 'Playback finished.'; } };
    utterance.onerror = () => fail('Voice was unavailable or blocked. Press Replay or keep reading.', version);
    watchdog = setTimeout(() => fail('Browser playback stopped after three minutes.', version), 180000);
    try { synth.speak(utterance); } catch (_) { fail('Browser voice was blocked. Press Replay.', version); }
  }
  function resume() {
    if (mode.value !== 'anny_en' || disposed || document.hidden || latestMessage === null) return;
    try {
      const job = JSON.parse(sessionStorage.getItem(handleKey) || 'null');
      if (!job) return;
      if (!validJob({ ...job, status: 'preparing' })) { stop(); status.textContent = 'Saved Anny preview does not match the latest reply or backend. Use Replay.'; return; }
      stop({ preserve: true }); poll(job, generation, false);
    } catch (_) { /* A lost handle never regenerates audio. */ }
  }
  if (synth && window.SpeechSynthesisUtterance) { populate(); synth.addEventListener('voiceschanged', populate); }
  else select.disabled = true;
  enabled.addEventListener('change', () => { save(); if (!enabled.checked) stop(); });
  mode.addEventListener('change', () => { stop(); save(); });
  select.addEventListener('change', () => { preferred = select.value; save(); stop(); });
  window.addEventListener('pagehide', () => { disposed = true; stop({ preserve: true }); });
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; } });
  window.MiienVoice = { speak, stop, resume,
    setLatestMessage(id) {
      latestMessage = id;
      if (currentJob && currentJob.messageId !== id) fail('Anny preview belongs to an earlier reply. Use Replay for the latest reply.', generation);
    },
    get phase() { return phase; },
  };
  // History initialization never calls speak(); restored jobs only expose status.
  // The room validates fresh history before calling resume().
})();
