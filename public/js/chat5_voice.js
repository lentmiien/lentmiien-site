/* global io */
const VOICE_MAX_BYTES = 12 * 1024 * 1024;
const VOICE_MAX_DURATION_MS = 120000;
const DEFAULT_TTS_REFERENCE_ID = 'anny_en';
const TTS_BASE_TOKENS_PER_500 = 1024;
const TTS_MAX_TOKENS = 8192;
const TTS_LONG_PROMPT_TOKEN_THRESHOLD = 3000;
const TTS_LONG_PROMPT_BOOST = 1.2;

const socket = io();

const voiceState = {
  recorder: null,
  stream: null,
  chunks: [],
  timeout: null,
};

const state = {
  conversationId: '',
  conversationSource: '',
  displayMessages: [],
  seenMessageIds: new Set(),
  processedTts: new Set(),
  awaitingResponse: false,
  busy: false,
  ttsQueue: [],
  ttsRunning: false,
  settings: {
    title: 'NEW',
    category: 'Chat5',
    tags: ['chat5'],
    members: [],
    context: '',
    tools: [],
    model: '',
    reasoning: 'medium',
    verbosity: 'medium',
    maxMessages: 999,
    outputFormat: 'text',
  },
  chatModels: [],
};

const voiceButton = document.getElementById('voiceButton');
const voiceStatus = document.getElementById('voiceStatus');
const messageContainer = document.getElementById('voiceMessages');
const conversationIdEl = document.getElementById('id');
const conversationTitleEl = document.getElementById('conversationTitle');
const modelLabel = document.getElementById('voiceCurrentModel');
const audioPlayer = document.getElementById('voiceAudio');
const voiceReferenceSelect = document.getElementById('voiceReferenceId');

function setStatus(text) {
  if (voiceStatus) {
    voiceStatus.textContent = text || '';
  }
}

function setVoiceButton({ recording = false, busy = false } = {}) {
  if (!voiceButton) return;
  if (recording) {
    voiceButton.textContent = 'Stop & transcribe';
    voiceButton.classList.remove('btn-primary');
    voiceButton.classList.add('btn-danger');
    voiceButton.disabled = false;
    return;
  }
  voiceButton.classList.add('btn-primary');
  voiceButton.classList.remove('btn-danger');
  voiceButton.textContent = busy ? 'Working...' : 'Start speaking';
  voiceButton.disabled = !!busy;
}

function normalizeId(value) {
  if (!value) return '';
  return value.toString();
}

function parseTags(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function getSelectedReferenceId() {
  const value = voiceReferenceSelect ? voiceReferenceSelect.value : '';
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_TTS_REFERENCE_ID;
}

function isJapaneseVoice(referenceId) {
  if (!referenceId) return false;
  const normalized = referenceId.trim().toLowerCase();
  return normalized.endsWith('_jp');
}

function getTokensPer500(referenceId) {
  const base = TTS_BASE_TOKENS_PER_500;
  return isJapaneseVoice(referenceId) ? base * 2 : base;
}

function estimateTtsTokens(text, referenceId) {
  const per500 = getTokensPer500(referenceId);
  const length = typeof text === 'string' ? text.length : 0;
  let estimate = Math.round((length / 500) * per500) || per500;
  if (estimate > TTS_LONG_PROMPT_TOKEN_THRESHOLD) {
    estimate = Math.round(estimate * TTS_LONG_PROMPT_BOOST);
  }
  return Math.max(1, Math.min(TTS_MAX_TOKENS, estimate));
}

function getMessageText(msg) {
  if (!msg || !msg.content) return '';
  const { text, transcript, revisedPrompt, toolOutput } = msg.content;
  const candidates = [text, transcript, revisedPrompt, toolOutput];
  for (const entry of candidates) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return entry.trim();
    }
  }
  return '';
}

function shouldDisplayMessage(msg) {
  if (!msg) return false;
  if (msg.hideFromBot) return false;
  if (msg.contentType === 'audio') return false;
  return getMessageText(msg).length > 0;
}

function renderMessages() {
  if (!messageContainer) return;
  messageContainer.innerHTML = '';
  if (!state.displayMessages.length) {
    const p = document.createElement('p');
    p.classList.add('text-muted', 'mb-0');
    p.textContent = 'No visible messages yet.';
    messageContainer.appendChild(p);
    return;
  }
  state.displayMessages.forEach((msg) => {
    const isBot = typeof msg.user_id === 'string' && msg.user_id.toUpperCase() === 'BOT';
    const wrapper = document.createElement('div');
    wrapper.classList.add('voice-message');
    wrapper.classList.add(isBot ? 'voice-message--bot' : 'voice-message--user');
    if (msg._id) {
      wrapper.dataset.id = msg._id.toString();
    }
    const role = document.createElement('span');
    role.classList.add('voice-message__role');
    role.textContent = isBot ? 'Bot' : (msg.user_id || 'User');
    const text = document.createElement('p');
    text.classList.add('voice-message__text');
    text.textContent = getMessageText(msg);
    wrapper.append(role, text);
    messageContainer.appendChild(wrapper);
  });
}

function upsertDisplayMessage(msg) {
  const msgId = normalizeId(msg?._id);
  if (!shouldDisplayMessage(msg)) {
    if (msgId) removeMessageFromDisplay(msgId);
    return;
  }
  const existingIndex = state.displayMessages.findIndex((m) => normalizeId(m._id) === msgId);
  if (existingIndex >= 0) {
    state.displayMessages[existingIndex] = msg;
  } else {
    state.displayMessages.push(msg);
  }
  state.displayMessages.sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    return timeA - timeB;
  });
  while (state.displayMessages.length > 2) {
    state.displayMessages.shift();
  }
}

function removeMessageFromDisplay(messageId) {
  if (!messageId) return;
  state.displayMessages = state.displayMessages.filter((m) => normalizeId(m._id) !== messageId);
  state.seenMessageIds.delete(messageId);
}

function updateConversationId(newId) {
  const normalized = normalizeId(newId) || 'NEW';
  state.conversationId = normalized;
  if (conversationIdEl) {
    conversationIdEl.textContent = normalized;
    conversationIdEl.dataset.source = state.conversationSource || 'conversation5';
  }
  if (normalized !== 'NEW') {
    socket.emit('chat5-joinConversation', { conversationId: normalized });
  }
}

function updateModelLabel(modelName) {
  if (modelLabel) {
    modelLabel.textContent = `Current model: ${modelName || 'gpt-5.1-2025-11-13'}`;
  }
}

function setBusy(busy) {
  state.busy = busy;
  if (!voiceState.recorder) {
    setVoiceButton({ recording: false, busy });
  }
}

function buildSettingsPayload() {
  const settings = {
    ...state.settings,
  };
  settings.tags = Array.isArray(settings.tags) ? settings.tags : parseTags(settings.tags);
  settings.members = Array.isArray(settings.members) ? settings.members : [];
  return {
    title: settings.title || 'NEW',
    category: settings.category || 'Chat5',
    tags: settings.tags || ['chat5'],
    members: settings.members,
    context: settings.context || '',
    tools: Array.isArray(settings.tools) ? settings.tools : [],
    model: settings.model || '',
    reasoning: settings.reasoning || 'medium',
    verbosity: settings.verbosity || 'medium',
    maxMessages: Number.isFinite(settings.maxMessages) ? settings.maxMessages : 999,
    outputFormat: settings.outputFormat || 'text',
  };
}

function populateSettingsForm() {
  const categoryInput = document.getElementById('voiceCategory');
  const tagsInput = document.getElementById('voiceTags');
  const modelSelect = document.getElementById('voiceModel');
  const reasoningSelect = document.getElementById('voiceReasoning');
  const verbositySelect = document.getElementById('voiceVerbosity');

  if (categoryInput) {
    categoryInput.value = state.settings.category || 'Chat5';
  }
  if (tagsInput) {
    if (Array.isArray(state.settings.tags)) {
      tagsInput.value = state.settings.tags.join(', ');
    } else {
      tagsInput.value = state.settings.tags || '';
    }
  }
  if (modelSelect && state.settings.model) {
    modelSelect.value = state.settings.model;
  }
  if (reasoningSelect && state.settings.reasoning) {
    reasoningSelect.value = state.settings.reasoning;
  }
  if (verbositySelect && state.settings.verbosity) {
    verbositySelect.value = state.settings.verbosity;
  }
}

function resetRecorder() {
  if (voiceState.timeout) {
    clearTimeout(voiceState.timeout);
    voiceState.timeout = null;
  }
  if (voiceState.recorder) {
    voiceState.recorder.ondataavailable = null;
    voiceState.recorder.onstop = null;
    voiceState.recorder.onerror = null;
  }
  voiceState.recorder = null;
  voiceState.chunks = [];
  if (voiceState.stream) {
    voiceState.stream.getTracks().forEach((track) => track.stop());
    voiceState.stream = null;
  }
}

async function playAudio(src) {
  if (!audioPlayer) return;
  audioPlayer.classList.remove('d-none');
  audioPlayer.src = src;
  try {
    await audioPlayer.play();
    await new Promise((resolve, reject) => {
      const onEnded = () => {
        audioPlayer.removeEventListener('ended', onEnded);
        audioPlayer.removeEventListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        audioPlayer.removeEventListener('ended', onEnded);
        audioPlayer.removeEventListener('error', onError);
        reject(err);
      };
      audioPlayer.addEventListener('ended', onEnded);
      audioPlayer.addEventListener('error', onError);
    });
  } catch (err) {
    console.warn('Unable to play response audio', err);
  }
}

function generateTtsForMessage(msg) {
  return new Promise((resolve, reject) => {
    const prompt = getMessageText(msg);
    if (!prompt) {
      resolve();
      return;
    }
    const referenceId = getSelectedReferenceId();
    const maxNewTokens = estimateTtsTokens(prompt, referenceId);
    setStatus('Generating audio response...');
    socket.emit('chat5-tts', {
      conversation_id: state.conversationId || 'NEW',
      prompt,
      referenceId,
      maxNewTokens,
      settings: buildSettingsPayload(),
    }, async (resp) => {
      if (!resp || resp.ok !== true) {
        reject(new Error((resp && resp.message) ? resp.message : 'Unable to generate TTS audio.'));
        return;
      }
      setStatus('Playing response...');
      await playAudio(`/mp3/${resp.fileName}`);
      resolve();
    });
  });
}

function processTtsQueue() {
  if (state.ttsRunning) return;
  const next = state.ttsQueue.shift();
  if (!next) {
    state.awaitingResponse = false;
    setBusy(false);
    setStatus('Ready for voice input.');
    return;
  }
  state.ttsRunning = true;
  generateTtsForMessage(next)
    .catch((err) => {
      console.error(err);
      alert(err.message || 'Unable to generate audio.');
    })
    .finally(() => {
      state.ttsRunning = false;
      if (state.ttsQueue.length > 0) {
        processTtsQueue();
      } else {
        state.awaitingResponse = false;
        setBusy(false);
        setStatus('Ready for voice input.');
      }
    });
}

function queueTts(msg) {
  const msgId = normalizeId(msg?._id);
  if (!msgId || state.processedTts.has(msgId)) return;
  const isBot = typeof msg.user_id === 'string' && msg.user_id.toUpperCase() === 'BOT';
  if (!isBot) return;
  if (msg.hideFromBot) return;
  if (msg.contentType !== 'text') return;
  if (!getMessageText(msg)) return;
  state.processedTts.add(msgId);
  state.ttsQueue.push(msg);
  setBusy(true);
  processTtsQueue();
}

function handleMessages(payload = {}) {
  const { id, messages = [], placeholderId } = payload;
  if (id && id !== state.conversationId) {
    if (state.conversationId === 'NEW') {
      state.conversationSource = 'conversation5';
    }
    updateConversationId(id);
  }
  if (placeholderId) {
    removeMessageFromDisplay(placeholderId);
  }
  const newBotMessages = [];
  let receivedVisibleBot = false;
  messages.forEach((msg) => {
    const msgId = normalizeId(msg?._id);
    if (msgId) {
      state.seenMessageIds.add(msgId);
    }
    upsertDisplayMessage(msg);
    if (!msgId || state.processedTts.has(msgId)) return;
    const isBot = typeof msg.user_id === 'string' && msg.user_id.toUpperCase() === 'BOT';
    if (isBot && !msg.hideFromBot) {
      receivedVisibleBot = true;
    }
    if (isBot && msg.contentType === 'text' && !msg.hideFromBot && getMessageText(msg)) {
      newBotMessages.push(msg);
    }
  });
  renderMessages();
  if (newBotMessages.length > 0) {
    newBotMessages.forEach((msg) => {
      queueTts(msg);
    });
  } else if (state.awaitingResponse && receivedVisibleBot && !state.ttsRunning) {
    state.awaitingResponse = false;
    setBusy(false);
    setStatus('Ready for voice input.');
  }
}

function handleTranscript(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    setStatus('No transcription detected. Try again.');
    setBusy(false);
    return;
  }
  state.awaitingResponse = true;
  setBusy(true);
  setStatus('Sending message and waiting for response...');
  socket.emit('chat5-append', {
    conversation_id: state.conversationId || 'NEW',
    prompt: trimmed,
    response: true,
    settings: buildSettingsPayload(),
  });
}

function sendForTranscription(buffer, mimeType) {
  if (!socket || typeof socket.emit !== 'function') {
    alert('Socket connection is not available.');
    return;
  }
  setBusy(true);
  setVoiceButton({ recording: false, busy: true });
  setStatus('Transcribing...');
  socket.emit('chat5-transcribe-audio', {
    conversation_id: state.conversationId,
    buffer,
    mimetype: mimeType || 'audio/webm',
    name: `voice_${Date.now()}.webm`,
  }, (resp) => {
    if (!resp || resp.ok !== true) {
      setBusy(false);
      setStatus('Transcription failed.');
      alert((resp && resp.message) ? resp.message : 'Unable to transcribe audio.');
      return;
    }
    handleTranscript(resp.text);
  });
}

function handleRecordingStopped() {
  const mimeType = (voiceState.recorder && voiceState.recorder.mimeType) ? voiceState.recorder.mimeType : 'audio/webm';
  const chunks = voiceState.chunks ? [...voiceState.chunks] : [];
  resetRecorder();
  if (!chunks.length) {
    setBusy(false);
    setVoiceButton({ recording: false, busy: false });
    setStatus('No audio captured. Try again.');
    return;
  }
  const blob = new Blob(chunks, { type: mimeType });
  if (!blob || blob.size === 0) {
    setBusy(false);
    setVoiceButton({ recording: false, busy: false });
    setStatus('No audio captured. Try again.');
    return;
  }
  if (blob.size > VOICE_MAX_BYTES) {
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    const maxMb = (VOICE_MAX_BYTES / (1024 * 1024)).toFixed(1);
    setBusy(false);
    setVoiceButton({ recording: false, busy: false });
    setStatus(`Clip too large (${sizeMb}MB). Max ${maxMb}MB.`);
    return;
  }
  blob.arrayBuffer().then((buffer) => {
    sendForTranscription(buffer, blob.type || mimeType);
  }).catch(() => {
    setBusy(false);
    setVoiceButton({ recording: false, busy: false });
    setStatus('Unable to read recording.');
  });
}

async function startRecording() {
  if (state.busy) return;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    alert('Voice input is not supported in this browser.');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    alert('Voice input is not supported in this browser.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = {};
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm')) {
      options.mimeType = 'audio/webm';
    }
    const recorder = Object.keys(options).length ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
    voiceState.stream = stream;
    voiceState.recorder = recorder;
    voiceState.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        voiceState.chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      resetRecorder();
      setBusy(false);
      setVoiceButton({ recording: false, busy: false });
      setStatus('Recording error. Try again.');
    };
    recorder.onstop = handleRecordingStopped;
    recorder.start();
    voiceState.timeout = setTimeout(() => {
      if (voiceState.recorder && voiceState.recorder.state === 'recording') {
        voiceState.recorder.stop();
      }
    }, VOICE_MAX_DURATION_MS);
    setVoiceButton({ recording: true, busy: false });
    setStatus('Recording... click to stop.');
  } catch (error) {
    console.error('Unable to start recording', error);
    resetRecorder();
    setBusy(false);
    setVoiceButton({ recording: false, busy: false });
    setStatus('Voice recording not available.');
  }
}

function stopRecording() {
  if (voiceState.recorder && voiceState.recorder.state === 'recording') {
    voiceState.recorder.stop();
  }
}

function toggleRecording() {
  if (voiceState.recorder && voiceState.recorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
}

function applyIncomingSettings(payload) {
  if (!payload) return;
  state.settings = {
    ...state.settings,
    title: payload.title || state.settings.title,
    category: payload.category || state.settings.category,
    tags: Array.isArray(payload.tags) ? payload.tags : state.settings.tags,
    members: Array.isArray(payload.members) ? payload.members : state.settings.members,
    context: payload.metadata?.contextPrompt || state.settings.context,
    model: payload.metadata?.model || state.settings.model,
    reasoning: payload.metadata?.reasoning || state.settings.reasoning,
    verbosity: payload.metadata?.verbosity || state.settings.verbosity,
    maxMessages: payload.metadata?.maxMessages || state.settings.maxMessages,
    tools: payload.metadata?.tools || state.settings.tools,
    outputFormat: payload.metadata?.outputFormat || state.settings.outputFormat,
  };
  updateModelLabel(state.settings.model);
  if (conversationTitleEl && payload.title) {
    conversationTitleEl.textContent = payload.title;
  }
  if (conversationIdEl && payload.conversationId) {
    conversationIdEl.dataset.source = 'conversation5';
  }
  populateSettingsForm();
}

function saveSettings() {
  const categoryInput = document.getElementById('voiceCategory');
  const tagsInput = document.getElementById('voiceTags');
  const modelSelect = document.getElementById('voiceModel');
  const reasoningSelect = document.getElementById('voiceReasoning');
  const verbositySelect = document.getElementById('voiceVerbosity');

  state.settings.category = categoryInput ? categoryInput.value.trim() : state.settings.category;
  state.settings.tags = parseTags(tagsInput ? tagsInput.value : state.settings.tags);
  state.settings.model = modelSelect ? modelSelect.value : state.settings.model;
  state.settings.reasoning = reasoningSelect ? reasoningSelect.value : state.settings.reasoning;
  state.settings.verbosity = verbositySelect ? verbositySelect.value : state.settings.verbosity;

  updateModelLabel(state.settings.model);

  if (state.conversationId && state.conversationId !== 'NEW') {
    socket.emit('chat5-updateConversation', {
      conversation_id: state.conversationId,
      updates: {
        category: state.settings.category,
        tags: state.settings.tags,
        model: state.settings.model,
        reasoning: state.settings.reasoning,
        verbosity: state.settings.verbosity,
      },
    }, (resp) => {
      if (!resp || resp.ok !== true) {
        alert((resp && resp.message) ? resp.message : 'Unable to update settings.');
        return;
      }
      applyIncomingSettings(resp.conversation);
      const modal = bootstrap.Modal.getInstance(document.getElementById('voiceSettingsModal'));
      if (modal) modal.hide();
    });
  } else {
    const modal = bootstrap.Modal.getInstance(document.getElementById('voiceSettingsModal'));
    if (modal) modal.hide();
    setStatus('Settings updated locally. Conversation will be created on next message.');
  }
}

function hydrateSettingsFromConversation(conv) {
  if (!conv) return;
  const meta = conv.metadata || {};
  state.settings = {
    title: conv.title || 'NEW',
    category: conv.category || 'Chat5',
    tags: Array.isArray(conv.tags) ? conv.tags : ['chat5'],
    members: Array.isArray(conv.members) ? conv.members : [],
    context: meta.contextPrompt || '',
    tools: Array.isArray(meta.tools) ? meta.tools : [],
    model: meta.model || '',
    reasoning: meta.reasoning || 'medium',
    verbosity: meta.verbosity || 'medium',
    maxMessages: Number.isFinite(meta.maxMessages) ? meta.maxMessages : 999,
    outputFormat: meta.outputFormat || 'text',
  };
  updateModelLabel(state.settings.model);
  populateSettingsForm();
}

function hydrateVoiceSelection() {
  if (!voiceReferenceSelect) return;
  const current = typeof voiceReferenceSelect.value === 'string' ? voiceReferenceSelect.value.trim() : '';
  if (!current) {
    voiceReferenceSelect.value = DEFAULT_TTS_REFERENCE_ID;
  }
}

function initFromWindow() {
  const initialConversation = window.voiceConversation || {};
  const initialMessages = Array.isArray(window.voiceInitialMessages) ? window.voiceInitialMessages : [];
  const models = Array.isArray(window.chatModels) ? window.chatModels : [];
  state.chatModels = models;
  hydrateSettingsFromConversation(initialConversation);
  state.conversationId = conversationIdEl ? conversationIdEl.textContent.trim() : '';
  state.conversationSource = conversationIdEl ? (conversationIdEl.dataset.source || '') : '';
  initialMessages.forEach((msg) => {
    const msgId = normalizeId(msg._id);
    if (msgId) {
      state.seenMessageIds.add(msgId);
      state.processedTts.add(msgId);
    }
    upsertDisplayMessage(msg);
  });
  renderMessages();
  setVoiceButton({ recording: false, busy: false });
  setStatus('Ready for voice input.');
  hydrateVoiceSelection();
}

function setupSocketEvents() {
  socket.on('welcome', () => {
    if (state.conversationId && state.conversationId !== 'NEW') {
      socket.emit('chat5-joinConversation', { conversationId: state.conversationId });
    }
  });

  socket.on('chat5-messages', handleMessages);

  socket.on('chat5-message-hidden', (payload) => {
    if (!payload || !payload.messageId) return;
    removeMessageFromDisplay(payload.messageId);
    renderMessages();
  });

  socket.on('chat5-messages-removed', (payload) => {
    if (!payload || !Array.isArray(payload.removedIds)) return;
    payload.removedIds.forEach((id) => removeMessageFromDisplay(id));
    renderMessages();
  });

  socket.on('chat5-conversation-settings-updated', (payload) => {
    if (!payload || payload.conversationId !== state.conversationId) return;
    applyIncomingSettings(payload);
  });

  socket.on('chat5-generatetitle-done', (data) => {
    if (!data || !data.title) return;
    state.settings.title = data.title;
    if (conversationTitleEl) {
      conversationTitleEl.textContent = data.title;
    }
  });
}

function bindUiEvents() {
  if (voiceButton) {
    voiceButton.addEventListener('click', toggleRecording);
  }
  const saveBtn = document.getElementById('saveVoiceSettings');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveSettings);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFromWindow();
  bindUiEvents();
  setupSocketEvents();
});
