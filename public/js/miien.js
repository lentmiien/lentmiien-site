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
  let spokenAssistant = '';
  let latestText = '';
  let lastSubmission = null;
  let sendError = '';
  let transcriptSignature = '';
  let autoMood = 'neutral';
  let artVersion = 0;
  let audioVersion = 0;
  let recording = null;
  let gettingMic = false;
  let transcribing = false;
  let asrController = null;
  let pollController = null;
  const images = new Map();
  ['neutral', 'happy', 'thoughtful', 'concerned', 'surprised'].forEach(mood => {
    const image = new Image();
    image.src = `/i/miien/${mood}.webp`;
    images.set(mood, image);
  });
  const chatStatus = text => { byId('chat-status').textContent = text; };
  const micStatus = text => { byId('mic-status').textContent = text; };
  function controls() {
    byId('send').disabled = !canWrite || sending || pending || !initialized;
    mic.disabled = mic.dataset.allowed !== 'true' || disposed || gettingMic || transcribing || sending || pending;
    mic.textContent = recording ? 'Stop & transcribe' : gettingMic ? 'Requesting microphone…' : transcribing ? 'Transcribing…' : 'Microphone';
    byId('presence').textContent = pending || sending ? 'Thinking…' : 'Ready to talk';
  }
  async function api(path, options = {}) {
    const response = await fetch(base + path, { credentials: 'same-origin', ...options,
      headers: { Accept: 'application/json', 'X-CSRF-Token': room.dataset.csrf, ...options.headers } });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('Session or service unavailable. Reload this page to reconnect.'); }
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }
  async function mood() {
    const version = ++artVersion;
    const requested = byId('mood-override').value;
    const selected = requested === 'auto' ? autoMood : requested;
    const image = images.get(selected) || images.get('neutral');
    try {
      await image.decode();
      if (version !== artVersion || disposed) return;
      byId('character').src = image.src;
      byId('character').hidden = false;
      byId('character').alt = `Miien with a ${selected} expression`;
      byId('mood-label').textContent = `Expression: ${selected}${requested === 'auto' ? '' : ' · preview'}`;
      byId('art-status').textContent = '';
    } catch (_) {
      if (version === artVersion) byId('art-status').textContent = 'Expression image unavailable; keeping the current portrait.';
    }
  }
  byId('character').addEventListener('error', () => { byId('character').hidden = true; });
  function render(data) {
    if (data.pending && !pending) stopAudio();
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
    const history = byId('history');
    // Preserve scroll position when revisiting older messages.
    const scroller = history.parentElement;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const signature = JSON.stringify(data.messages);
    if (signature !== transcriptSignature) {
      history.replaceChildren(fragment);
      transcriptSignature = signature;
    }
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    const assistant = [...data.messages].reverse().find(row => row.role === 'assistant');
    if (assistant) {
      latestText = assistant.text;
      byId('latest-reply').textContent = latestText;
      autoMood = assistant.mood;
      mood();
      if (initialized && spokenAssistant !== assistant.id && !data.pending && !document.hidden) voice?.speak(latestText);
      if (!initialized || !data.pending) spokenAssistant = assistant.id;
    }
    if (initialized && pending && !data.pending && data.messages[data.messages.length - 1]?.role !== 'assistant') chatStatus('The response finished without text. Review Chat5 or send another message.');
    else if (sendError) chatStatus(sendError);
    else chatStatus(data.pending ? 'Waiting for the saved Chat5 response… You can leave and resume later.' : 'Conversation saved. Ready when you are.');
    pending = data.pending;
    initialized = true;
    controls();
  }
  async function poll() {
    if (disposed || polling || sending) return;
    polling = true;
    pollController = new AbortController();
    const timeout = setTimeout(() => pollController?.abort(), 15000);
    try { const data = await api('/state', { signal: pollController.signal }); if (!disposed && !sending) render(data); }
    catch (error) { if (!disposed && !sending) { stopAudio(); chatStatus(`Could not refresh history. ${error.message}`); } }
    finally { clearTimeout(timeout); polling = false; if (!disposed) pollTimer = setTimeout(poll, pending ? 2500 : 12000); }
  }
  function stopAudio() {
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
    voice?.stop();
    micStatus('Audio stopped. Your typed message is unchanged.');
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
    if (recording) {
      if (recording.recorder.state !== 'inactive') recording.recorder.stop();
      return;
    }
    if (mic.disabled) return;
    stopAudio();
    const version = audioVersion;
    gettingMic = true;
    controls();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== audioVersion || disposed) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream);
      const current = { stream, recorder, chunks: [], bytes: 0, timer: null };
      recording = current;
      recorder.ondataavailable = event => {
        if (version !== audioVersion) return;
        current.bytes += event.data.size;
        if (current.bytes > 4 * 1024 * 1024) { stopAudio(); micStatus('Recording exceeded the audio limit. Please try a shorter message.'); return; }
        current.chunks.push(event.data);
      };
      recorder.onerror = () => { stopAudio(); micStatus('Recording failed. Please type your message.'); };
      recorder.onstop = async () => {
        clearTimeout(current.timer);
        stream.getTracks().forEach(track => track.stop());
        if (version !== audioVersion || disposed) return;
        recording = null;
        transcribing = true;
        controls();
        micStatus('Transcribing… You can keep editing your message.');
        const originalDraft = message.value;
        try {
          const blob = await wav(new Blob(current.chunks, { type: recorder.mimeType }));
          current.chunks.length = 0;
          if (version !== audioVersion || disposed) return;
          asrController = new AbortController();
          const timeout = setTimeout(() => asrController?.abort(), 65000);
          let result;
          try { result = await api('/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob, signal: asrController.signal }); }
          finally { clearTimeout(timeout); }
          if (version !== audioVersion || disposed) return;
          // Never overwrite edits made while transcription was pending.
          const next = [message.value.trim(), result.text].filter(Boolean).join('\n');
          if (next.length > 4000) { micStatus('Transcript would exceed 4,000 characters. Shorten the draft and record again.'); return; }
          message.value = next;
          micStatus(message.value === originalDraft ? 'No new speech recognized.' : 'Transcript added. Review and edit it, then press Send.');
          message.focus();
        } catch (error) { if (version === audioVersion && !disposed) micStatus(`Voice input failed. ${error.message} You can still type.`); }
        finally { current.chunks.length = 0; if (version === audioVersion) { transcribing = false; controls(); } }
      };
      recorder.start(250);
      current.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 59000);
      micStatus('Recording… Press Stop & transcribe when finished (60 seconds maximum).');
    } catch (_) { stream?.getTracks().forEach(track => track.stop()); if (version === audioVersion) micStatus('Microphone permission or recording unavailable. Check browser permissions, or type instead.'); }
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
    if (sending || pending || !initialized || !canWrite || !message.value.trim()) return;
    const text = message.value.trim();
    if (!lastSubmission || lastSubmission.text !== text) lastSubmission = { text, requestId: newRequestId() };
    stopAudio();
    sending = true;
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
  byId('stop').addEventListener('click', stopAudio);
  byId('replay').addEventListener('click', () => { stopAudio(); voice?.speak(latestText, true); });
  byId('mood-override').addEventListener('change', mood);
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext) {
    mic.dataset.allowed = 'false';
    micStatus('Microphone input requires a supported browser over HTTPS. Text input is ready.');
  }
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(pollTimer); pollController?.abort(); stopAudio(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; poll(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
  controls();
  poll();
})();
