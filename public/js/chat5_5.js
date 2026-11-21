// Create a socket connection
const socket = io();
window.socket = socket;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const VOICE_MAX_BYTES = 12 * 1024 * 1024;
const VOICE_MAX_DURATION_MS = 120000;
const DEFAULT_CHAT5_MESSAGE_BATCH_SIZE = 25;

// Setup markdown editor
const editor = new toastui.Editor({
  el: document.querySelector('#message'),
  height: 'var(--chat5-editor-height)',
  minHeight: '0px',
  autofocus: false,
  initialEditType: 'markdown',
  placeholder: 'Write a message…',
  previewStyle: 'tab',
  theme: 'dark',
});
// Make accessible to inline scripts
window.editor = editor;
const chatModels = Array.isArray(window.chatModels) ? window.chatModels : [];
const draftStorageKeys = {
  personality: 'chat5DraftPersonalityId',
  responseType: 'chat5DraftResponseTypeId',
};
const charCounterEl = document.getElementById('chat5CharCounter');
const ttsVoiceSelect = document.getElementById('ttsReferenceId');
const ttsVoiceState = {
  voices: Array.isArray(window.ttsVoices?.voices) ? window.ttsVoices.voices : [],
  defaultVoiceId: window.ttsVoices?.defaultVoiceId || '',
};
const voiceButton = document.getElementById('chat5VoiceButton');
const voiceStatus = document.getElementById('chat5VoiceStatus');
const voiceState = {
  recorder: null,
  stream: null,
  chunks: [],
  timeout: null,
  busy: false,
};
const chat5MessageWindow = {
  batchSize: DEFAULT_CHAT5_MESSAGE_BATCH_SIZE,
  initialLimit: DEFAULT_CHAT5_MESSAGE_BATCH_SIZE,
  total: 0,
  loadedStart: 0,
  loadedEnd: 0,
  hasMoreOlder: false,
  source: 'conversation5',
  loading: false,
  ...(window.chat5MessageWindow && typeof window.chat5MessageWindow === 'object' ? window.chat5MessageWindow : {}),
};
chat5MessageWindow.batchSize = Number.isFinite(Number(chat5MessageWindow.batchSize)) && Number(chat5MessageWindow.batchSize) > 0
  ? Math.floor(Number(chat5MessageWindow.batchSize))
  : DEFAULT_CHAT5_MESSAGE_BATCH_SIZE;
chat5MessageWindow.total = Number.isFinite(Number(chat5MessageWindow.total)) ? Math.max(0, Math.floor(Number(chat5MessageWindow.total))) : 0;
chat5MessageWindow.loadedStart = Number.isFinite(Number(chat5MessageWindow.loadedStart)) ? Math.max(0, Math.floor(Number(chat5MessageWindow.loadedStart))) : 0;
chat5MessageWindow.loadedEnd = Number.isFinite(Number(chat5MessageWindow.loadedEnd)) ? Math.max(chat5MessageWindow.loadedStart, Math.floor(Number(chat5MessageWindow.loadedEnd))) : chat5MessageWindow.total;
chat5MessageWindow.hasMoreOlder = chat5MessageWindow.source === 'conversation5' && chat5MessageWindow.loadedStart > 0;
window.chat5MessageWindow = chat5MessageWindow;
let chat5TrainingUsage = JSON.parse(document.getElementById('chat5TrainingEntries').dataset.usage);

function getVoiceIdValue() {
  const value = ttsVoiceSelect ? ttsVoiceSelect.value : '';
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed) return trimmed;
  return ttsVoiceState.defaultVoiceId || '';
}

function populateTtsVoiceOptions() {
  if (!ttsVoiceSelect) return;
  const current = ttsVoiceSelect.value;
  ttsVoiceSelect.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = ttsVoiceState.defaultVoiceId
    ? `Default (${ttsVoiceState.defaultVoiceId})`
    : 'Default voice';
  defaultOption.selected = !current;
  ttsVoiceSelect.appendChild(defaultOption);

  const voices = Array.isArray(ttsVoiceState.voices) ? [...ttsVoiceState.voices] : [];
  voices.sort((a, b) => {
    const langA = (a.language || '').localeCompare(b.language || '');
    if (langA !== 0) return langA;
    const nameA = (a.displayName || a.voiceId || '').toLowerCase();
    const nameB = (b.displayName || b.voiceId || '').toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });
  voices.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceId;
    const parts = [];
    if (voice.displayName) parts.push(voice.displayName);
    parts.push(voice.voiceId);
    if (voice.language) parts.push(`(${voice.language}${voice.backend ? `, ${voice.backend}` : ''})`);
    option.textContent = parts.join(' ');
    option.selected = current ? current === voice.voiceId : voice.voiceId === ttsVoiceState.defaultVoiceId;
    ttsVoiceSelect.appendChild(option);
  });
}

function refreshTtsVoiceOptions(refresh = false) {
  return new Promise((resolve) => {
    socket.emit('chat5-tts-voices', { refresh }, (resp) => {
      if (resp && resp.ok) {
        ttsVoiceState.voices = Array.isArray(resp.voices) ? resp.voices : [];
        if (resp.defaultVoiceId) {
          ttsVoiceState.defaultVoiceId = resp.defaultVoiceId;
        }
        populateTtsVoiceOptions();
        updatePromptCharCounter();
      }
      resolve(ttsVoiceState);
    });
  });
}

function updatePromptCharCounter() {
  if (!charCounterEl) return;
  const text = editor ? editor.getMarkdown() : '';
  const length = typeof text === 'string' ? text.length : 0;
  charCounterEl.textContent = `${length.toLocaleString()} chars`;
}

if (editor && typeof editor.on === 'function') {
  editor.on('change', updatePromptCharCounter);
}
populateTtsVoiceOptions();
refreshTtsVoiceOptions(true);
updatePromptCharCounter();

function loadDraftPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('Unable to load draft preference', error);
    return null;
  }
}

function saveDraftPreference(key, value) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('Unable to persist draft preference', error);
  }
}

function copyTextToClipboard(text) {
  if (!text && text !== '') {
    return Promise.resolve();
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        resolve();
      } else {
        reject(new Error('Copy command was unsuccessful'));
      }
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
}

function setCopyFeedback(el, status) {
  if (!el) return;
  if (!status) {
    delete el.dataset.copyStatus;
    return;
  }
  el.dataset.copyStatus = status;
  setTimeout(() => {
    if (el.dataset.copyStatus === status) {
      delete el.dataset.copyStatus;
    }
  }, 1500);
}

function parseJsonLikeString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const firstChar = trimmed[0];
  if (firstChar !== '{' && firstChar !== '[') return value;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
}

function buildStructuredMessagePayload(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.contentType !== 'function_call' && m.contentType !== 'function_call_output') {
    return null;
  }

  const content = m.content && typeof m.content === 'object' ? m.content : {};
  const payload = content.raw && typeof content.raw === 'object' ? { ...content.raw } : {};

  if (!payload.type) payload.type = m.contentType;
  if (!payload.call_id && (content.callId || content.toolCallId)) {
    payload.call_id = content.callId || content.toolCallId;
  }
  if (!payload.tool_call_id && !payload.id && content.toolCallId) {
    payload.tool_call_id = content.toolCallId;
  }
  if (!payload.name && content.toolName) {
    payload.name = content.toolName;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'arguments') && m.contentType === 'function_call') {
    payload.arguments = content.arguments;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'output') && m.contentType === 'function_call_output') {
    payload.output = Object.prototype.hasOwnProperty.call(content, 'output') ? content.output : content.toolOutput;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'status') && content.status) {
    payload.status = content.status;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'error') && content.error) {
    payload.error = content.error;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'result') && content.result) {
    payload.result = content.result;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'arguments')) {
    payload.arguments = parseJsonLikeString(payload.arguments);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'output')) {
    payload.output = parseJsonLikeString(payload.output);
  }

  return payload;
}

function stringifyStructuredMessagePayload(m) {
  const payload = buildStructuredMessagePayload(m);
  if (!payload) return '';
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    const content = m && typeof m === 'object' && m.content && typeof m.content === 'object' ? m.content : {};
    return JSON.stringify({
      type: m.contentType,
      call_id: content.callId || content.toolCallId || null,
      error: 'Unable to stringify message payload',
    }, null, 2);
  }
}

function resolveMessageCopySource(m) {
  if (!m || typeof m !== 'object') return '';
  const structuredPayload = stringifyStructuredMessagePayload(m);
  if (structuredPayload) {
    return structuredPayload;
  }
  const content = m.content || {};
  const sources = [
    content.text,
    content.transcript,
    content.revisedPrompt,
    content.toolOutput,
  ];
  for (const value of sources) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return '';
}

function bindMessageCopyButton(btn, providedText) {
  if (!btn || btn.dataset.copyBound === 'true') return;
  const text = typeof providedText === 'string' && providedText.length > 0
    ? providedText
    : btn.getAttribute('data-copy-text');
  if (typeof text !== 'string' || text.trim().length === 0) return;
  btn.dataset.copyText = text;
  btn.dataset.copyBound = 'true';
  btn.addEventListener('click', () => {
    copyTextToClipboard(btn.dataset.copyText)
      .then(() => setCopyFeedback(btn, 'copied'))
      .catch((err) => {
        console.warn('Unable to copy message text to clipboard', err);
        setCopyFeedback(btn, 'failed');
      });
  });
}

function initializeMessageCopyButtons(root) {
  const scope = root || document;
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const buttons = scope.querySelectorAll('.chat5-copy-button');
  if (!buttons.length) return;
  buttons.forEach((btn) => bindMessageCopyButton(btn));
}

function registerCodeCopyHandlers(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const blocks = root.querySelectorAll('pre code');
  if (!blocks.length) return;
  blocks.forEach((codeEl) => {
    const pre = codeEl.closest('pre');
    if (!pre || pre.dataset.copyBound === 'true') return;
    pre.dataset.copyBound = 'true';
    pre.addEventListener('click', () => {
      const codeText = codeEl.innerText || codeEl.textContent || '';
      if (!codeText) return;
      copyTextToClipboard(codeText)
        .then(() => setCopyFeedback(pre, 'copied'))
        .catch(() => {
          console.warn('Unable to copy code block to clipboard');
          setCopyFeedback(pre, '');
        });
    });
  });
}

function enhanceTables(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const tables = root.querySelectorAll('table');
  if (!tables.length) return;
  tables.forEach((table) => {
    if (!table.classList.contains('table')) {
      table.classList.add('table', 'table-striped', 'table-dark');
    }
    if (!table.closest('.chat5-table-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.classList.add('chat5-table-wrapper');
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
    table.dataset.tableEnhanced = 'true';
  });
}

function stringifyForDisplay(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function sanitizeDisplayHtml(value) {
  if (!window.DOMPurify || typeof window.DOMPurify.sanitize !== 'function') {
    throw new Error('HTML sanitizer is not available.');
  }
  const sanitized = window.DOMPurify.sanitize(String(value || ''), {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['form', 'button', 'input', 'select', 'textarea', 'iframe', 'object', 'embed', 'style'],
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll('img[src]').forEach((image) => {
    if (!isSafeMarkdownImageSource(image.getAttribute('src'))) {
      image.removeAttribute('src');
    }
  });
  return template.innerHTML;
}

function isSafeMarkdownImageSource(value) {
  const source = String(value || '').trim();
  // Match the private media contract verbatim, before any URL normalization.
  if (source === value && /^\/gpt-image\/media\/gpt-image-private-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/.test(source)) return true;
  if (/^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(source)) return true;
  if (!source.startsWith('/') || source.startsWith('//') || source.includes('\\')) return false;
  try {
    const parsed = new URL(source, window.location.origin);
    const normalizedPath = new URL(decodeURIComponent(parsed.pathname), window.location.origin).pathname;
    return ['/img/', '/imgen/', '/ocr/', '/ocr_tts/', '/temp/']
      .some((prefix) => normalizedPath.startsWith(prefix));
  } catch (error) {
    return false;
  }
}

function parseMarkdownSafely(value, contextLabel) {
  const source = stringifyForDisplay(value);
  if (source.trim().length === 0) return '';
  if (!window.marked || typeof window.marked.parse !== 'function') {
    throw new Error('Markdown renderer is not available.');
  }
  try {
    return sanitizeDisplayHtml(window.marked.parse(source));
  } catch (error) {
    const label = contextLabel ? ` for ${contextLabel}` : '';
    throw new Error(`Unable to render markdown${label}: ${error.message || error}`);
  }
}

function describeMessageForError(m) {
  if (!m || typeof m !== 'object') return 'message payload is missing or invalid';
  const parts = [];
  if (m._id) parts.push(`id ${m._id}`);
  if (m.contentType) parts.push(`type ${m.contentType}`);
  if (m.user_id) parts.push(`user ${m.user_id}`);
  return parts.length > 0 ? parts.join(', ') : 'message has no id, type, or user';
}

function appendMessageProblem(parent, title, details) {
  if (!parent) return;
  const wrapper = document.createElement('div');
  wrapper.classList.add('chat5-message-problem');

  const strong = document.createElement('strong');
  strong.textContent = title || 'Unable to display message.';
  wrapper.append(strong);

  if (details) {
    const detail = document.createElement('div');
    detail.classList.add('chat5-message-problem-details');
    detail.textContent = details;
    wrapper.append(detail);
  }

  parent.append(wrapper);
}

function appendRenderErrorMessage(m, error) {
  const container = document.getElementById("conversationContainer");
  if (!container) return;

  const entry = createMessageFrame(m || {});
  appendMessageProblem(entry.querySelector('.chat5-message-body'), 'Unable to render one live message.',
    `${describeMessageForError(m)}. ${error?.message || 'Unknown rendering error'}.`);
  container.append(entry);
}

function getMessageId(m) {
  return stringifyForDisplay(m && (m._id || m.id)).trim();
}

function getMessageContent(m) {
  return m && m.content && typeof m.content === 'object' ? m.content : {};
}

const workspace = document.querySelector('.chat5-workspace');
const thread = document.getElementById('chat5Thread');
const historyInput = document.getElementById('message_history');
const historyIds = historyInput.defaultValue.split(/\s+/).filter(Boolean);
let savedStartMessageId = document.getElementById('startMessageId').value.trim();

function messageEntries(messageId) {
  return document.querySelectorAll(`#conversationContainer .chat5-entry[data-id="${CSS.escape(messageId)}"]`);
}

function setStartMarker(entry, selected) {
  const button = entry.querySelector('[data-chat5-start-message-id]');
  button.textContent = selected ? 'Selected start message' : 'Set as start message';
  button.setAttribute('aria-pressed', String(selected));
  let divider = entry.querySelector('.chat5-start-divider');
  if (selected && !divider) {
    divider = document.createElement('div');
    divider.className = 'chat5-start-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', 'Start message');
    divider.textContent = 'Start message';
    entry.prepend(divider);
  } else if (!selected) {
    divider?.remove();
  }
}

function applyStartMessageIdToUI(value) {
  const next = String(value || '').trim();
  document.getElementById('startMessageId').value = next;
  if (savedStartMessageId && savedStartMessageId !== next) {
    messageEntries(savedStartMessageId).forEach(entry => setStartMarker(entry, false));
  }
  savedStartMessageId = next;
  updateMessageLoadControls();
  if (!next) return;
  const entry = messageEntries(next)[0];
  if (entry) {
    setStartMarker(entry, true);
    entry.closest('.chat5-hidden-group')?.setAttribute('open', '');
    entry.closest('.chat5-history-chunk')?.setAttribute('open', '');
  }
}

function splitInputList(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function collectChatSettings() {
  const toolSelect = document.getElementById('tools');
  const modelSelect = document.getElementById('model');
  const reasoning = document.getElementById('reasoning');
  const mode = document.getElementById('mode');
  const verbosity = document.getElementById('verbosity');
  const titleInput = document.getElementById('title');
  const categoryInput = document.getElementById('category');
  const tagsInput = document.getElementById('tags');
  const membersInput = document.getElementById('members');
  const contextInput = document.getElementById('context');
  const maxMessagesEl = document.getElementById('maxMessages');

  const toolArray = toolSelect ? Array.from(toolSelect.selectedOptions).map((option) => option.value) : [];
  const tags = splitInputList(tagsInput ? tagsInput.value : '');
  const members = splitInputList(membersInput ? membersInput.value : '');
  const maxMessagesInput = maxMessagesEl ? parseInt(maxMessagesEl.value, 10) : NaN;

  return {
    title: titleInput ? titleInput.value : '',
    category: categoryInput ? categoryInput.value : '',
    tags,
    context: contextInput ? contextInput.value : '',
    tools: toolArray,
    model: modelSelect ? modelSelect.value : '',
    reasoning: reasoning ? reasoning.value : 'medium',
    mode: mode ? mode.value : 'standard',
    verbosity: verbosity ? verbosity.value : 'medium',
    members,
    maxMessages: Number.isNaN(maxMessagesInput) || maxMessagesInput <= 0 ? 999 : maxMessagesInput,
  };
}

function setUpdateButtonState() {
  const idEl = document.getElementById('id');
  const btn = document.getElementById('updateSettingsButton');
  if (!idEl || !btn) return;
  btn.disabled = idEl.dataset.source !== 'conversation5';
  document.getElementById('chat5UpdateHistory').disabled = btn.disabled;
}

function getCurrentConversationId() {
  const idEl = document.getElementById('id');
  if (!idEl) return '';
  return idEl.textContent.trim();
}

function requireExistingConversation(actionLabel) {
  const conversationId = getCurrentConversationId();
  if (!conversationId || conversationId === 'NEW') {
    const label = typeof actionLabel === 'string' && actionLabel.length
      ? actionLabel
      : 'perform this action';
    alert(`Please open an existing conversation before trying to ${label}.`);
    return null;
  }
  return conversationId;
}

function getLoadedMessageCount() {
  return Math.max(0, (chat5MessageWindow.loadedEnd || 0) - (chat5MessageWindow.loadedStart || 0));
}

function updateMessageLoadControls() {
  chat5MessageWindow.hasMoreOlder = chat5MessageWindow.source === 'conversation5' && chat5MessageWindow.loadedStart > 0;
  const loadedCount = getLoadedMessageCount();
  const controls = document.querySelectorAll('[data-chat5-load-controls]');
  controls.forEach((control) => {
    const shouldHide = chat5MessageWindow.source !== 'conversation5'
      || (!chat5MessageWindow.hasMoreOlder && chat5MessageWindow.total <= loadedCount);
    control.classList.toggle('d-none', shouldHide);
  });

  const moreButtons = document.querySelectorAll('[data-chat5-load-more]');
  moreButtons.forEach((btn) => {
    btn.disabled = chat5MessageWindow.loading || !chat5MessageWindow.hasMoreOlder;
    btn.textContent = chat5MessageWindow.loading
      ? 'Loading...'
      : `Load ${chat5MessageWindow.batchSize || DEFAULT_CHAT5_MESSAGE_BATCH_SIZE} older`;
  });

  const allButtons = document.querySelectorAll('[data-chat5-load-all]');
  allButtons.forEach((btn) => {
    btn.disabled = chat5MessageWindow.loading || !chat5MessageWindow.hasMoreOlder;
  });

  const statusText = chat5MessageWindow.loading
    ? `Loading older messages... showing ${loadedCount} of ${chat5MessageWindow.total || loadedCount}`
    : `Showing ${loadedCount} of ${chat5MessageWindow.total || loadedCount} messages`;
  const startIndex = savedStartMessageId ? historyIds.indexOf(savedStartMessageId) : -1;
  const earlierStart = startIndex >= 0 && startIndex < chat5MessageWindow.loadedStart;
  document.querySelectorAll('[data-chat5-load-status]').forEach((status) => {
    status.textContent = earlierStart ? statusText + ' · Start message is in older history.' : statusText;
  });
}

function updateMessageWindowFromMeta(meta) {
  if (!meta || typeof meta !== 'object') return;
  const total = Number(meta.total);
  const startIndex = Number(meta.startIndex);
  const endIndex = Number(meta.endIndex);
  if (Number.isFinite(total)) {
    chat5MessageWindow.total = Math.max(0, Math.floor(total));
  }
  if (Number.isFinite(startIndex)) {
    chat5MessageWindow.loadedStart = Math.max(0, Math.floor(startIndex));
  }
  if (Number.isFinite(endIndex)) {
    chat5MessageWindow.loadedEnd = Math.max(chat5MessageWindow.loadedEnd || 0, Math.floor(endIndex));
  }
  chat5MessageWindow.hasMoreOlder = !!meta.hasMoreOlder;
}

function addHistoryId(id) {
  if (!id || historyIds.includes(id)) return false;
  historyIds.push(id);
  const current = historyInput.value.trimEnd();
  historyInput.value = current ? `${current}\n${id}` : id;
  return true;
}

function registerLiveMessageInWindow(messageId) {
  if (!messageId || chat5MessageWindow.source !== 'conversation5') return;
  chat5MessageWindow.total += 1;
  chat5MessageWindow.loadedEnd += 1;
  if (chat5MessageWindow.total < chat5MessageWindow.loadedEnd) {
    chat5MessageWindow.total = chat5MessageWindow.loadedEnd;
  }
  updateMessageLoadControls();
}

function loadOlderMessages(loadAll = false) {
  const conversationId = requireExistingConversation('load older messages');
  if (!conversationId || chat5MessageWindow.loading || !chat5MessageWindow.hasMoreOlder) return;

  chat5MessageWindow.loading = true;
  updateMessageLoadControls();
  socket.emit('chat5-load-messages', {
    conversationId,
    beforeIndex: chat5MessageWindow.loadedStart,
    limit: chat5MessageWindow.batchSize || DEFAULT_CHAT5_MESSAGE_BATCH_SIZE,
    loadAll: !!loadAll,
  }, (resp) => {
    chat5MessageWindow.loading = false;
    if (!resp || resp.ok !== true) {
      updateMessageLoadControls();
      alert(resp && resp.message ? resp.message : 'Unable to load older messages.');
      return;
    }
    const messages = Array.isArray(resp.messages) ? resp.messages : [];
    const startIndex = resp.meta && Number.isFinite(Number(resp.meta.startIndex))
      ? Math.max(0, Math.floor(Number(resp.meta.startIndex)))
      : 0;
    prependLoadedMessages(messages, startIndex);
    updateMessageWindowFromMeta(resp.meta);
    updateMessageLoadControls();
  });
}

function bindMessageLoadControls() {
  document.querySelectorAll('[data-chat5-load-more]').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => loadOlderMessages(false));
  });
  document.querySelectorAll('[data-chat5-load-all]').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => loadOlderMessages(true));
  });
  updateMessageLoadControls();
}

function SwitchConversation(new_id) {
  if (document.getElementById("id").textContent === new_id) return;

  if (document.getElementById("id").textContent != "NEW") {
    const conversation_id = document.getElementById("id").textContent;
    socket.emit('chat5-leaveConversation', {conversationId: conversation_id});
  }
  socket.emit('chat5-joinConversation', {conversationId: new_id});
  document.getElementById("id").textContent = new_id;
  document.getElementById('id').dataset.source = 'conversation5';
  chat5MessageWindow.source = 'conversation5';
  document.getElementById('chat5KnowledgeLink').href = `/chat4/createknowledgefromchat/${encodeURIComponent(new_id)}`;
  document.getElementById('chat5VoiceLink').href = `/chat5/voice/${encodeURIComponent(new_id)}`;
  document.querySelector('[data-chat5-export]').action = `/chat5/chat/${encodeURIComponent(new_id)}/export`;
  document.querySelectorAll('#chat5Training [name="conversation_id"]').forEach(input => { input.value = new_id; });
  document.getElementById('chat5TrainingUnavailable').hidden = true;
  document.getElementById('chat5TrainingContent').hidden = false;
  document.getElementById('chat5QuickSettings').open = false;
  document.getElementById('chat5NewSettingsNote')?.remove();
  window.history.replaceState(null, '', `/chat5/chat/${encodeURIComponent(new_id)}`);
  if (window.Chat5QuickSettings && typeof window.Chat5QuickSettings.updateConversationState === 'function') {
    window.Chat5QuickSettings.updateConversationState(document);
  }
  updateMessageLoadControls();
}

const completionWindows = ['soonest', '2h', '8h'];
document.getElementById('completionWindow')?.addEventListener('input', (event) => {
  const value = completionWindows[Number(event.target.value)] || 'soonest';
  document.getElementById('completionWindowValue').textContent = value;
  event.target.setAttribute('aria-valuetext', value);
});

document.getElementById('sendAndResponse')?.addEventListener('click', () => {
  Append(Boolean(editor.getMarkdown().trim()), true);
});
document.getElementById('chat5Append')?.addEventListener('click', () => Append(true, false));
document.getElementById('chat5AppendBot')?.addEventListener('click', () => Append(true, false, 'bot'));

function Append(send, resp, userId) {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").textContent;
  const prompt = editor.getMarkdown();
  const settings = collectChatSettings();
  const completionWindow = completionWindows[Number(document.getElementById('completionWindow')?.value)] || 'soonest';
  const notice = document.getElementById('completionWindowNotice');
  if (notice) notice.textContent = '';
  const payload = {conversation_id, prompt: send ? prompt : null, response: resp, settings, completionWindow};
  if (typeof userId === 'string' && userId.trim().length > 0) {
    payload.user_id = userId.trim();
  }
  socket.emit('chat5-append', payload, (result) => {
    hideLoadingPopup();
    if (notice && result?.ok && result.completionWindow === 'soonest' && completionWindow !== 'soonest') {
      notice.textContent = 'Request sent with “soonest”: the selected model does not support discounted completion windows.';
    }
    // Keep rejected drafts and any newer text typed while the request ran.
    if (send && (result?.ok || result?.promptSaved) && editor.getMarkdown() === prompt
      && [conversation_id, result.conversationId].includes(document.getElementById('id').textContent)) {
      editor.reset();
      updatePromptCharCounter();
    }
    if (!result?.ok) alert(result?.message || 'Unable to append message. Reload the conversation before retrying.');
  });
}

function GenerateTTS() {
  const conversation_id = document.getElementById("id").textContent;
  const prompt = editor.getMarkdown();
  if (!prompt || prompt.trim().length === 0) {
    alert('Please enter text before requesting TTS.');
    return;
  }
  const settings = collectChatSettings();
  const voiceId = getVoiceIdValue();
  showLoadingPopup();
  socket.emit('chat5-tts', { conversation_id, prompt, voiceId, settings }, (resp) => {
    hideLoadingPopup();
    if (!resp || resp.ok !== true) {
      alert(resp && resp.message ? resp.message : 'Unable to generate TTS audio.');
    }
  });
}

function setVoiceUi({ recording = false, busy = false, message } = {}) {
  voiceState.busy = busy;
  if (voiceButton) {
    voiceButton.disabled = busy;
    voiceButton.textContent = recording ? 'Stop & transcribe' : (busy ? 'Transcribing...' : 'Start voice input');
    voiceButton.classList.toggle('btn-danger', recording);
    voiceButton.classList.toggle('btn-outline-primary', !recording);
  }
  if (voiceStatus) {
    voiceStatus.textContent = message || (recording ? 'Recording... click to stop.' : 'Ready for voice input.');
  }
}

function resetVoiceState() {
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
  voiceState.busy = false;
  if (voiceState.stream) {
    voiceState.stream.getTracks().forEach((track) => track.stop());
    voiceState.stream = null;
  }
}

function appendTranscriptToEditor(text) {
  if (!editor || typeof editor.getMarkdown !== 'function' || typeof editor.setMarkdown !== 'function') return;
  const current = editor.getMarkdown();
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  const next = current ? `${current}${prefix}${text}` : text;
  editor.setMarkdown(next);
  updatePromptCharCounter();
}

async function handleVoiceRecordingStopped() {
  const mimeType = (voiceState.recorder && voiceState.recorder.mimeType) ? voiceState.recorder.mimeType : 'audio/webm';
  const chunks = voiceState.chunks ? [...voiceState.chunks] : [];
  resetVoiceState();

  if (!chunks.length) {
    setVoiceUi({ recording: false, busy: false, message: 'No audio captured. Try again.' });
    return;
  }

  const blob = new Blob(chunks, { type: mimeType });
  if (!blob || blob.size === 0) {
    setVoiceUi({ recording: false, busy: false, message: 'No audio captured. Try again.' });
    return;
  }

  if (blob.size > VOICE_MAX_BYTES) {
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    const maxMb = (VOICE_MAX_BYTES / (1024 * 1024)).toFixed(1);
    setVoiceUi({ recording: false, busy: false, message: `Clip too large (${sizeMb}MB). Max ${maxMb}MB.` });
    return;
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    sendVoiceForTranscription(arrayBuffer, blob.type || mimeType);
  } catch (error) {
    console.error('Unable to read recorded audio', error);
    setVoiceUi({ recording: false, busy: false, message: 'Unable to read recording.' });
  }
}

function sendVoiceForTranscription(buffer, mimeType) {
  if (!socket || typeof socket.emit !== 'function') {
    setVoiceUi({ recording: false, busy: false, message: 'Socket unavailable.' });
    return;
  }
  setVoiceUi({ recording: false, busy: true, message: 'Transcribing...' });
  const conversation_id = getCurrentConversationId();
  socket.emit('chat5-transcribe-audio', {
    conversation_id,
    buffer,
    mimetype: mimeType || 'audio/webm',
    name: `voice_${Date.now()}.webm`,
  }, (resp) => {
    setVoiceUi({ recording: false, busy: false, message: resp && resp.ok ? 'Transcript appended to editor.' : 'Transcription failed.' });
    if (!resp || resp.ok !== true) {
      alert(resp && resp.message ? resp.message : 'Unable to transcribe audio right now.');
      return;
    }
    const transcript = typeof resp.text === 'string' ? resp.text.trim() : '';
    if (!transcript) {
      alert('No transcript returned from audio.');
      return;
    }
    appendTranscriptToEditor(transcript);
  });
}

async function startVoiceRecording() {
  if (voiceState.busy) return;
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
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm')) {
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
      setVoiceUi({ recording: false, busy: false, message: 'Recording error. Try again.' });
      resetVoiceState();
    };
    recorder.onstop = () => {
      handleVoiceRecordingStopped();
    };

    recorder.start();
    voiceState.timeout = setTimeout(() => {
      if (voiceState.recorder && voiceState.recorder.state === 'recording') {
        voiceState.recorder.stop();
      }
    }, VOICE_MAX_DURATION_MS);

    setVoiceUi({ recording: true, busy: false, message: 'Recording... click to stop.' });
  } catch (error) {
    console.error('Unable to start voice input', error);
    setVoiceUi({ recording: false, busy: false, message: 'Microphone access denied.' });
    resetVoiceState();
  }
}

function stopVoiceRecording() {
  if (voiceState.recorder && voiceState.recorder.state === 'recording') {
    voiceState.recorder.stop();
    setVoiceUi({ recording: false, busy: true, message: 'Processing recording...' });
  }
}

function toggleVoiceRecording() {
  if (voiceState.busy) return;
  if (voiceState.recorder && voiceState.recorder.state === 'recording') {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

function QueueBatch(includePrompt) {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").textContent;
  const prompt = includePrompt ? editor.getMarkdown() : null;
  const settings = collectChatSettings();
  socket.emit('chat5-batch', { conversation_id, prompt, includePrompt, settings });
  if (includePrompt) {
    editor.reset();
    updatePromptCharCounter();
  }
}

function UpdateConversation(options = {}) {
  const onComplete = options && typeof options.onComplete === 'function'
    ? options.onComplete
    : null;
  const complete = (ok, response) => {
    if (onComplete) onComplete(ok, response);
  };
  const idEl = document.getElementById("id");
  const conversation_id = idEl.innerHTML;
  if (conversation_id === "NEW") {
    alert('Please create the conversation before updating its settings.');
    complete(false, { message: 'Please create the conversation before updating its settings.' });
    return;
  }
  if (idEl.dataset.source !== 'conversation5') {
    alert('Updating settings is only supported for chat5 conversations.');
    complete(false, { message: 'Updating settings is only supported for chat5 conversations.' });
    return;
  }

  showLoadingPopup();

  const toolSelect = document.getElementById("tools");
  const selectedTools = Array.from(toolSelect.selectedOptions).map(option => option.value);
  const maxMessagesInput = parseInt(document.getElementById("maxMessages").value, 10);
  const startMessageInput = document.getElementById('startMessageId');
  const updates = {
    title: document.getElementById("title").value,
    category: document.getElementById("category").value,
    tags: splitInputList(document.getElementById("tags").value),
    contextPrompt: document.getElementById("context").value,
    model: document.getElementById("model").value,
    reasoning: document.getElementById("reasoning").value,
    mode: document.getElementById("mode").value,
    verbosity: document.getElementById("verbosity").value,
    maxMessages: Number.isNaN(maxMessagesInput) || maxMessagesInput <= 0 ? undefined : maxMessagesInput,
    startMessageId: startMessageInput ? startMessageInput.value.trim() : '',
    tools: selectedTools,
    members: splitInputList(document.getElementById("members").value),
    summary: document.getElementById("summary").value,
  };

  socket.emit('chat5-updateConversation', { conversation_id, updates }, (resp) => {
    hideLoadingPopup();
    if (!resp || resp.ok !== true) {
      alert(resp && resp.message ? resp.message : 'Failed to update conversation.');
      complete(false, resp || { message: 'Failed to update conversation.' });
      return;
    }
    idEl.dataset.source = 'conversation5';
    setUpdateButtonState();
    applyStartMessageIdToUI(resp.conversation?.metadata?.startMessageId);
    complete(true, resp);
  });
}

// Mark pending before FileReader starts: a batch click cannot race the upload.
const hasUnacknowledgedUploads = () => Object.keys(sessionStorage).some(key => key.startsWith('chat5-upload-pending:'));
window.chat5UploadBarrier = { pending: 0, failed: hasUnacknowledgedUploads() };
const announceUploadState = () => window.dispatchEvent(new Event('chat5-upload-state'));
document.getElementById('fileInput').addEventListener('change', async () => {
  const input = document.getElementById('fileInput');
  const files = Array.from(input.files || []);
  if (!files.length) return;
  window.chat5UploadBarrier.pending += files.length;
  window.chat5UploadBarrier.failed = false;
  announceUploadState();
  for (const file of files) {
    try {
      if (file.size > MAX_FILE_SIZE) throw new Error('Image exceeds upload limit.');
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = event => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Unable to read image.')); reader.readAsArrayBuffer(file);
      });
      const conversation_id = document.getElementById('id').textContent.trim();
      let config;
      try { config = await window.localAiBatch?.load(); } catch (_) { /* legacy immediate upload remains available */ }
      // Only opaque recovery metadata, never file/base64 bytes, is stored here.
      const hash = config?.mediaEnabled
        ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBuffer))).map(n => n.toString(16).padStart(2, '0')).join('')
        : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(n => n.toString(16).padStart(2, '0')).join('');
      const recoveryKey = `chat5-upload:${config?.ownerId || 'session'}:${conversation_id}:${hash}`;
      let uploadKey = sessionStorage.getItem(recoveryKey);
      const newConversationKey = sessionStorage.getItem(`chat5-upload:${config?.ownerId || 'session'}:NEW:${hash}`);
      if (!uploadKey && newConversationKey && sessionStorage.getItem(`chat5-upload-pending:${newConversationKey}`)) uploadKey = newConversationKey;
      if (!uploadKey) { uploadKey = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(n => n.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem(recoveryKey, uploadKey); }
      const pendingKey = `chat5-upload-pending:${uploadKey}`;
      sessionStorage.setItem(pendingKey, conversation_id);
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Upload acknowledgement uncertain. Retry the same file.')), 65000);
        socket.emit('chat5-uploadImage', { conversation_id, name: file.name, buffer: arrayBuffer, uploadKey, csrfToken: config?.csrfToken }, reply => {
          clearTimeout(timer); reply?.ok ? resolve(reply) : reject(new Error(reply?.message || 'Upload failed.'));
        });
      });
      if (config?.mediaEnabled && !response.artifact) throw new Error('Image lacks immutable provenance; reupload before batching.');
      sessionStorage.removeItem(pendingKey);
    } catch (error) {
      window.chat5UploadBarrier.failed = true;
      const status = document.getElementById('localAiBatchStatus');
      if (status) status.textContent = error.message;
    } finally { window.chat5UploadBarrier.pending -= 1; announceUploadState(); }
  }
  window.chat5UploadBarrier.failed ||= hasUnacknowledgedUploads();
  if (!window.chat5UploadBarrier.failed) {
    input.value = '';
    document.getElementById('localAiBatchStatus').textContent = 'Image added.';
  }
  announceUploadState();
});

// Edit message array
function EditMessageArray() {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").textContent;
  const newArray = historyInput.value.split(/\s+/).filter(Boolean);
  socket.emit('chat5-editmessagearray-up', {conversation_id, newArray});
}
socket.on('chat5-editmessagearray-done', () => {
  hideLoadingPopup();
  const order = historyInput.value.split(/\s+/).filter(Boolean);
  const container = document.getElementById('conversationContainer');
  const entries = new Map(Array.from(container.querySelectorAll('.chat5-entry'), entry => [entry.dataset.id, entry]));
  const firstLoaded = order.findLastIndex(id => !entries.has(id)) + 1;
  container.replaceChildren();
  appendGroupedEntries(order.slice(firstLoaded).map(id => entries.get(id)), container);
  historyIds.splice(0, historyIds.length, ...order);
  Object.assign(chat5MessageWindow, { loadedStart: firstLoaded, loadedEnd: order.length, total: order.length });
  const training = document.getElementById('chat5TrainingMessageList');
  if (training) {
    const options = new Map(Array.from(training.children, row => [row.dataset.messageId, row]));
    training.replaceChildren(...order.slice(firstLoaded).map(id => options.get(id)).filter(Boolean));
    updateTrainingIndexes();
    updateTrainingFormState();
  }
  updateMessageLoadControls();
  showEmptyHistory();
});

socket.on('chat5-editmessagearray-up:error', (data) => {
  hideLoadingPopup();
  alert(data?.message || 'Unable to update message history.');
});

// Generate title
function GenerateTitle() {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").textContent;
  socket.emit('chat5-generatetitle-up', {conversation_id});
}
socket.on('chat5-generatetitle-done', (data) => {
  document.getElementById("title").value = data.title;
  document.getElementById("conversation_title").textContent = data.title;
  hideLoadingPopup();
});
socket.on('chat5-generatetitle-up:error', (data) => {
  hideLoadingPopup();
  alert(data && data.message ? data.message : 'Unable to generate a title at this time.');
});

// Generate summary
function GenerateSummary() {
  const idEl = document.getElementById("id");
  if (idEl.dataset.source !== 'conversation5') {
    alert('Generating summaries is only supported for chat5 conversations.');
    return;
  }
  showLoadingPopup();
  const conversation_id = idEl.innerHTML;
  socket.emit('chat5-generatesummary-up', { conversation_id });
}
socket.on('chat5-generatesummary-done', (data) => {
  document.getElementById("summary").value = data.summary || '';
  hideLoadingPopup();
});
socket.on('chat5-generatesummary-error', (data) => {
  hideLoadingPopup();
  alert(data && data.message ? data.message : 'Unable to generate summary at this time.');
});

// Handle upload errors
socket.on('chat5-uploadError', (data) => {
  alert(`\nError: ${data.message}`);
});

socket.on('chat5-batch-error', (data) => {
  hideLoadingPopup();
  const message = data && data.message ? data.message : 'Unable to queue batch request.';
  alert(message);
});

socket.on('chat5-messages', ({id, messages, placeholderId} = {}) => {
  if (!id) {
    console.error('chat5-messages payload is missing a conversation id', { id, messages, placeholderId });
    appendRenderErrorMessage(null, new Error('Incoming socket payload is missing a conversation id.'));
    hideLoadingPopup();
    return;
  }

  const followLatest = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
  SwitchConversation(id);
  document.getElementById("conversation_title").textContent = document.getElementById("title").value;
  const idEl = document.getElementById("id");
  if (id !== "NEW") {
    idEl.dataset.source = 'conversation5';
    setUpdateButtonState();
  }
  if (placeholderId) {
    removeMessageFromUI(placeholderId);
  }
  if (!Array.isArray(messages)) {
    console.error('chat5-messages payload has a non-array messages field', { id, messages, placeholderId });
    appendRenderErrorMessage(null, new Error('Incoming socket payload did not include a messages array.'));
    hideLoadingPopup();
    return;
  }
  for (const m of messages) {
    if (m && m.error) {
      console.error('chat5 message payload reported an error', m.error);
      appendRenderErrorMessage(m, new Error(stringifyForDisplay(m.error) || 'Message payload reported an error.'));
      continue;
    }
    try {
      AddMessageToUI(m);
    } catch (error) {
      console.error('Unable to render chat5 message', { error, message: m });
      appendRenderErrorMessage(m, error);
    }
  }
  if (followLatest) thread.scrollTop = thread.scrollHeight;
  hideLoadingPopup();
});

socket.on('chat5-message-hidden', (payload) => {
  const currentId = getCurrentConversationId();
  if (!currentId || !payload || !payload.conversationId) return;
  if (String(payload.conversationId) !== currentId) return;
  if (payload.messageId) {
    applyMessageAction(payload.messageId, 'hide');
  }
});

socket.on('chat5-messages-removed', (payload) => {
  const currentId = getCurrentConversationId();
  if (!currentId || !payload || !payload.conversationId) return;
  if (String(payload.conversationId) !== currentId) return;
  if (Array.isArray(payload.removedIds) && payload.removedIds.length > 0) {
    removeMessagesFromUI(payload.removedIds);
  }
});

socket.on('chat5-message-changed', (payload) => {
  if (payload?.conversationId === getCurrentConversationId()) applyMessageAction(payload.messageId, payload.action);
});

socket.on('chat5-conversation-settings-updated', (data) => {
  const currentId = document.getElementById("id").textContent;
  if (currentId !== data.conversationId) return;

  document.getElementById("conversation_title").textContent = data.title;
  document.getElementById("title").value = data.title;
  document.getElementById("category").value = data.category;
  document.getElementById("tags").value = Array.isArray(data.tags) ? data.tags.join(', ') : '';
  document.getElementById("context").value = data.metadata?.contextPrompt || '';

  const modelSelect = document.getElementById("model");
  if (modelSelect && data.metadata) {
    let option = Array.from(modelSelect.options).find(opt => opt.value === data.metadata.model);
    if (!option && modelSelect.options.length > 0) {
      option = modelSelect.options[0];
      option.value = data.metadata.model;
      option.textContent = `Use previous (${data.metadata.model})`;
    } else if (option && modelSelect.options.length > 0) {
      modelSelect.options[0].value = data.metadata.model;
      modelSelect.options[0].textContent = `Use previous (${data.metadata.model})`;
    }
    modelSelect.value = data.metadata.model;
    syncImageLimits();
    document.getElementById('chat5ModelLabel').textContent = modelSelect.value;
  }

  const reasoningSelect = document.getElementById("reasoning");
  if (reasoningSelect && data.metadata?.reasoning) {
    reasoningSelect.value = data.metadata.reasoning;
  }

  const modeSelect = document.getElementById("mode");
  if (modeSelect) {
    modeSelect.value = data.metadata?.mode || 'standard';
  }

  const verbositySelect = document.getElementById("verbosity");
  if (verbositySelect && data.metadata?.verbosity) {
    verbositySelect.value = data.metadata.verbosity;
  }

  const toolsSelect = document.getElementById("tools");
  if (toolsSelect && data.metadata?.tools) {
    const selectedTools = new Set(data.metadata.tools);
    Array.from(toolsSelect.options).forEach((option) => {
      option.selected = selectedTools.has(option.value);
    });
  }

  if (data.metadata && typeof data.metadata.maxMessages !== 'undefined') {
    document.getElementById("maxMessages").value = data.metadata.maxMessages;
  }
  applyStartMessageIdToUI(data.metadata?.startMessageId || '');

  document.getElementById("members").value = Array.isArray(data.members) ? data.members.join(', ') : '';
  document.getElementById("summary").value = data.summary || '';

  const idEl = document.getElementById("id");
  idEl.dataset.source = 'conversation5';
  setUpdateButtonState();
});

function getMessageSender(m) {
  return stringifyForDisplay(m?.user_id).trim() || 'Unknown';
}

function formatMessageTimestamp(value) {
  if (!value) return 'Unknown';
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return String(value);
  try {
    return dateValue.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch (error) {
    return dateValue.toISOString();
  }
}

function updateHiddenSummary(group) {
  const entries = group.querySelectorAll('.chat5-entry');
  if (!entries.length) { group.remove(); return; }
  group.querySelector('.chat5-hidden-summary-label').textContent = entries.length === 1
    ? '1 hidden message' : `${entries.length} hidden messages`;
  const first = formatMessageTimestamp(entries[0].dataset.time);
  const last = formatMessageTimestamp(entries[entries.length - 1].dataset.time);
  group.querySelector('.chat5-hidden-summary-time').textContent = first === last ? first : `${first} – ${last}`;
}

function appendGroupedEntries(entries, target, open = false) {
  let group;
  for (const entry of entries) {
    if (!entry.querySelector('.chat5-message--hidden')) {
      if (group) updateHiddenSummary(group);
      group = null;
      target.append(entry);
      continue;
    }
    if (!group) {
      group = document.createElement('details');
      group.className = 'chat5-hidden-group';
      // Fixed structure only. Sender, timestamp and content are assigned as text.
      group.innerHTML = '<summary class="chat5-hidden-summary"><span class="chat5-hidden-summary-label"></span><span class="chat5-hidden-summary-time"></span></summary><div class="chat5-hidden-body"></div>';
      group.open = open;
      target.append(group);
    }
    if (entry.querySelector('.chat5-start-divider')) group.open = true;
    group.lastElementChild.append(entry);
  }
  if (group) updateHiddenSummary(group);
}

function setMessageVisibility(entry, hidden) {
  const card = entry.querySelector('.chat5-message');
  if (card.classList.contains('chat5-message--hidden') === hidden) return;
  card.classList.toggle('chat5-message--hidden', hidden);
  card.querySelector('.chat5-hidden-label').hidden = !hidden;
  const button = card.querySelector('[data-chat5-hold]:not([data-chat5-hold="remove"])');
  button.dataset.chat5Hold = hidden ? 'show' : 'hide';
  button.textContent = hidden ? 'Show this message' : 'Hide this message';

  // Only regroup the affected run. Entries keep their own controls, details and order.
  const anchor = entry.closest('.chat5-hidden-group') || entry;
  const run = [anchor];
  if (anchor.previousElementSibling?.matches('.chat5-hidden-group')) run.unshift(anchor.previousElementSibling);
  if (anchor.nextElementSibling?.matches('.chat5-hidden-group')) run.push(anchor.nextElementSibling);
  const marker = document.createComment('');
  run[0].before(marker);
  const entries = run.flatMap(node => node === entry ? [entry] : Array.from(node.querySelectorAll('.chat5-entry')));
  const fragment = document.createDocumentFragment();
  appendGroupedEntries(entries, fragment, run.some(node => node.open));
  run.filter(node => node !== entry).forEach(node => node.remove());
  marker.replaceWith(fragment);
}

function trainingText(m) {
  const content = getMessageContent(m);
  return typeof content.text === 'string' ? content.text.trim() : '';
}

function trainingPreview(m) {
  const text = trainingText(m).replace(/\s+/g, ' ');
  if (text.length <= 220) return text;
  return `${text.slice(0, 217)}...`;
}

function normalizeTrainingUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const promptCount = Number.isFinite(Number(usage.promptCount)) ? Math.max(0, Math.floor(Number(usage.promptCount))) : 0;
  const outputCount = Number.isFinite(Number(usage.outputCount)) ? Math.max(0, Math.floor(Number(usage.outputCount))) : 0;
  if (promptCount === 0 && outputCount === 0) return null;
  return {
    promptCount,
    outputCount,
    entryIds: Array.isArray(usage.entryIds) ? usage.entryIds.map(String).filter(Boolean) : [],
    groupIds: Array.isArray(usage.groupIds) ? usage.groupIds.map(String).filter(Boolean) : [],
  };
}

function getTrainingUsage(messageId) {
  const id = String(messageId || '').trim();
  if (!id || !Object.prototype.hasOwnProperty.call(chat5TrainingUsage, id)) return null;
  return normalizeTrainingUsage(chat5TrainingUsage[id]);
}

function formatTrainingUsageLabel(usage) {
  if (!usage) return '';
  const roles = [];
  if (usage.promptCount > 0) roles.push('prompt');
  if (usage.outputCount > 0) roles.push('output');
  const countText = usage.entryIds.length > 1 ? ` (${usage.entryIds.length} entries)` : '';
  return `In training: ${roles.join(' + ')}${countText}`;
}

function formatTrainingUsageTitle(usage) {
  const label = formatTrainingUsageLabel(usage);
  if (!label) return '';
  const groupText = usage.groupIds.length ? ` Groups: ${usage.groupIds.join(', ')}.` : '';
  return `${label}.${groupText}`;
}

function createTrainingUsageBadge(usage) {
  const badge = document.createElement('span');
  badge.classList.add('chat5-training-usage-badge');
  badge.textContent = formatTrainingUsageLabel(usage);
  badge.title = formatTrainingUsageTitle(usage);
  return badge;
}

function createTrainingMessageOption(m, index) {
  const messageId = getMessageId(m);
  const sender = getMessageSender(m);
  const trainingUsage = getTrainingUsage(messageId);
  const article = document.createElement('article');
  article.classList.add('chat5-training-message-option');
  if (trainingUsage) {
    article.classList.add('chat5-training-message-option--in-training');
    article.dataset.trainingUsage = formatTrainingUsageLabel(trainingUsage);
  }
  if (messageId) article.dataset.messageId = messageId;
  if (Number.isFinite(index)) article.dataset.messageIndex = String(index);

  const selectors = document.createElement('div');
  selectors.classList.add('chat5-training-message-selectors');
  const promptCheck = document.createElement('div');
  promptCheck.classList.add('form-check');
  const promptInput = document.createElement('input');
  promptInput.classList.add('form-check-input');
  promptInput.type = 'checkbox';
  promptInput.id = `trainingPrompt-${messageId}`;
  promptInput.name = 'prompt_message_ids';
  promptInput.value = messageId;
  const promptLabel = document.createElement('label');
  promptLabel.classList.add('form-check-label');
  promptLabel.setAttribute('for', promptInput.id);
  promptLabel.textContent = 'Prompt';
  promptCheck.append(promptInput, promptLabel);

  const outputCheck = document.createElement('div');
  outputCheck.classList.add('form-check');
  const outputInput = document.createElement('input');
  outputInput.classList.add('form-check-input');
  outputInput.type = 'radio';
  outputInput.id = `trainingOutput-${messageId}`;
  outputInput.name = 'output_message_id';
  outputInput.value = messageId;
  const outputLabel = document.createElement('label');
  outputLabel.classList.add('form-check-label');
  outputLabel.setAttribute('for', outputInput.id);
  outputLabel.textContent = 'Output';
  outputCheck.append(outputInput, outputLabel);
  selectors.append(promptCheck, outputCheck);

  const preview = document.createElement('div');
  preview.classList.add('chat5-training-message-preview');
  const header = document.createElement('div');
  header.classList.add('d-flex', 'flex-wrap', 'gap-2', 'align-items-center');
  const strong = document.createElement('strong');
  strong.textContent = Number.isFinite(index) ? `#${index} ${sender}` : sender;
  const code = document.createElement('code');
  code.textContent = messageId;
  header.append(strong, code);
  if (trainingUsage) {
    header.append(createTrainingUsageBadge(trainingUsage));
  }
  const p = document.createElement('p');
  p.classList.add('mb-0');
  p.textContent = trainingPreview(m);
  preview.append(header, p);

  article.append(selectors, preview);
  return article;
}

function updateTrainingFormState() {
  const list = document.getElementById('chat5TrainingMessageList');
  const empty = document.getElementById('chat5TrainingEmpty');
  const submit = document.getElementById('chat5TrainingSubmit');
  const groupSelect = document.getElementById('trainingGroupId');
  const count = list ? list.querySelectorAll('.chat5-training-message-option').length : 0;
  if (empty) {
    empty.classList.toggle('d-none', count > 0);
  }
  if (submit) {
    submit.disabled = !groupSelect?.value || count < 2;
  }
}

// Follow the existing training form redirect but refresh only the dialog. Keep the
// live thread, older message selections and editor instance in this document.
function bindTrainingForms() {
  const dialog = document.getElementById('chat5Training');
  const status = document.getElementById('chat5TrainingStatus');
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    if (dialog.hasAttribute('aria-busy')) return;
    const form = event.target;
    dialog.setAttribute('aria-busy', 'true');
    status.className = 'text-muted';
    status.textContent = 'Saving…';
    try {
      const response = await fetch(form.action, {
        method: 'POST', body: new URLSearchParams(new FormData(form)), credentials: 'same-origin',
      });
      const url = new URL(response.url);
      if (!response.ok || url.origin !== location.origin || url.pathname !== `/chat5/chat/${getCurrentConversationId()}`) {
        throw new Error();
      }
      if (url.searchParams.has('training_error')) {
        status.className = 'text-danger';
        status.textContent = url.searchParams.get('training_error');
        return;
      }
      const result = new DOMParser().parseFromString(await response.text(), 'text/html');
      const entries = result.querySelector('#chat5TrainingContent > #chat5TrainingEntries');
      const groups = result.getElementById('trainingGroupId');
      if (!entries || !groups || !url.searchParams.has('training_success')) throw new Error();

      chat5TrainingUsage = JSON.parse(entries.dataset.usage);
      document.getElementById('chat5TrainingEntries').replaceWith(entries);
      document.getElementById('trainingGroupId').replaceWith(groups);
      if (form.matches('.chat5-training-form')) form.reset();
      dialog.querySelectorAll('.chat5-training-message-option').forEach(row => {
        const usage = getTrainingUsage(row.dataset.messageId);
        row.classList.toggle('chat5-training-message-option--in-training', !!usage);
        row.querySelector('.chat5-training-usage-badge')?.remove();
        if (usage) row.querySelector('.chat5-training-message-preview strong').parentElement.append(createTrainingUsageBadge(usage));
      });
      updateTrainingFormState();
      status.className = 'text-success';
      status.textContent = url.searchParams.get('training_success');
    } catch {
      status.className = 'text-danger';
      status.textContent = 'Could not confirm the training change. Check the saved entries before retrying.';
    } finally {
      dialog.removeAttribute('aria-busy');
      status.scrollIntoView({ block: 'nearest' });
    }
  });
}

function appendTrainingMessages(messages, { prepend = false, startIndex = 0 } = {}) {
  const list = document.getElementById('chat5TrainingMessageList');
  if (!list || !Array.isArray(messages)) return;
  const fragment = document.createDocumentFragment();
  messages.forEach((m, offset) => {
    const messageId = getMessageId(m);
    if (!messageId || trainingText(m).length === 0) return;
    if (list.querySelector(`.chat5-training-message-option[data-message-id="${messageId}"]`)) return;
    fragment.append(createTrainingMessageOption(m, startIndex + offset));
  });
  if (prepend) {
    list.prepend(fragment);
  } else {
    list.append(fragment);
  }
  updateTrainingFormState();
}

function prependLoadedMessages(messages, startIndex) {
  if (!messages.length) return;
  const container = document.getElementById('conversationContainer');
  document.getElementById('chat5EmptyMessages')?.remove();
  const fragment = document.createDocumentFragment();
  appendGroupedEntries(messages.map(createMessageElement), fragment);
  const anchor = container.firstElementChild;
  const top = anchor?.getBoundingClientRect().top;
  container.prepend(fragment);
  if (anchor) thread.scrollTop += anchor.getBoundingClientRect().top - top;
  appendTrainingMessages(messages, { prepend: true, startIndex });
}

function AddMessageToUI(m) {
  const id = getMessageId(m);
  if (id && messageEntries(id).length) return;
  document.getElementById('chat5EmptyMessages')?.remove();
  const container = document.getElementById('conversationContainer');
  appendGroupedEntries([createMessageElement(m)], container);
  appendTrainingMessages([m], { startIndex: chat5MessageWindow.loadedEnd });
  if (addHistoryId(id)) registerLiveMessageInWindow(id);
}

function showEmptyHistory() {
  const container = document.getElementById('conversationContainer');
  if (historyIds.length || container.querySelector('.chat5-entry, #chat5EmptyMessages')) return;
  const notice = document.createElement('p');
  notice.id = 'chat5EmptyMessages';
  notice.className = 'text-muted';
  notice.textContent = 'No messages yet.';
  container.append(notice);
}

function updateTrainingIndexes() {
  const indexes = new Map(historyIds.map((id, index) => [id, index]));
  document.querySelectorAll('.chat5-training-message-option').forEach(row => {
    const index = indexes.get(row.dataset.messageId);
    if (index === undefined) return;
    row.dataset.messageIndex = index;
    const label = row.querySelector('strong');
    label.textContent = label.textContent.replace(/^#\d+ /, `#${index} `);
  });
}

function removeMessageFromUI(messageId) {
  if (!messageId) return;
  messageEntries(messageId).forEach(entry => {
    const group = entry.closest('.chat5-hidden-group');
    entry.remove();
    if (group) updateHiddenSummary(group);
  });
  document.querySelectorAll(`.chat5-training-message-option[data-message-id="${CSS.escape(messageId)}"]`)
    .forEach(row => row.remove());
  if (messageId === savedStartMessageId) applyStartMessageIdToUI('');
  const removedBeforeWindow = historyIds.slice(0, chat5MessageWindow.loadedStart).filter(id => id === messageId).length;
  const remaining = historyIds.filter(id => id !== messageId);
  const removed = historyIds.length - remaining.length;
  if (removed) {
    historyIds.splice(0, historyIds.length, ...remaining);
    historyInput.value = historyInput.value.split('\n').filter(line => line.trim() !== messageId).join('\n');
    chat5MessageWindow.total = Math.max(0, chat5MessageWindow.total - removed);
    chat5MessageWindow.loadedStart = Math.max(0, chat5MessageWindow.loadedStart - removedBeforeWindow);
    chat5MessageWindow.loadedEnd = Math.max(chat5MessageWindow.loadedStart, chat5MessageWindow.loadedEnd - removed);
    updateMessageLoadControls();
    updateTrainingIndexes();
  }
  updateTrainingFormState();
  showEmptyHistory();
}

function removeMessagesFromUI(messageIds) {
  messageIds.forEach(removeMessageFromUI);
}

function createMessageFrame(m) {
  const entry = document.getElementById('chat5MessageFrame').content.firstElementChild.cloneNode(true);
  const messageId = getMessageId(m);
  const sender = getMessageSender(m);
  entry.dataset.id = messageId;
  entry.dataset.time = m.timestamp || '';
  entry.dataset.category = m.category || '';
  entry.dataset.tags = Array.isArray(m.tags) ? m.tags.join(', ') : '';
  entry.dataset.type = m.contentType || '';
  const fields = JSON.parse(entry.dataset.fields);
  for (const key of Object.keys(fields)) fields[key] = stringifyForDisplay(m.content?.[key]);
  entry.dataset.fields = JSON.stringify(fields);
  const card = entry.querySelector('.chat5-message');
  if (sender.toUpperCase() === 'BOT') {
    card.classList.add('chat5-message--bot');
    const avatar = document.createElement('img');
    avatar.className = 'chat5-avatar';
    avatar.src = '/i/avatar.jpg';
    avatar.alt = '';
    card.querySelector('header').prepend(avatar);
  }
  if (m.content?.imageProcessingNotice) {
    const notice = document.createElement('small');
    notice.textContent = m.content.imageProcessingNotice;
    card.querySelector('.chat5-message-actions').before(notice);
  }
  entry.querySelector('.chat5-sender').textContent = sender;
  entry.querySelector('time').textContent = formatMessageTimestamp(m.timestamp);
  const copy = entry.querySelector('.chat5-copy-button');
  const copyText = resolveMessageCopySource(m);
  copy.hidden = !copyText;
  if (copyText) bindMessageCopyButton(copy, copyText);
  const start = entry.querySelector('[data-chat5-start-message-id]');
  start.dataset.chat5StartMessageId = messageId;
  card.classList.toggle('chat5-message--hidden', !!m.hideFromBot);
  entry.querySelector('.chat5-hidden-label').hidden = !m.hideFromBot;
  const visibility = entry.querySelector('[data-chat5-hold="hide"]');
  if (m.hideFromBot) {
    visibility.dataset.chat5Hold = 'show';
    visibility.textContent = 'Show this message';
  }
  const disabled = !messageId || workspace.dataset.canEdit !== 'true' || chat5MessageWindow.source !== 'conversation5';
  entry.querySelectorAll('[data-chat5-hold], [data-chat5-start-message-id]').forEach(button => { button.disabled = disabled; });
  if (messageId && savedStartMessageId === messageId) setStartMarker(entry, true);
  return entry;
}

function createMessageElement(m) {
  const entry = createMessageFrame(m);
  renderMessageBody(entry.querySelector('.chat5-message-body'), m);
  return entry;
}

function renderMessageBody(body, m) {
  const content = getMessageContent(m);
  const messageLabel = describeMessageForError(m);
  if (m.contentType === "text") {
    const textBlock = document.createElement('div');
    textBlock.classList.add('chat5-message-text');
    textBlock.id = `${m._id}textout`;
    textBlock.innerHTML = (typeof content.html === 'string' && content.html.trim().length > 0)
      ? sanitizeDisplayHtml(content.html)
      : parseMarkdownSafely(content.text, messageLabel);
    if (textBlock.innerHTML.trim().length === 0) {
      appendMessageProblem(
        textBlock,
        'Empty text message received.',
        `${messageLabel}. content.text is empty, null, or missing.`
      );
    }
    body.append(textBlock);
  }
  if (m.contentType === "image") {
    const imageName = stringifyForDisplay(content.image).trim();
    if (imageName) {
      const img = document.createElement("img");
      img.classList.add('chat5-message-image');
      img.src = `/img/${imageName}`;
      img.alt = stringifyForDisplay(content.revisedPrompt);
      const caption = document.createElement("p");
      caption.classList.add('chat5-image-caption');
      const italics = document.createElement("i");
      italics.innerText = stringifyForDisplay(content.revisedPrompt);
      caption.append(italics);
      body.append(img, caption);
    } else {
      appendMessageProblem(
        body,
        'Image message is missing a file name.',
        `${messageLabel}. content.image is empty, null, or missing.`
      );
    }
  }
  if (m.contentType === "tool") {
    const div = document.createElement("div");
    div.classList.add('chat5-message-tool');
    const toolOutput = stringifyForDisplay(content.toolOutput);
    if (toolOutput.trim().length > 0) {
      const italics = document.createElement("i");
      italics.innerText = toolOutput;
      div.append(italics);
    } else {
      appendMessageProblem(
        div,
        'Empty tool message received.',
        `${messageLabel}. content.toolOutput is empty, null, or missing.`
      );
    }
    body.append(div);
  }
  if (m.contentType === "reasoning") {
    const div = document.createElement("div");
    div.classList.add('chat5-message-reasoning');
    const renderedReasoning = (typeof content.html === 'string' && content.html.trim().length > 0)
      ? sanitizeDisplayHtml(content.html)
      : parseMarkdownSafely(content.text, messageLabel);
    if (renderedReasoning.trim().length > 0) {
      const italics = document.createElement("i");
      italics.innerHTML = renderedReasoning;
      div.append(italics);
    } else {
      appendMessageProblem(
        div,
        'Empty reasoning message received.',
        `${messageLabel}. The API response did not include reasoning summary text.`
      );
    }
    body.append(div);
  }
  if (m.contentType === "function_call" || m.contentType === "function_call_output") {
    const jsonText = stringifyStructuredMessagePayload(m);
    if (jsonText) {
      const pre = document.createElement('pre');
      pre.classList.add('chat5-message-json');
      const code = document.createElement('code');
      code.classList.add('language-json');
      code.textContent = jsonText;
      pre.append(code);
      body.append(pre);
    } else {
      appendMessageProblem(
        body,
        `Unable to display ${m.contentType} message.`,
        `${messageLabel}. No structured payload could be built from the message content.`
      );
    }
  }
  if (m.contentType === "audio") {
    const wrapper = document.createElement('div');
    wrapper.classList.add('chat5-message-audio');
    const fileName = stringifyForDisplay(content.audio || content.tts).trim();
    if (fileName) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.classList.add('chat5-message-audio-player');
      audio.src = `/mp3/${fileName}`;
      wrapper.append(audio);
    }
    const transcript = stringifyForDisplay(content.transcript || content.text);
    if (transcript.trim().length > 0) {
      const p = document.createElement('p');
      p.classList.add('chat5-audio-transcript');
      p.innerText = transcript;
      wrapper.append(p);
    }
    if (!fileName && transcript.trim().length === 0) {
      appendMessageProblem(
        wrapper,
        'Empty audio message received.',
        `${messageLabel}. No audio file or transcript is present.`
      );
    }
    body.append(wrapper);
  }
  if (![
    "text",
    "image",
    "tool",
    "reasoning",
    "function_call",
    "function_call_output",
    "audio"
  ].includes(m.contentType)) {
    appendMessageProblem(
      body,
      'Unsupported message type received.',
      `${messageLabel}. contentType "${stringifyForDisplay(m.contentType) || 'missing'}" is not handled by the browser renderer.`
    );
  }

  registerCodeCopyHandlers(body);
  enhanceTables(body);
}

const loadingPopup = document.getElementById("loadingPopup");

// Function to show the loading popup
function showLoadingPopup() {
  loadingPopup.style.display = 'block';
}

// Function to hide the loading popup
function hideLoadingPopup() {
  loadingPopup.style.display = 'none';
}

function applyMessageAction(messageId, action) {
  if (!messageId) return;
  if (action === 'start') applyStartMessageIdToUI(messageId);
  else if (action === 'remove') removeMessageFromUI(messageId);
  else if (action === 'hide' || action === 'show') {
    messageEntries(messageId).forEach(entry => setMessageVisibility(entry, action === 'hide'));
  }
}

async function changeMessage(button, action) {
  const entry = button.closest('.chat5-entry');
  if (!entry || button.disabled || entry.hasAttribute('aria-busy')) return;
  if (action === 'start' && entry.dataset.id === savedStartMessageId) return;
  const hadFocus = entry.contains(document.activeElement);
  const neighbor = entry.nextElementSibling || entry.previousElementSibling;
  const conversationId = getCurrentConversationId();
  const messageId = entry.dataset.id;
  const status = document.getElementById('chat5ActionStatus');
  entry.setAttribute('aria-busy', 'true');
  status.textContent = '';
  try {
    const response = await fetch(`/chat5/chat/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/${action}`, {
      method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-Token': workspace.dataset.csrf },
      credentials: 'same-origin', redirect: 'error',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Unable to change this message. Check your access and try again.');
    }
    const saved = await response.json();
    if (saved.conversationId !== conversationId || saved.messageId !== messageId || saved.action !== action) {
      throw new Error('Could not confirm the message change. Reload to check its current state.');
    }
    if (getCurrentConversationId() !== conversationId) return;
    applyMessageAction(messageId, action);
    if (hadFocus && document.activeElement === document.body) {
      const group = entry.closest('.chat5-hidden-group:not([open])');
      const focusTarget = group?.querySelector('summary') || (button.isConnected ? button : null)
        || neighbor?.querySelector('summary, .chat5-inspect') || document.getElementById('chat5ComposerToggle');
      focusTarget.focus({ preventScroll: true });
    }
    status.textContent = {
      start: 'Start message set.', hide: 'Message hidden from the model.',
      show: 'Message shown to the model.', remove: 'Message removed from this conversation.',
    }[action];
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? 'Could not confirm the message change. Check your connection and reload.' : error.message;
  } finally {
    entry.removeAttribute('aria-busy');
  }
}

function bindHoldActions(container) {
  let hold;
  function cancel() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.button.classList.remove('is-holding');
    hold = null;
  }
  function begin(button, gesture) {
    cancel();
    if (!button || button.disabled || button.closest('[aria-busy="true"]')) return;
    const action = button.dataset.chat5Hold;
    button.classList.add('is-holding');
    hold = { ...gesture, button, scrollTop: thread.scrollTop, timer: setTimeout(() => {
      cancel();
      if (button.isConnected && button.dataset.chat5Hold === action) changeMessage(button, action);
    }, 700) };
  }
  container.addEventListener('pointerdown', event => {
    if (event.button === 0 && event.isPrimary !== false) {
      begin(event.target.closest('[data-chat5-hold]'), { pointer: event.pointerId, x: event.clientX, y: event.clientY });
    }
  });
  container.addEventListener('pointermove', event => {
    if (hold && event.pointerId === hold.pointer && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) cancel();
  });
  container.addEventListener('pointerout', event => {
    if (hold && event.pointerId === hold.pointer && !hold.button.contains(event.relatedTarget)) cancel();
  });
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
  container.addEventListener('lostpointercapture', cancel);
  container.addEventListener('contextmenu', event => {
    if (event.target.closest('[data-chat5-hold]')) event.preventDefault();
  });
  container.addEventListener('keydown', event => {
    const button = event.target.closest('[data-chat5-hold]');
    if (!button || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) begin(button, { key: event.key });
  });
  window.addEventListener('keyup', event => { if (hold?.key === event.key) cancel(); });
  container.addEventListener('focusout', event => { if (event.target === hold?.button) cancel(); });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', cancel);
  thread.addEventListener('scroll', () => {
    if (hold && !hold.key && thread.scrollTop !== hold.scrollTop) cancel();
  }, { passive: true });
}

function initializeMessageDetails() {
  const dialog = document.getElementById('chat5MessageDetails');
  const field = document.getElementById('chat5DetailField');
  const value = document.getElementById('chat5DetailValue');
  const save = document.getElementById('chat5SaveField');
  const status = document.getElementById('chat5DetailStatus');
  const editable = ['text', 'transcript', 'tts', 'revisedPrompt', 'toolOutput'];
  let entry;
  let pending;

  function showField() {
    value.value = JSON.parse(entry.dataset.fields)[field.value];
    value.readOnly = !editable.includes(field.value) || chat5MessageWindow.source !== 'conversation5';
    save.disabled = value.readOnly || !!pending;
    status.textContent = value.readOnly ? 'Read-only field.' : '';
  }
  dialog.addEventListener('show.bs.modal', event => {
    entry = event.relatedTarget.closest('.chat5-entry');
    const { id, type, category, tags } = entry.dataset;
    const list = document.getElementById('chat5DetailMetadata');
    list.replaceChildren();
    for (const [term, description] of Object.entries({
      ID: id, Sender: entry.querySelector('.chat5-sender').textContent, Type: type, Category: category, Tags: tags,
    })) {
      const label = document.createElement('dt');
      const text = document.createElement('dd');
      label.textContent = term;
      text.textContent = description || '—';
      list.append(label, text);
    }
    field.value = ({ image: 'revisedPrompt', audio: 'transcript', tool: 'toolOutput' })[type] || 'text';
    showField();
  });
  field.addEventListener('change', showField);
  save.addEventListener('click', () => {
    if (save.disabled || !entry?.isConnected) return;
    pending = { entry, type: field.value, value: value.value };
    save.disabled = true;
    status.textContent = 'Saving…';
    socket.emit('chat5-edittext-up', { message_id: entry.dataset.id, type: pending.type, value: pending.value });
  });

  socket.on('chat5-edittext-done', (data = {}) => {
    if (!pending || data.messageId !== pending.entry.dataset.id || data.type !== pending.type) return;
    const updated = pending.entry;
    const fields = JSON.parse(updated.dataset.fields);
    fields[data.type] = pending.value;
    updated.dataset.fields = JSON.stringify(fields);
    const textOutput = updated.querySelector('.chat5-message-text, .chat5-message-reasoning');
    if (data.type === 'text' && textOutput && typeof data.html === 'string') {
      textOutput.innerHTML = sanitizeDisplayHtml(data.html);
      registerCodeCopyHandlers(textOutput);
      enhanceTables(textOutput);
    }
    if (['audio', 'image', 'tool'].includes(updated.dataset.type)) {
      const body = updated.querySelector('.chat5-message-body');
      body.replaceChildren();
      renderMessageBody(body, { _id: data.messageId, user_id: updated.querySelector('.chat5-sender').textContent,
        contentType: updated.dataset.type, content: fields });
    }
    const copy = updated.querySelector('.chat5-copy-button');
    const copyText = fields.text || fields.transcript || fields.revisedPrompt || fields.toolOutput;
    if (!updated.dataset.type.startsWith('function_call')) {
      copy.hidden = !copyText;
      copy.dataset.copyText = copyText;
      if (copyText) bindMessageCopyButton(copy, copyText);
    }
    pending = null;
    save.disabled = value.readOnly;
    if (entry === updated && field.value === data.type) status.textContent = 'Field saved.';
  });
  function editFailed() {
    if (!pending) return;
    pending = null;
    save.disabled = value.readOnly;
    status.textContent = 'Could not confirm the edit. Reload to check the saved field.';
  }
  socket.on('chat5-edittext-up:error', editFailed);
  socket.on('disconnect', editFailed);
}

function bindChatControls() {
  const container = document.getElementById('conversationContainer');
  container.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.matches('[data-chat5-start-message-id]')) changeMessage(button, 'start');
  });
  bindHoldActions(container);
  bindTrainingForms();
  initializeMessageDetails();

  const toggle = document.getElementById('chat5ComposerToggle');
  const composerBody = document.getElementById('chat5ComposerBody');
  function expandComposer(expand) {
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 5;
    composerBody.hidden = !expand;
    toggle.setAttribute('aria-expanded', String(expand));
    document.getElementById('chat5ToggleLabel').textContent = expand ? 'Minimize editor' : 'Write a message';
    if (atEnd) thread.scrollTop = thread.scrollHeight;
  }
  if (window.matchMedia?.('(max-width: 640px)').matches && getCurrentConversationId() !== 'NEW') expandComposer(false);
  toggle.addEventListener('click', () => {
    const expand = composerBody.hidden;
    expandComposer(expand);
    if (expand) editor.focus();
  });
  const viewport = window.visualViewport;
  if (viewport) {
    // Mobile keyboards can shrink the visual viewport while leaving the layout viewport full height.
    const resize = () => {
      if (viewport.scale !== 1) return;
      workspace.style.setProperty('--chat5-keyboard', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
      workspace.style.setProperty('--chat5-visible-height', `${viewport.height}px`);
      workspace.classList.toggle('chat5-short', viewport.height < 520);
    };
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    resize();
  }
  document.getElementById('chat5AddImage').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('chat5UpdateHistory').addEventListener('click', EditMessageArray);
  const settings = document.getElementById('chat5Settings');
  document.getElementById('updateSettingsButton').addEventListener('click', () => UpdateConversation({
    onComplete(ok) { if (ok) bootstrap.Modal.getInstance(settings)?.hide(); },
  }));
  thread.scrollTop = thread.scrollHeight;
}

function initializeDraftingTool() {
  const personalitySelect = document.getElementById('draftPersonalitySelect');
  const responseSelect = document.getElementById('draftResponseTypeSelect');
  const notesInput = document.getElementById('draftNotes');
  const draftButton = document.getElementById('draftPromptButton');
  const conversationLabel = document.getElementById('id');

  if (!personalitySelect || !responseSelect || !draftButton || !conversationLabel) {
    return;
  }

  const restoreSelectValue = (selectEl, storedValue) => {
    if (!selectEl || !storedValue) return;
    const exists = Array.from(selectEl.options).some((option) => option.value === storedValue);
    if (exists) {
      selectEl.value = storedValue;
    }
  };

  restoreSelectValue(personalitySelect, loadDraftPreference(draftStorageKeys.personality));
  restoreSelectValue(responseSelect, loadDraftPreference(draftStorageKeys.responseType));

  personalitySelect.addEventListener('change', (event) => {
    saveDraftPreference(draftStorageKeys.personality, event.target.value || '');
  });
  responseSelect.addEventListener('change', (event) => {
    saveDraftPreference(draftStorageKeys.responseType, event.target.value || '');
  });

  let draftInFlight = false;
  const defaultButtonText = draftButton.textContent;

  const setDraftButtonState = (busy) => {
    draftButton.disabled = busy;
    draftButton.textContent = busy ? 'Drafting...' : (defaultButtonText || 'Draft prompt');
  };

  draftButton.addEventListener('click', () => {
    if (draftInFlight) return;

    const conversationId = conversationLabel.innerHTML ? conversationLabel.innerHTML.trim() : '';
    if (!conversationId || conversationId === 'NEW') {
      alert('Please open an existing conversation before drafting a response.');
      return;
    }

    const personalityId = personalitySelect.value;
    const responseTypeId = responseSelect.value;
    if (!personalityId || !responseTypeId) {
      alert('Please select both a personality and a response type before drafting.');
      return;
    }

    draftInFlight = true;
    setDraftButtonState(true);
    showLoadingPopup();

    if (!socket || typeof socket.emit !== 'function') {
      alert('Socket connection is not available.');
      draftInFlight = false;
      setDraftButtonState(false);
      hideLoadingPopup();
      return;
    }

    const payload = {
      conversationId,
      personalityId,
      responseTypeId,
      notes: notesInput ? notesInput.value.trim() : '',
    };

    socket.emit('chat5-draftprompt', payload, (resp) => {
      draftInFlight = false;
      setDraftButtonState(false);
      hideLoadingPopup();
      if (!resp || resp.ok !== true) {
        const message = resp && resp.message ? resp.message : 'Unable to generate draft at this time.';
        alert(message);
        return;
      }
      const draftText = typeof resp.prompt === 'string' ? resp.prompt : '';
      if (window.editor && typeof window.editor.setMarkdown === 'function') {
        window.editor.setMarkdown(draftText);
      }
    });
  });
}

socket.on('welcome', () => {
  if (document.getElementById("id").textContent != "NEW") {
    const conversation_id = document.getElementById("id").textContent;
    socket.emit('chat5-joinConversation', {conversationId: conversation_id});
  }
});

function syncImageLimits() {
  const selected = document.getElementById('model')?.value === 'qwen3.8:27b-vllm';
  document.querySelectorAll('[data-vllm-image-limits]').forEach(notice => { notice.hidden = !selected; });
}
document.getElementById('model')?.addEventListener('change', syncImageLimits);
syncImageLimits();

document.addEventListener('DOMContentLoaded', setUpdateButtonState);
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('conversationContainer');
  initializeMessageCopyButtons(container);
  registerCodeCopyHandlers(container);
  enhanceTables(container);
  bindMessageLoadControls();
  bindChatControls();
  updateTrainingFormState();
});
document.addEventListener('DOMContentLoaded', initializeDraftingTool);
document.addEventListener('DOMContentLoaded', () => {
  const ttsBtn = document.getElementById('generateTtsBtn');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', GenerateTTS);
  }
  if (ttsVoiceSelect) {
    ttsVoiceSelect.addEventListener('change', updatePromptCharCounter);
  }
  updatePromptCharCounter();
});
document.addEventListener('DOMContentLoaded', () => {
  if (voiceButton) {
    voiceButton.addEventListener('click', toggleVoiceRecording);
  }
});


// Set action button
const actionBtn = document.getElementById("actionBtn");
let currentEvent = null;
function setActionButton(text, func) {
  actionBtn.innerText = text;
  actionBtn.style.cursor = "pointer";
  actionBtn.disabled = false;
  if (currentEvent) {
    actionBtn.removeEventListener("click", currentEvent)
  }
  actionBtn.addEventListener("click", func);
  currentEvent = func;
}
setActionButton("Chat Top", Chat5Top);

function Chat5Top() {
  open("/chat5/top", "_self");
}
