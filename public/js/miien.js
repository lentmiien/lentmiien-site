(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const room = byId('miien-room');
  if (!room) return;
  const base = `/chat5/miien/${encodeURIComponent(room.dataset.id)}`;
  const message = byId('message');
  const mic = byId('mic');
  const voice = window.MiienVoice;
  const canWrite = !message.disabled;
  let disposed = false;
  let pending = false;
  let sending = false;
  let initialized = false;
  let polling = false;
  let pollTimer;
  let pollEpoch = 0;
  let resumeAfterHistory = true;
  const seenAssistants = new Set();
  let latestText = '';
  let latestId = '';
  let suppressAutoVoice = false;
  let activityState = 'idle';
  let lastSubmission = null;
  let sendError = '';
  let transcriptSignature = '';
  let autoMood = 'neutral';
  let audioVersion = 0;
  let recording = null;
  let gettingMic = false;
  let transcribing = false;
  let reviewTranscript = false;
  let asrController = null;
  let pollController = null;
  const moods = window.MiienMotion.moods;
  const motion = window.MiienMotion.create({ document, still: byId('character'), status: byId('art-status'), Image,
    connection: navigator.connection, mediaQuery: window.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: false } });
  const activity = window.MiienActivity.create(({ state, status }) => {
    activityState = state;
    room.querySelector('.stage').dataset.activity = state;
    if (byId('presence').textContent !== status) byId('presence').textContent = status;
    const requested = byId('mood-override').value;
    motion.show(requested === 'auto' ? autoMood : requested, state);
  });
  window.addEventListener('miien:voice', event => activity.update({ voice: event.detail?.phase }));
  window.addEventListener('miien:mouth', event => { if (!disposed) motion.mouth(event.detail?.shape); });
  activity.update({ voice: voice?.phase || 'idle' });
  const manifestController = new AbortController();
  const manifestTimeout = setTimeout(() => manifestController.abort(), 10000);
  fetch('/i/miien/motion-v1.json', { signal: manifestController.signal }).then(async response => {
    if (!response.ok) throw new Error('Manifest unavailable');
    const text = await response.text();
    if (text.length > 32768) throw new Error('Manifest too large');
    const manifest = window.MiienMotion.validate(JSON.parse(text));
    if (!manifest) throw new Error('Invalid manifest');
    if (!disposed) await motion.setManifest(manifest);
  }).catch(() => { if (!disposed) byId('art-status').textContent = 'Motion manifest unavailable; expression portraits remain available.'; })
    .finally(() => clearTimeout(manifestTimeout));
  const chatStatus = text => { byId('chat-status').textContent = text; };
  const micStatus = text => { byId('mic-status').textContent = text; byId('mic-status').classList.add('active-status'); };
  // This live guard is also consulted by the voice adapter's delayed callbacks.
  function audioEligible(manual = false) {
    return initialized && !resumeAfterHistory && !disposed && !document.hidden && !sending && !pending
      && !gettingMic && !recording && !transcribing && (manual || !suppressAutoVoice);
  }
  voice?.setEligibility?.(audioEligible);
  function controls() {
    byId('send').disabled = !canWrite || disposed || document.hidden || sending || pending || !initialized;
    byId('replay').disabled = !audioEligible(true) || !latestText;
    mic.disabled = mic.dataset.allowed !== 'true' || !initialized || disposed || document.hidden || gettingMic || transcribing || sending || pending;
    mic.textContent = recording ? 'Stop & transcribe' : gettingMic ? 'Requesting microphone…' : transcribing ? 'Transcribing…' : 'Microphone';
    activity.update({ permission: gettingMic, recording: recording?.recorder.state === 'recording',
      asr: transcribing, chat: pending || sending, review: reviewTranscript && !!message.value.trim() });
  }
  async function api(path, options = {}) {
    const response = await fetch(base + path, { credentials: 'same-origin', ...options,
      headers: { Accept: 'application/json', 'X-CSRF-Token': room.dataset.csrf, ...options.headers } });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('Session or service unavailable. Reload this page to reconnect.'); }
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }
  function mood() {
    const requested = byId('mood-override').value;
    const candidate = requested === 'auto' ? autoMood : requested;
    const selected = moods.includes(candidate) ? candidate : 'neutral';
    byId('mood-label').textContent = `Expression: ${selected}${requested === 'auto' ? '' : ' · preview'}`;
    return motion.show(selected, activityState);
  }
  byId('character').addEventListener('error', () => { byId('character').hidden = true; });
  function render(data) {
    if (data.pending && !pending) stopAudio();
    const wasPending = pending;
    pending = data.pending;
    const signature = JSON.stringify(data.messages);
    const history = byId('history');
    if (signature !== transcriptSignature) {
      const fragment = document.createDocumentFragment();
      data.messages.forEach(row => {
        const article = document.createElement('article');
        article.className = `message ${row.role === 'assistant' ? 'assistant' : 'user'}`;
        const label = document.createElement('strong');
        label.textContent = row.role === 'assistant' ? 'Miien' : 'You';
        const content = document.createElement('p');
        content.textContent = row.text;
        article.append(label, content);
        fragment.append(article);
      });
      // Preserve scroll position when revisiting older messages.
      const scroller = history.parentElement;
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      history.replaceChildren(fragment);
      transcriptSignature = signature;
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    }
    const assistant = [...data.messages].reverse().find(row => row.role === 'assistant');
    if (assistant) {
      latestText = assistant.text;
      latestId = assistant.id;
      voice?.setLatestMessage?.(latestId);
      if (byId('latest-reply').textContent !== latestText) byId('latest-reply').textContent = latestText;
      const nextMood = moods.includes(assistant.mood) ? assistant.mood : 'neutral';
      if (!initialized || nextMood !== autoMood) { autoMood = nextMood; mood(); }
      if (audioEligible() && !resumeAfterHistory && !seenAssistants.has(assistant.id)
        && data.messages.at(-1)?.id === assistant.id) voice?.speak(latestText, false, latestId);
    } else {
      latestText = '';
      latestId = '';
      voice?.setLatestMessage?.('');
      byId('latest-reply').textContent = 'Say hello. I’m ready when you are.';
      if (autoMood !== 'neutral') { autoMood = 'neutral'; mood(); }
    }
    // Mark all loaded history as seen; pending new replies remain eligible until final.
    if (!initialized || resumeAfterHistory || !data.pending) data.messages.forEach(row => {
      if (row.role === 'assistant') seenAssistants.add(row.id);
    });
    if (initialized && wasPending && !data.pending && data.messages[data.messages.length - 1]?.role !== 'assistant') chatStatus('The response finished without text. Review Chat5 or send another message.');
    else if (sendError) chatStatus(sendError);
    else chatStatus(data.pending ? 'Waiting for the saved Chat5 response… You can leave and resume later.' : 'Conversation saved. Ready when you are.');
    initialized = true;
    controls();
  }
  async function poll() {
    if (disposed || document.hidden || polling || sending) return;
    polling = true;
    const epoch = pollEpoch;
    const controller = new AbortController();
    pollController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const data = await api('/state', { signal: controller.signal });
      if (!disposed && !document.hidden && !sending && epoch === pollEpoch) {
        render(data);
        if (resumeAfterHistory) { resumeAfterHistory = false; controls(); if (audioEligible()) voice?.resume(); }
      }
    }
    catch (error) { if (!disposed && !document.hidden && !sending && epoch === pollEpoch) { stopAudio(); chatStatus(`Could not refresh history. ${error.message}`); } }
    finally { clearTimeout(timeout); polling = false; if (!disposed && !document.hidden) pollTimer = setTimeout(poll, epoch !== pollEpoch ? 0 : pending ? 2500 : 12000); }
  }
  function stopAudio({ preserveVoice = false, keepVoice = false } = {}) {
    audioVersion += 1;
    gettingMic = false;
    transcribing = false;
    asrController?.abort();
    asrController = null;
    if (recording) {
      const current = recording;
      recording = null;
      clearTimeout(current.timer);
      current.stream.getTracks().forEach(track => track.stop());
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      current.chunks.length = 0;
    }
    if (!keepVoice) voice?.stop({ preserve: preserveVoice });
    micStatus('Local audio stopped. Draft and saved text are kept; accepted transcription, voice or reply work may continue.');
    controls();
  }
  async function wav(blob) {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (decoded.duration > 60.5 || decoded.duration <= 0) throw new Error('Recording is too long. Use up to 60 seconds.');
      const samples = Math.min(960000, Math.floor(decoded.duration * 16000));
      const offline = new OfflineAudioContext(1, samples, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const mono = (await offline.startRendering()).getChannelData(0);
      const buffer = new ArrayBuffer(44 + mono.length * 2);
      const view = new DataView(buffer);
      const ascii = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVEfmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      ascii(36, 'data'); view.setUint32(40, mono.length * 2, true);
      mono.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
      return new Blob([buffer], { type: 'audio/wav' });
    } finally { await context.close(); }
  }
  async function startMic() {
    if (mic.dataset.allowed !== 'true' || !initialized || disposed || document.hidden
      || gettingMic || transcribing || sending || pending) return;
    if (recording) {
      if (recording.recorder.state !== 'inactive') recording.recorder.stop();
      return;
    }
    // Do not let an unseen reply or an accepted voice job regain autoplay after capture.
    suppressAutoVoice = true;
    stopAudio();
    const version = audioVersion;
    gettingMic = true;
    controls();
    micStatus('Requesting microphone… You can cancel with Stop audio.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== audioVersion || disposed || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream);
      const current = { stream, recorder, chunks: [], bytes: 0, timer: null };
      recording = current;
      gettingMic = false;
      recorder.ondataavailable = event => {
        if (version !== audioVersion) return;
        current.bytes += event.data.size;
        if (current.bytes > 4 * 1024 * 1024) { stopAudio(); micStatus('Recording exceeded the audio limit. Please try a shorter message.'); return; }
        current.chunks.push(event.data);
      };
      recorder.onstart = () => { if (version === audioVersion) controls(); };
      recorder.onerror = () => { if (version === audioVersion && !disposed) { stopAudio(); micStatus('Recording failed. Please type your message.'); } };
      recorder.onstop = async () => {
        clearTimeout(current.timer);
        stream.getTracks().forEach(track => track.stop());
        if (version !== audioVersion || disposed) return;
        recording = null;
        transcribing = true;
        controls();
        micStatus('Transcribing… You can keep editing your message.');
        try {
          const blob = await wav(new Blob(current.chunks, { type: recorder.mimeType }));
          current.chunks.length = 0;
          if (version !== audioVersion || disposed) return;
          const controller = new AbortController();
          asrController = controller;
          const timeout = setTimeout(() => controller.abort(), 65000);
          let result;
          try { result = await api('/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob, signal: controller.signal }); }
          finally { clearTimeout(timeout); if (asrController === controller) asrController = null; }
          if (version !== audioVersion || disposed) return;
          if (typeof result.text !== 'string') throw new Error('No valid transcript returned.');
          if (!result.text.trim()) { micStatus('No new speech recognized. Your draft is unchanged.'); return; }
          // Never overwrite edits made while transcription was pending.
          const next = [message.value, result.text.trim()].filter(Boolean).join('\n');
          if (next.length > 4000) { micStatus('Transcript would exceed 4,000 characters. Shorten the draft and record again.'); return; }
          message.value = next;
          reviewTranscript = true;
          micStatus('Transcript added. Review and edit it, then press Send.');
          message.focus();
        } catch (error) { if (version === audioVersion && !disposed) micStatus(`Voice input failed. ${error.message} You can still type.`); }
        finally { current.chunks.length = 0; if (version === audioVersion) { transcribing = false; controls(); } }
      };
      recorder.start(250);
      current.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 59000);
      micStatus('Recording… Press Stop & transcribe when finished (60 seconds maximum).');
    } catch (_) { stream?.getTracks().forEach(track => track.stop()); if (version === audioVersion) recording = null; if (version === audioVersion) micStatus('Microphone permission or recording unavailable. Check browser permissions, or type instead.'); }
    finally { if (version === audioVersion) { gettingMic = false; controls(); } }
  }
  function newRequestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // getRandomValues also works where HTTP disables randomUUID and microphone APIs.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  byId('message-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (disposed || document.hidden || sending || pending || !initialized || !canWrite || !message.value.trim()) return;
    const text = message.value.trim();
    if (!lastSubmission || lastSubmission.text !== text) lastSubmission = { text, requestId: newRequestId() };
    stopAudio();
    suppressAutoVoice = false;
    reviewTranscript = false;
    sending = true;
    pollEpoch += 1;
    sendError = '';
    controls();
    clearTimeout(pollTimer);
    pollController?.abort();
    chatStatus('Saving your message…');
    try {
      await api('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastSubmission) });
      if (disposed) return;
      if (message.value.trim() === text) message.value = '';
      lastSubmission = null;
      pending = true;
    } catch (error) { if (!disposed) {
      sendError = `${error.message} Your draft is kept; check history before sending again.`;
      chatStatus(sendError);
    } }
    finally { sending = false; controls(); if (!disposed) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, 1500); } }
  });
  message.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); byId('message-form').requestSubmit(); } });
  mic.addEventListener('click', startMic);
  byId('stop').addEventListener('click', () => { suppressAutoVoice = true; stopAudio(); });
  byId('replay').addEventListener('click', () => {
    if (!audioEligible(true) || !latestText) return;
    stopAudio({ keepVoice: true }); voice?.speak(latestText, true, latestId);
  });
  message.addEventListener('input', controls);
  byId('mood-override').addEventListener('change', mood);
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext) {
    mic.dataset.allowed = 'false';
    micStatus('Microphone input requires a supported browser over HTTPS. Text input is ready.');
  }
  window.addEventListener('pagehide', () => { disposed = true; pollEpoch += 1; resumeAfterHistory = true; clearTimeout(pollTimer); pollController?.abort(); manifestController.abort(); motion.suspend(true); stopAudio({ preserveVoice: true }); });
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; resumeAfterHistory = true; viewport(); poll(); } });
  document.addEventListener('visibilitychange', () => {
    pollEpoch += 1; resumeAfterHistory = true;
    clearTimeout(pollTimer); pollController?.abort(); viewport();
    if (document.hidden) stopAudio({ preserveVoice: true });
    else poll();
  });
  const captions = byId('captions-toggle');
  const motionToggle = byId('motion-enabled');
  function saveDisplay() {
    try { sessionStorage.setItem('miienDisplay', JSON.stringify({ captions: !byId('captions').hidden, motion: motionToggle.checked })); } catch (_) { /* Optional preferences. */ }
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem('miienDisplay') || '{}');
    byId('captions').hidden = saved.captions === false;
    captions.setAttribute('aria-pressed', String(!byId('captions').hidden));
    motionToggle.checked = saved.motion !== false;
    motion.enable(motionToggle.checked);
  } catch (_) { /* Safe defaults: captions on, reduced-motion respected. */ }
  captions.addEventListener('click', () => {
    byId('captions').hidden = !byId('captions').hidden;
    captions.setAttribute('aria-pressed', String(!byId('captions').hidden)); saveDisplay();
  });
  motionToggle.addEventListener('change', () => { motion.enable(motionToggle.checked); saveDisplay(); });
  const fullscreen = byId('fullscreen');
  fullscreen.hidden = !document.fullscreenEnabled || !room.requestFullscreen;
  fullscreen.addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await room.requestFullscreen(); }
    catch (_) { chatStatus('Fullscreen unavailable. The viewport room remains usable.'); }
  });
  document.addEventListener('fullscreenchange', () => { fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'; });
  const drawers = [...room.querySelectorAll('.call-tools details')];
  drawers.forEach(drawer => drawer.addEventListener('toggle', () => { if (drawer.open) drawers.forEach(other => { if (other !== drawer) other.open = false; }); }));
  room.addEventListener('keydown', event => { if (event.key === 'Escape') drawers.forEach(drawer => { if (drawer.open) { drawer.open = false; drawer.querySelector('summary').focus(); } }); });
  function viewport() {
    // visualViewport follows the virtual keyboard; CSS dvh handles browsers without it.
    const view = window.visualViewport;
    const keyboardOpen = document.activeElement === message && (view?.height || window.innerHeight) < 500;
    room.classList.toggle('keyboard-open', keyboardOpen);
    motion.suspend(disposed || document.hidden || keyboardOpen);
    if (view && view.scale === 1) {
      room.style.setProperty('--call-height', `${view.height}px`);
      room.style.setProperty('--call-top', `${view.offsetTop}px`);
    }
  }
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  message.addEventListener('focus', viewport);
  message.addEventListener('blur', viewport);
  viewport();
  controls();
  poll();
})();
