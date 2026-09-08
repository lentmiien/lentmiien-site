(() => {
  'use strict';
  const enabled = document.getElementById('speech-enabled');
  const select = document.getElementById('speech-voice');
  const status = document.getElementById('speech-status');
  const synth = window.speechSynthesis;
  let generation = 0;
  let watchdog;
  let voices = [];
  let preferred = '';
  try {
    const saved = JSON.parse(sessionStorage.getItem('miienVoice') || '{}');
    enabled.checked = saved.enabled === true;
    preferred = typeof saved.voice === 'string' ? saved.voice : '';
  } catch (_) { /* Voice preferences are optional when storage is unavailable. */ }
  const save = () => {
    try { sessionStorage.setItem('miienVoice', JSON.stringify({ enabled: enabled.checked, voice: select.value })); } catch (_) { /* Optional preference only. */ }
  };
  function stop() {
    generation += 1;
    clearTimeout(watchdog);
    if (synth) synth.cancel();
    status.textContent = synth ? 'Playback stopped. Replay is available.' : 'Browser speech is unavailable. Read replies in the transcript.';
  }
  function populate() {
    const previous = select.value || preferred;
    voices = synth.getVoices();
    select.replaceChildren(new Option('Browser default', ''));
    voices.forEach(voice => select.add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · device' : ' · online'}`, voice.voiceURI)));
    if (voices.some(voice => voice.voiceURI === previous)) select.value = previous;
  }
  function speak(text, manual = false) {
    stop();
    if (!synth || (!manual && !enabled.checked) || !text) return;
    const current = generation;
    // Keep playback finite. The full reply always remains readable in history.
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 3000));
    utterance.voice = voices.find(voice => voice.voiceURI === select.value) || null;
    if (utterance.voice) utterance.lang = utterance.voice.lang;
    status.textContent = 'Starting browser voice… If silent, press Replay.';
    utterance.onstart = () => { if (current === generation) status.textContent = 'Speaking…'; };
    utterance.onend = () => { if (current === generation) { clearTimeout(watchdog); status.textContent = text.length > 3000 ? 'Played the first 3,000 characters. Full reply is in history.' : 'Playback finished.'; } };
    utterance.onerror = () => { if (current === generation) { clearTimeout(watchdog); status.textContent = 'Voice was unavailable or blocked. Press Replay or keep reading.'; } };
    watchdog = setTimeout(() => { if (current === generation) stop(); }, 180000);
    try { synth.speak(utterance); } catch (_) { stop(); }
  }
  if (!synth || !window.SpeechSynthesisUtterance) {
    enabled.checked = false;
    enabled.disabled = true;
    select.disabled = true;
    status.textContent = 'Browser speech is unavailable. Text chat works normally.';
  } else {
    populate();
    synth.addEventListener('voiceschanged', populate);
  }
  enabled.addEventListener('change', () => { save(); if (!enabled.checked) stop(); });
  select.addEventListener('change', () => { preferred = select.value; save(); stop(); });
  window.addEventListener('pagehide', stop);
  window.MiienVoice = { speak, stop };
})();
