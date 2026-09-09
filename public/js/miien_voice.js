(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const room = el('miien-room');
  if (!room) return;
  const enabled = el('speech-enabled'), select = el('speech-voice'), mode = el('speech-mode');
  const status = el('speech-status'), synth = window.speechSynthesis;
  const base = `/chat5/miien/${encodeURIComponent(room.dataset.id)}`;
  const handleKey = `miienSpeech:${room.dataset.id}`;
  let generation = 0, watchdog, pollTimer, request, audio, objectUrl, audioMessage, currentJob, currentUtterance;
  let voices = [], preferred = '', disposed = false, phase = 'idle', latestMessage = null;
  let eligible = () => true, manualPlayback = false;
  let timings = {}, serverTimings = {}, jobWatchStarted = 0;
  const now = () => performance.now();
  const measure = (stage, started) => {
    const durationMs = Math.max(0, Math.round(now() - started));
    timings[stage] = durationMs;
    // Local, bounded diagnostics only: no identifiers, text, URLs or telemetry.
    window.dispatchEvent(new CustomEvent('miien:voice-timing', { detail: { stage, durationMs } }));
  };
  const active = version => version === generation && !disposed && !document.hidden && eligible(manualPlayback);
  const speechMotion = window.MiienSpeechMotion?.create({
    onShape: shape => window.dispatchEvent(new CustomEvent('miien:mouth', { detail: { shape } })),
  });
  const activity = value => {
    phase = value;
    if (phase === 'playing') speechMotion?.start(audio);
    else speechMotion?.stop();
    window.dispatchEvent(new CustomEvent('miien:voice', { detail: { phase } }));
  };
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
    synth?.cancel(); currentUtterance = null;
    speechMotion?.reset?.();
    if (audio) { audio.onplaying = audio.onended = audio.onerror = audio.onpause = audio.onwaiting = audio.onstalled = audio.onseeking = audio.onseeked = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null; audioMessage = null; currentJob = null;
    if (!preserve) storage(handleKey, null);
    activity('idle');
    status.textContent = 'Audio stopped locally. Accepted voice generation may continue upstream; saved text is kept.';
  }
  function populate() {
    const previous = select.value || preferred;
    voices = synth.getVoices(); select.replaceChildren(new Option('Browser default', ''));
    voices.forEach(voice => select.add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · device' : ' · online'}`, voice.voiceURI)));
    if (voices.some(voice => voice.voiceURI === previous)) select.value = previous;
  }
  function fail(message, version) {
    if (!active(version)) return;
    stop(); status.textContent = message;
  }
  async function api(path, options, version, binary = false) {
    const started = now();
    const stage = binary ? 'audioFetchMs' : options?.method === 'POST' ? 'submitMs' : path.includes('speech-admission') ? 'capacityReadMs' : 'statusReadMs';
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(base + path, { credentials: 'same-origin', ...options, signal: controller.signal,
        headers: { Accept: binary ? 'audio/wav' : 'application/json', 'X-CSRF-Token': room.dataset.csrf, ...options?.headers } });
      if (!response.ok) {
        let data; try { data = await response.json(); } catch (_) { /* Session HTML. */ }
        const error = new Error(data?.error || (response.status === 429
          ? 'Speech request limit reached. Try Replay later.' : 'Speech unavailable. Reload to check your session.'));
        error.occupied = options?.method === 'POST' && response.status === 429 && data?.code === 'speech_admission_occupied';
        throw error;
      }
      if (binary) {
        if (!response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('Speech audio is invalid.');
        // The server also caps the streamed provider response before retaining it.
        const blob = await response.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Speech audio exceeds the preview limit.');
        return blob;
      }
      return await response.json();
    } finally { clearTimeout(timeout); if (version === generation) { request = null; measure(stage, started); } }
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
    if (!audio || !active(version)) return;
    const started = now();
    let measured = false;
    activity('preparing');
    status.textContent = 'Starting Anny audio…';
    // Playback follows the media playing event, never synthesis or play() itself.
    audio.onplaying = () => { if (active(version)) {
      if (!measured) { measure('playbackStartMs', started); measured = true; }
      activity('playing'); status.textContent = `Speaking · ${notice(currentJob)}`;
    } };
    audio.onwaiting = () => { if (active(version)) { activity('buffering'); status.textContent = 'Buffering Anny audio…'; } };
    audio.onstalled = audio.onwaiting;
    audio.onseeking = audio.onwaiting;
    audio.onseeked = () => {
      if (!active(version)) return;
      if (!audio.paused && !audio.ended && audio.readyState < 3) { audio.onwaiting(); return; }
      const playing = !audio.paused && !audio.ended && audio.readyState >= 3;
      activity(playing ? 'playing' : 'idle');
      status.textContent = playing ? `Speaking · ${notice(currentJob)}` : 'Playback paused. Use Replay to start again.';
    };
    audio.onpause = () => { if (active(version)) { activity('idle'); status.textContent = 'Playback paused. Use Replay to start again.'; } };
    audio.onended = () => {
      if (!active(version)) return;
      generation += 1; clearTimeout(watchdog); activity('idle'); status.textContent = `Playback finished. ${notice(currentJob)}`;
      storage(handleKey, null);
    };
    audio.onerror = () => fail('Anny audio could not play. Choose browser voice or keep reading.', version);
    clearTimeout(watchdog);
    watchdog = setTimeout(() => fail('Playback stopped after three minutes. Full reply retained.', version), 180000);
    try {
      Promise.resolve(audio.play()).catch(() => {
        if (!active(version)) return;
        generation += 1; clearTimeout(watchdog); activity('idle');
        status.textContent = `Audio ready. Browser blocked autoplay; press Replay. ${notice(currentJob)}`;
      });
    } catch (_) { if (!active(version)) return; generation += 1; clearTimeout(watchdog); activity('idle'); status.textContent = 'Audio ready. Press Replay to allow playback.'; }
  }
  async function poll(job, version, autoplay) {
    if (!active(version)) return;
    if (job.status === 'preparing' && (!Number.isFinite(job.deadlineAt) || Date.now() > job.deadlineAt + 15000)) {
      fail('Anny polling deadline reached. Upstream generation may continue. Full reply is saved.', version); return;
    }
    try {
      const result = await api(`/speech/${encodeURIComponent(job.id)}`, {}, version);
      if (!active(version)) return;
      if (!validJob(result, job)) {
        fail('Anny preview does not match this job, backend or latest reply. Use Replay for the latest reply.', version); return;
      }
      currentJob = result;
      serverTimings = {};
      for (const key of ['admissionMs', 'catalogMs', 'authorizationMs', 'synthesisMs', 'audio_validationMs', 'retention_authorizationMs', 'totalMs']) {
        if (Number.isFinite(result.timings?.[key]) && result.timings[key] >= 0) serverTimings[key] = result.timings[key];
      }
      if (result.status === 'preparing') {
        if (!Number.isFinite(result.deadlineAt) || Date.now() > result.deadlineAt + 15000) {
          fail('Anny polling deadline reached. Upstream generation may continue. Full reply is saved.', version); return;
        }
        activity('preparing'); status.textContent = `Preparing Anny English · OmniVoice preview (20 minute limit). ${notice(result)}`;
        pollTimer = setTimeout(() => poll(result, version, autoplay), 5000);
      } else if (result.status === 'ready') {
        measure('jobReadyObservedMs', jobWatchStarted);
        activity('idle');
        status.textContent = `Anny audio ready. Press Replay to play. ${notice(result)}`;
        if (!autoplay || document.hidden) return;
        activity('preparing'); status.textContent = `Loading Anny audio… ${notice(result)}`;
        const blob = await api(`/speech/${encodeURIComponent(job.id)}/audio`, {}, version, true);
        if (!active(version)) return;
        objectUrl = URL.createObjectURL(blob); audio = new Audio(objectUrl); audioMessage = result.messageId;
        const target = audio, started = now();
        speechMotion?.load?.(target, blob).then(analyzed => {
          // Replay/end can change generation while this same audio remains valid.
          if (audio !== target || disposed || document.hidden) return;
          measure('envelopeMs', started);
          timings.envelopeAvailable = analyzed;
        });
        play(version);
      } else fail(result.error || 'Anny failed. Text is saved; choose browser voice or keep reading.', version);
    } catch (error) { fail(`${error.message} No automatic retry was made.`, version); }
  }
  async function admit(messageId, version, wait) {
    if (!active(version)) return;
    if (Date.now() >= wait.until || wait.checks >= 240) {
      fail('Waiting for voice capacity ended after 20 minutes. Text is saved; use Replay to try later.', version); return;
    }
    const later = () => {
      activity('preparing');
      status.textContent = 'Waiting for previous voice generation before preparing the latest reply (20 minute wait limit). You can keep typing.';
      pollTimer = setTimeout(() => admit(messageId, version, wait), 5000);
    };
    try {
      wait.checks += 1;
      const capacity = await api(`/speech-admission/${encodeURIComponent(messageId)}`, {}, version);
      if (!active(version)) return;
      if (Date.now() >= wait.until) {
        fail('Waiting for voice capacity ended after 20 minutes. Text is saved; use Replay to try later.', version); return;
      }
      if (capacity?.state === 'occupied') { later(); return; }
      if (capacity?.state === 'blocked') throw new Error('Anny has outstanding or uncertain work. An operator must check Gateway before more voice generation.');
      if (capacity?.state === 'full') throw new Error('Anny audio storage is full. Try Replay later.');
      if (capacity?.state !== 'available') throw new Error('Speech capacity could not be verified. Try Replay later.');
      if (Date.now() < wait.nextPost) { later(); return; }
      wait.posts += 1;
      measure('admissionWaitMs', wait.started);
      wait.nextPost = Date.now() + 60000;
      status.textContent = 'Preparing latest Anny English preview · up to 600 characters, up to 20 minutes.';
      const job = await api('/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, voiceId: 'anny_en' }) }, version);
      if (!active(version)) return;
      if (!validJob(job) || job.messageId !== messageId) { fail('Anny returned a mismatched preview. Text is saved.', version); return; }
      clearTimeout(watchdog);
      storage(handleKey, { id: job.id, messageId: job.messageId, voiceId: job.voiceId, backendId: job.backendId, deadlineAt: job.deadlineAt });
      jobWatchStarted = now();
      return poll(job, version, true);
    } catch (error) {
      if (!active(version)) return;
      // Only this structured rejection proves no job/provider work was accepted.
      // A read-only hint can race another tab/process; allow one spaced reattempt.
      if (error.occupied && wait.posts < 2) { later(); return; }
      fail(`${error.message} No further automatic attempt will be made.`, version);
    }
  }
  function speak(text, manual = false, messageId = '') {
    if (disposed || document.hidden || !eligible(manual)) return;
    if (!manual && (mode.value === 'off' || !enabled.checked)) return;
    manualPlayback = manual;
    if (mode.value === 'anny_en' && manual && audio && audioMessage === messageId && currentJob) {
      const version = ++generation, expected = currentJob;
      clearTimeout(watchdog); clearTimeout(pollTimer); request?.abort(); audio.pause();
      activity('preparing'); status.textContent = 'Checking Anny playback permission…';
      api(`/speech/${encodeURIComponent(expected.id)}`, {}, version).then(result => {
        if (!active(version)) return;
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
    timings = {}; serverTimings = {};
    if (mode.value === 'off') { status.textContent = 'Voice is off. Choose a voice in Settings to use Replay.'; return; }
    if (disposed || !text) return;
    const version = generation;
    if (mode.value === 'anny_en') {
      if (!/^[a-f\d]{24}$/i.test(messageId)) { status.textContent = 'Select a saved assistant reply for Anny.'; return; }
      activity('preparing'); status.textContent = 'Preparing Anny English preview · up to 600 characters, up to 20 minutes. You can keep typing.';
      const until = Date.now() + 20 * 60 * 1000;
      watchdog = setTimeout(() => fail('Waiting for voice capacity ended after 20 minutes. Text is saved; use Replay to try later.', version), 20 * 60 * 1000);
      admit(messageId, version, { until, started: now(), checks: 0, posts: 0, nextPost: 0 });
      return;
    }
    if (!synth || !window.SpeechSynthesisUtterance) { status.textContent = 'Browser speech is unavailable. Text chat works normally.'; return; }
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 3000));
    currentUtterance = utterance;
    utterance.voice = voices.find(voice => voice.voiceURI === select.value) || null;
    if (utterance.voice) utterance.lang = utterance.voice.lang;
    activity('preparing'); status.textContent = 'Starting browser voice… If silent, press Replay.';
    utterance.onstart = () => { if (active(version)) { activity('playing'); status.textContent = 'Speaking…'; } };
    utterance.onpause = () => { if (active(version)) { activity('idle'); status.textContent = 'Browser voice paused.'; } };
    utterance.onresume = () => { if (active(version)) { activity('playing'); status.textContent = 'Speaking…'; } };
    utterance.onend = () => { if (active(version)) { generation += 1; currentUtterance = null; clearTimeout(watchdog); activity('idle'); status.textContent = text.length > 3000 ? 'Played the first 3,000 characters. Full reply is in history.' : 'Playback finished.'; } };
    utterance.onerror = () => fail('Voice was unavailable or blocked. Press Replay or keep reading.', version);
    watchdog = setTimeout(() => fail('Browser playback stopped after three minutes.', version), 180000);
    try { synth.speak(utterance); } catch (_) { fail('Browser voice was blocked. Press Replay.', version); }
  }
  function resume() {
    if (mode.value !== 'anny_en' || disposed || document.hidden || !eligible(false) || latestMessage === null) return;
    manualPlayback = false;
    try {
      const job = JSON.parse(sessionStorage.getItem(handleKey) || 'null');
      if (!job) return;
      if (!validJob({ ...job, status: 'preparing' })) { stop(); status.textContent = 'Saved Anny preview does not match the latest reply or backend. Use Replay.'; return; }
      stop({ preserve: true }); timings = {}; serverTimings = {};
      jobWatchStarted = now(); poll(job, generation, false);
    } catch (_) { /* A lost handle never regenerates audio. */ }
  }
  if (synth && window.SpeechSynthesisUtterance) { populate(); synth.addEventListener('voiceschanged', populate); }
  else select.disabled = true;
  enabled.addEventListener('change', () => { save(); if (!enabled.checked) stop(); });
  mode.addEventListener('change', () => { stop(); save(); });
  select.addEventListener('change', () => { preferred = select.value; save(); stop(); });
  window.addEventListener('pagehide', () => { disposed = true; stop({ preserve: true }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop({ preserve: true }); });
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; } });
  window.MiienVoice = { speak, stop, resume,
    setEligibility(check) { eligible = check; },
    setLatestMessage(id) {
      const changed = latestMessage !== null && latestMessage !== id;
      latestMessage = id;
      if (changed && (phase !== 'idle' || request || currentJob || audio || currentUtterance)) {
        stop(); status.textContent = 'Voice belongs to an earlier reply. Use Replay for the latest reply.';
      }
    },
    get phase() { return phase; },
    get diagnostics() { return { browser: { ...timings }, server: { ...serverTimings } }; },
  };
  // History initialization never calls speak(); restored jobs only expose status.
  // The room validates fresh history before calling resume().
})();
