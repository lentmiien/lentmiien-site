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
  height: '500px',
  initialEditType: 'markdown',
  // previewStyle: 'vertical',
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
const chat5TrainingUsage = window.chat5TrainingUsage && typeof window.chat5TrainingUsage === 'object'
  ? window.chat5TrainingUsage
  : {};

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
  const voiceId = getVoiceIdValue();
  const voiceNote = voiceId ? ` · voice ${voiceId}` : '';
  charCounterEl.textContent = `${length} chars${voiceNote}`;
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
    copyTextToClipboard(text)
      .then(() => setCopyFeedback(btn, 'copied'))
      .catch((err) => {
        console.warn('Unable to copy message text to clipboard', err);
        setCopyFeedback(btn, 'failed');
      });
  });
}

function createMessageCopyButton(text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('chat5-copy-button');
  btn.setAttribute('aria-label', 'Copy message text');
  btn.textContent = 'Copy';
  bindMessageCopyButton(btn, text);
  return btn;
}

function initializeMessageCopyButtons(root) {
  const scope = root || document;
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const buttons = scope.querySelectorAll('.chat5-copy-button');
  if (!buttons.length) return;
  buttons.forEach((btn) => bindMessageCopyButton(btn));
}

function bindEmbedButton(btn) {
  if (!btn || btn.dataset.embedBound === 'true') return;
  const messageId = btn.getAttribute('data-message-id') || '';
  const presetConversationId = btn.getAttribute('data-conversation-id') || '';
  if (!messageId) return;

  const defaultLabel = btn.textContent || 'Embed HQ';
  btn.dataset.embedBound = 'true';

  btn.addEventListener('click', () => {
    if (btn.dataset.embedBusy === 'true') return;
    const conversationId = (btn.dataset.conversationId || presetConversationId || getCurrentConversationId() || '').trim();
    if (!conversationId || conversationId === 'NEW') {
      alert('Please open an existing conversation before embedding this message.');
      return;
    }

    btn.dataset.embedBusy = 'true';
    btn.disabled = true;
    btn.textContent = 'Embedding...';
    socket.emit('chat5-embed-hq', { conversation_id: conversationId, message_id: messageId }, (resp) => {
      if (!resp || resp.ok !== true) {
        btn.textContent = 'Retry';
        btn.disabled = false;
        delete btn.dataset.embedBusy;
        alert(resp && resp.message ? resp.message : 'Unable to embed this message.');
        return;
      }
      btn.textContent = 'Embedded';
      setTimeout(() => {
        btn.textContent = defaultLabel;
        btn.disabled = false;
        delete btn.dataset.embedBusy;
      }, 1200);
    });
  });
}

function createEmbedButton({ conversationId, messageId }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('chat5-embed-button');
  btn.setAttribute('aria-label', 'Embed message (high quality)');
  if (messageId) btn.setAttribute('data-message-id', messageId);
  if (conversationId) btn.setAttribute('data-conversation-id', conversationId);
  btn.textContent = 'Embed HQ';
  bindEmbedButton(btn);
  return btn;
}

function initializeEmbedButtons(root) {
  const scope = root || document;
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const buttons = scope.querySelectorAll('.chat5-embed-button');
  if (!buttons.length) return;
  buttons.forEach((btn) => bindEmbedButton(btn));
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

function parseMarkdownSafely(value, contextLabel) {
  const source = stringifyForDisplay(value);
  if (source.trim().length === 0) return '';
  if (!window.marked || typeof window.marked.parse !== 'function') {
    throw new Error('Markdown renderer is not available.');
  }
  try {
    return window.marked.parse(source);
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

  const messageWrapper = document.createElement('div');
  messageWrapper.classList.add('chat5-message', 'chat5-message--render-error');
  if (m && m._id) {
    messageWrapper.dataset.id = m._id;
  }

  const body = document.createElement('div');
  body.classList.add('chat5-message-body');
  appendMessageProblem(
    body,
    'Unable to render one live message.',
    `${describeMessageForError(m)}. ${error && error.message ? error.message : String(error || 'Unknown rendering error')}. Check the Raw tab for the payload.`
  );

  messageWrapper.append(body);
  container.append(messageWrapper);
}

function getMessageId(m) {
  return stringifyForDisplay(m && (m._id || m.id)).trim();
}

function getMessageContent(m) {
  return m && m.content && typeof m.content === 'object' ? m.content : {};
}

function appendLabeledValue(parent, label, value) {
  const row = document.createElement('div');
  const bold = document.createElement('b');
  bold.textContent = `${label}: `;
  const span = document.createElement('span');
  span.textContent = stringifyForDisplay(value);
  row.append(bold, span);
  parent.append(row);
}

function createRawContentRow(messageId, content, type) {
  const row = document.createElement('div');
  const label = document.createElement('b');
  label.textContent = `${type}: `;

  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('btn', 'btn-link');
  button.dataset.id = messageId;
  button.dataset.type = type;
  button.dataset.content = stringifyForDisplay(content[type]);
  button.textContent = 'Edit';
  button.addEventListener('click', () => EditText(button));
  label.append(button);

  const pre = document.createElement('pre');
  pre.id = `${messageId}${type}`;
  pre.textContent = stringifyForDisplay(content[type]);

  row.append(label, pre);
  return row;
}

function createRawMessageElement(m, index) {
  const messageId = getMessageId(m);
  const wrapper = document.createElement('div');
  wrapper.classList.add('chat5-raw-message');
  if (messageId) wrapper.dataset.messageId = messageId;
  if (Number.isFinite(index)) wrapper.dataset.messageIndex = String(index);

  const title = document.createElement('h3');
  title.textContent = Number.isFinite(index) ? `Message#${index}` : 'Message';
  wrapper.append(title);

  const row = document.createElement('div');
  row.classList.add('row');
  const metaCol = document.createElement('div');
  metaCol.classList.add('col-3');
  const contentCol = document.createElement('div');
  contentCol.classList.add('col-9');

  appendLabeledValue(metaCol, '_id', messageId);
  appendLabeledValue(metaCol, 'user_id', m && m.user_id);
  appendLabeledValue(metaCol, 'category', m && m.category);
  appendLabeledValue(metaCol, 'tags', Array.isArray(m && m.tags) ? m.tags.join(', ') : '');
  appendLabeledValue(metaCol, 'contentType', m && m.contentType);

  const hiddenRow = document.createElement('div');
  const hiddenLabel = document.createElement('b');
  hiddenLabel.textContent = 'Hide from bot: ';
  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'checkbox';
  hiddenInput.dataset.id = messageId;
  hiddenInput.checked = !!(m && m.hideFromBot);
  hiddenInput.addEventListener('change', () => ToggleHideFromBot(hiddenInput));
  hiddenRow.append(hiddenLabel, hiddenInput);
  metaCol.append(hiddenRow);

  const contentTitle = document.createElement('h4');
  contentTitle.textContent = 'Content';
  contentCol.append(contentTitle);
  const content = getMessageContent(m);
  ['text', 'image', 'audio', 'tts', 'transcript', 'revisedPrompt', 'imageQuality', 'toolOutput'].forEach((type) => {
    contentCol.append(createRawContentRow(messageId, content, type));
  });

  row.append(metaCol, contentCol);
  wrapper.append(row);
  return wrapper;
}

function appendRawMessageToUI(m, { prepend = false, index } = {}) {
  const rawList = document.getElementById('chat5RawMessageList');
  const rawPane = document.getElementById("pills-raw");
  const target = rawList || rawPane;
  if (!target) return;
  const messageId = getMessageId(m);
  if (messageId && target.querySelector(`.chat5-raw-message[data-message-id="${messageId}"]`)) {
    return;
  }
  const card = createRawMessageElement(m, index);
  if (prepend) {
    target.prepend(card);
  } else {
    target.append(card);
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
    verbosity: verbosity ? verbosity.value : 'medium',
    members,
    maxMessages: Number.isNaN(maxMessagesInput) || maxMessagesInput <= 0 ? 999 : maxMessagesInput,
  };
}

function getSelectedModel() {
  const modelSelect = document.getElementById('model');
  return modelSelect ? modelSelect.value : '';
}

function isBatchModelSelected() {
  const selected = getSelectedModel();
  if (!selected || !Array.isArray(chatModels)) return false;
  return chatModels.some((model) => model.api_model === selected && model.batch_use);
}

function updateBatchButtons() {
  const enabled = isBatchModelSelected();
  ['batchSendResponse', 'batchResponse'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !enabled;
  });
}

function setUpdateButtonState() {
  const idEl = document.getElementById('id');
  const btn = document.getElementById('updateSettingsButton');
  if (!idEl || !btn) return;
  btn.disabled = idEl.dataset.source !== 'conversation5';
}

function getCurrentConversationId() {
  const idEl = document.getElementById('id');
  if (!idEl) return '';
  return (idEl.innerHTML || '').trim();
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
  document.querySelectorAll('[data-chat5-load-status]').forEach((status) => {
    status.textContent = statusText;
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

function appendMessageIdToHistory(messageId) {
  const id = stringifyForDisplay(messageId).trim();
  if (!id) return;
  const history = document.getElementById('message_history');
  if (!history) return;
  const existing = splitInputList((history.value || '').replace(/\n/g, ','));
  if (existing.indexOf(id) >= 0) return;
  history.value = history.value && history.value.trim().length > 0
    ? `${history.value.trim()}\n${id}`
    : id;
}

function removeMessageIdFromHistory(messageId) {
  const id = stringifyForDisplay(messageId).trim();
  if (!id) return;
  const history = document.getElementById('message_history');
  if (!history) return;
  const next = (history.value || '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== id);
  history.value = next.join('\n');
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
  if (document.getElementById("id").innerHTML === new_id) return;

  if (document.getElementById("id").innerHTML != "NEW") {
    const conversation_id = document.getElementById("id").innerHTML;
    socket.emit('chat5-leaveConversation', {conversationId: conversation_id});
  }
  socket.emit('chat5-joinConversation', {conversationId: new_id});
  document.getElementById("id").innerHTML = new_id;
  chat5MessageWindow.source = 'conversation5';
  updateBatchButtons();
  updateMessageLoadControls();
}

function Append(send, resp, userId) {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  const prompt = editor.getMarkdown();
  const settings = collectChatSettings();
  const payload = {conversation_id, prompt: send ? prompt : null, response: resp, settings};
  if (typeof userId === 'string' && userId.trim().length > 0) {
    payload.user_id = userId.trim();
  }
  socket.emit('chat5-append', payload);
  if (send) {
    editor.reset();
    updatePromptCharCounter();
  }
}

function GenerateTTS() {
  const conversation_id = document.getElementById("id").innerHTML;
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
  if (!isBatchModelSelected()) {
    alert('Selected model does not support batch processing.');
    return;
  }

  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  const prompt = includePrompt ? editor.getMarkdown() : null;
  const settings = collectChatSettings();
  socket.emit('chat5-batch', { conversation_id, prompt, includePrompt, settings });
  if (includePrompt) editor.reset();
}

function HideLastMessage() {
  const conversationId = requireExistingConversation('hide messages');
  if (!conversationId) return;

  showLoadingPopup();
  socket.emit('chat5-hidelastmessage', { conversation_id: conversationId }, (resp) => {
    hideLoadingPopup();
    if (!resp || resp.ok !== true || !resp.messageId) {
      alert(resp && resp.message ? resp.message : 'Unable to hide the last visible message.');
      return;
    }
    markMessageHiddenInUI(resp.messageId);
  });
}

function RemoveLastMessage() {
  const conversationId = requireExistingConversation('remove messages');
  if (!conversationId) return;

  showLoadingPopup();
  socket.emit('chat5-removelastmessage', { conversation_id: conversationId }, (resp) => {
    hideLoadingPopup();
    if (!resp || resp.ok !== true || !Array.isArray(resp.removedIds) || resp.removedIds.length === 0) {
      alert(resp && resp.message ? resp.message : 'Unable to remove the last visible message.');
      return;
    }
    removeMessagesFromUI(resp.removedIds);
  });
}

function UpdateConversation() {
  const idEl = document.getElementById("id");
  const conversation_id = idEl.innerHTML;
  if (conversation_id === "NEW") {
    alert('Please create the conversation before updating its settings.');
    return;
  }
  if (idEl.dataset.source !== 'conversation5') {
    alert('Updating settings is only supported for chat5 conversations.');
    return;
  }

  showLoadingPopup();

  const toolSelect = document.getElementById("tools");
  const selectedTools = Array.from(toolSelect.selectedOptions).map(option => option.value);
  const maxMessagesInput = parseInt(document.getElementById("maxMessages").value, 10);
  const updates = {
    title: document.getElementById("title").value,
    category: document.getElementById("category").value,
    tags: splitInputList(document.getElementById("tags").value),
    contextPrompt: document.getElementById("context").value,
    model: document.getElementById("model").value,
    reasoning: document.getElementById("reasoning").value,
    verbosity: document.getElementById("verbosity").value,
    maxMessages: Number.isNaN(maxMessagesInput) || maxMessagesInput <= 0 ? undefined : maxMessagesInput,
    tools: selectedTools,
    members: splitInputList(document.getElementById("members").value),
    summary: document.getElementById("summary").value,
  };

  socket.emit('chat5-updateConversation', { conversation_id, updates }, (resp) => {
    hideLoadingPopup();
    if (!resp || resp.ok !== true) {
      alert(resp && resp.message ? resp.message : 'Failed to update conversation.');
      return;
    }
    idEl.dataset.source = 'conversation5';
    setUpdateButtonState();
  });
}

document.getElementById("fileInput").addEventListener('change', () => {
  const files = document.getElementById("fileInput").files;
  if (files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.size > MAX_FILE_SIZE) continue;

    const reader = new FileReader();

    reader.onload = (event) => {
      const conversation_id = document.getElementById("id").innerHTML;
      const arrayBuffer = event.target.result;
      socket.emit('chat5-uploadImage', {
        conversation_id,
        name: file.name,
        buffer: arrayBuffer
      });
    };

    reader.onerror = () => {
      console.error('Error reading file:', file.name);
    };

    reader.readAsArrayBuffer(file);
  }
});

// Edit message array
function EditMessageArray() {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  const newArray = document.getElementById("message_history").value.split('\n');
  socket.emit('chat5-editmessagearray-up', {conversation_id, newArray});
}
socket.on('chat5-editmessagearray-done', () => {
  hideLoadingPopup();
});

// Toggle hide from bot
function ToggleHideFromBot(e) {
  showLoadingPopup();
  const message_id = e.dataset.id;
  const state = e.checked;
  socket.emit('chat5-togglehidefrombot-up', {message_id, state});
}
socket.on('chat5-togglehidefrombot-done', () => {
  hideLoadingPopup();
});

// Generate title
function GenerateTitle() {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  socket.emit('chat5-generatetitle-up', {conversation_id});
}
socket.on('chat5-generatetitle-done', (data) => {
  document.getElementById("title").value = data.title;
  document.getElementById("conversation_title").innerHTML = data.title;
  hideLoadingPopup();
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

  SwitchConversation(id);
  document.getElementById("conversation_title").innerHTML = document.getElementById("title").value;
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
      appendRawMessageToUI(m);
      continue;
    }
    try {
      AddMessageToUI(m);
    } catch (error) {
      console.error('Unable to render chat5 message', { error, message: m });
      appendRenderErrorMessage(m, error);
      appendRawMessageToUI(m);
    }
  }
  hideLoadingPopup();
});

socket.on('chat5-message-hidden', (payload) => {
  const currentId = getCurrentConversationId();
  if (!currentId || !payload || !payload.conversationId) return;
  if (String(payload.conversationId) !== currentId) return;
  if (payload.messageId) {
    markMessageHiddenInUI(payload.messageId);
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

socket.on('chat5-conversation-settings-updated', (data) => {
  const currentId = document.getElementById("id").innerHTML;
  if (currentId !== data.conversationId) return;

  document.getElementById("conversation_title").innerHTML = data.title;
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
  }

  const reasoningSelect = document.getElementById("reasoning");
  if (reasoningSelect && data.metadata?.reasoning) {
    reasoningSelect.value = data.metadata.reasoning;
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

  document.getElementById("members").value = Array.isArray(data.members) ? data.members.join(', ') : '';
  document.getElementById("summary").value = data.summary || '';

  const idEl = document.getElementById("id");
  idEl.dataset.source = 'conversation5';
  setUpdateButtonState();
});

function getMessageSender(m) {
  return stringifyForDisplay(m && m.user_id).trim() || 'Unknown';
}

function createUserLabelNodes(sender) {
  const hr = document.createElement('hr');
  hr.classList.add('chat5-divider');
  const div = document.createElement('div');
  div.classList.add('userlabel', 'chat5-user-label');
  div.dataset.user = sender;
  const b = document.createElement('b');
  b.innerText = sender;
  div.append(b);
  return [hr, div];
}

function getLastRenderedUser() {
  const labels = document.querySelectorAll('#conversationContainer .userlabel');
  if (!labels.length) return null;
  return labels[labels.length - 1].dataset.user || null;
}

function appendUserLabelIfNeeded(target, sender, state) {
  if (!target || !state) return;
  if (state.lastUser === sender) return;
  const nodes = createUserLabelNodes(sender);
  target.append(...nodes);
  state.lastUser = sender;
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

function createHiddenMessageGroup(group, state) {
  const details = document.createElement('details');
  details.classList.add('chat5-hidden-group');
  const firstHidden = group[0];
  const lastHidden = group[group.length - 1];
  const firstTime = formatMessageTimestamp(firstHidden && firstHidden.timestamp);
  const lastTime = formatMessageTimestamp(lastHidden && lastHidden.timestamp);
  const timeRange = firstTime === lastTime ? firstTime : `${firstTime} - ${lastTime}`;

  const summary = document.createElement('summary');
  summary.classList.add('chat5-hidden-summary');
  const label = document.createElement('span');
  label.classList.add('chat5-hidden-summary-label');
  label.textContent = group.length === 1 ? '1 hidden message' : `${group.length} hidden messages`;
  const time = document.createElement('span');
  time.classList.add('chat5-hidden-summary-time');
  time.textContent = timeRange;
  summary.append(label, time);

  const body = document.createElement('div');
  body.classList.add('chat5-hidden-body');
  group.forEach((msg) => appendSingleMessageToTarget(msg, body, state));
  details.append(summary, body);
  return details;
}

function appendSingleMessageToTarget(m, target, state) {
  if (!m || typeof m !== 'object') {
    throw new Error('Message payload is not an object.');
  }
  const sender = getMessageSender(m);
  appendUserLabelIfNeeded(target, sender, state);
  const element = createMessageElement(m);
  target.append(element);
  registerCodeCopyHandlers(element);
  enhanceTables(element);
}

function appendMessageListToTarget(messages, target, state) {
  if (!Array.isArray(messages) || !target) return;
  let hiddenBuffer = [];
  messages.forEach((msg, index) => {
    if (msg && msg.hideFromBot) {
      hiddenBuffer.push(msg);
      const next = messages[index + 1];
      if (!(next && next.hideFromBot)) {
        target.append(createHiddenMessageGroup(hiddenBuffer, state));
        hiddenBuffer = [];
      }
      return;
    }
    if (hiddenBuffer.length > 0) {
      target.append(createHiddenMessageGroup(hiddenBuffer, state));
      hiddenBuffer = [];
    }
    appendSingleMessageToTarget(msg, target, state);
  });
  if (hiddenBuffer.length > 0) {
    target.append(createHiddenMessageGroup(hiddenBuffer, state));
  }
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
    submit.disabled = !groupSelect || groupSelect.disabled || count < 2;
  }
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
  if (!Array.isArray(messages) || messages.length === 0) return;
  const container = document.getElementById('conversationContainer');
  if (!container) return;

  const empty = document.getElementById('chat5EmptyMessages');
  if (empty) empty.remove();

  const anchor = container.firstElementChild;
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : null;
  const fragment = document.createDocumentFragment();
  appendMessageListToTarget(messages, fragment, { lastUser: null });
  container.prepend(fragment);
  if (anchor && anchorTop !== null) {
    const nextTop = anchor.getBoundingClientRect().top;
    window.scrollBy(0, nextTop - anchorTop);
  }

  appendTrainingMessages(messages, { prepend: true, startIndex });
  const rawList = document.getElementById('chat5RawMessageList');
  if (rawList) {
    const rawFragment = document.createDocumentFragment();
    messages.forEach((m, offset) => {
      const messageId = getMessageId(m);
      if (!messageId || rawList.querySelector(`.chat5-raw-message[data-message-id="${messageId}"]`)) return;
      rawFragment.append(createRawMessageElement(m, startIndex + offset));
    });
    rawList.prepend(rawFragment);
  }
}

function AddMessageToUI(m) {
  if (!m || typeof m !== 'object') {
    throw new Error('Message payload is not an object.');
  }
  const container = document.getElementById('conversationContainer');
  if (!container) return;
  const empty = document.getElementById('chat5EmptyMessages');
  if (empty) empty.remove();

  const fragment = document.createDocumentFragment();
  appendMessageListToTarget([m], fragment, { lastUser: getLastRenderedUser() });
  container.append(fragment);
  appendRawMessageToUI(m, { index: chat5MessageWindow.loadedEnd });
  appendTrainingMessages([m], { prepend: false, startIndex: chat5MessageWindow.loadedEnd });
  appendMessageIdToHistory(getMessageId(m));
  registerLiveMessageInWindow(getMessageId(m));
}

function removeMessageFromUI(messageId) {
  if (!messageId) return;
  const container = document.getElementById('conversationContainer');
  if (container) {
    const element = container.querySelector(`.chat5-message[data-id="${messageId}"]`);
    if (element) {
      const hiddenBody = element.closest('.chat5-hidden-body');
      element.remove();
      if (hiddenBody && hiddenBody.querySelectorAll('.chat5-message').length === 0) {
        const hiddenGroup = hiddenBody.closest('.chat5-hidden-group');
        if (hiddenGroup) {
          hiddenGroup.remove();
        }
      }
    }
  }
  const rawEntry = document.querySelector(`.chat5-raw-message[data-message-id="${messageId}"]`);
  if (rawEntry) {
    rawEntry.remove();
  }
  const trainingEntry = document.querySelector(`.chat5-training-message-option[data-message-id="${messageId}"]`);
  if (trainingEntry) {
    trainingEntry.remove();
    updateTrainingFormState();
  }
  removeMessageIdFromHistory(messageId);
  if (chat5MessageWindow.source === 'conversation5' && chat5MessageWindow.total > 0) {
    chat5MessageWindow.total -= 1;
    chat5MessageWindow.loadedEnd = Math.max(chat5MessageWindow.loadedStart, chat5MessageWindow.loadedEnd - 1);
    updateMessageLoadControls();
  }
}

function removeMessagesFromUI(messageIds) {
  if (!Array.isArray(messageIds)) return;
  messageIds.forEach((id) => removeMessageFromUI(id));
}

function setRawMessageHiddenState(messageId, hidden) {
  const rawEntry = document.querySelector(`.chat5-raw-message[data-message-id="${messageId}"]`);
  if (!rawEntry) return;
  const checkbox = rawEntry.querySelector(`input[type="checkbox"][data-id="${messageId}"]`);
  if (checkbox) {
    checkbox.checked = !!hidden;
  }
}

function markMessageHiddenInUI(messageId) {
  if (!messageId) return;
  const container = document.getElementById('conversationContainer');
  if (container) {
    const element = container.querySelector(`.chat5-message[data-id="${messageId}"]`);
    if (element) {
      element.classList.add('chat5-message--hidden');
    }
  }
  setRawMessageHiddenState(messageId, true);
}

function createMessageElement(m) {
  if (!m || typeof m !== 'object') {
    throw new Error('Message payload is not an object.');
  }
  const content = m.content && typeof m.content === 'object' ? m.content : {};
  const messageLabel = describeMessageForError(m);

  const messageWrapper = document.createElement('div');
  messageWrapper.classList.add('chat5-message');
  if (m._id) {
    messageWrapper.dataset.id = m._id;
  }
  if (m.hideFromBot) {
    messageWrapper.classList.add('chat5-message--hidden');
  }
  const isBot = typeof m.user_id === 'string' && m.user_id.toUpperCase() === 'BOT';
  if (isBot) {
    messageWrapper.classList.add('chat5-message--bot');
    const avatar = document.createElement('img');
    avatar.classList.add('chat5-avatar');
    avatar.src = '/i/avatar.jpg';
    avatar.alt = 'Bot avatar';
    messageWrapper.appendChild(avatar);
  }

  const body = document.createElement('div');
  body.classList.add('chat5-message-body');

  const actions = document.createElement('div');
  actions.classList.add('chat5-message-actions');

  const copyText = resolveMessageCopySource(m);
  if (copyText) {
    const copyBtn = createMessageCopyButton(copyText);
    actions.appendChild(copyBtn);
  }
  if (m.contentType === "text" && m._id) {
    const embedBtn = createEmbedButton({ conversationId: getCurrentConversationId(), messageId: m._id });
    actions.appendChild(embedBtn);
  }
  if (actions.children.length > 0) {
    messageWrapper.appendChild(actions);
  }

  if (m.contentType === "text") {
    const textBlock = document.createElement('div');
    textBlock.classList.add('chat5-message-text');
    textBlock.id = `${m._id}textout`;
    textBlock.innerHTML = (typeof content.html === 'string' && content.html.trim().length > 0)
      ? content.html
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
      ? content.html
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

  messageWrapper.appendChild(body);
  return messageWrapper;
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

const myModal = new bootstrap.Modal(document.getElementById('editTextModal'));

function EditText(e) {
  document.getElementById("text_to_edit_id").value = e.dataset.id;
  document.getElementById("text_to_edit_type").value = e.dataset.type;
  document.getElementById("text_to_edit").value = e.dataset.content;
  myModal.show();
}

function SaveText() {
  const data = {
    message_id: document.getElementById("text_to_edit_id").value,
    type: document.getElementById("text_to_edit_type").value,
    value: document.getElementById("text_to_edit").value,
  };
  socket.emit('chat5-edittext-up', data);
  document.getElementById(`${data.message_id}${data.type}`).innerHTML = data.value;
  if (data.type === "text") {
    document.getElementById(`${data.message_id}textout`).innerHTML = parseMarkdownSafely(data.value, `edited message ${data.message_id}`);
  }
  myModal.hide();
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
  if (document.getElementById("id").innerHTML != "NEW") {
    const conversation_id = document.getElementById("id").innerHTML;
    socket.emit('chat5-joinConversation', {conversationId: conversation_id});
  }
});

document.addEventListener('DOMContentLoaded', setUpdateButtonState);
document.addEventListener('DOMContentLoaded', () => {
  const modelSelect = document.getElementById('model');
  if (modelSelect) {
    modelSelect.addEventListener('change', updateBatchButtons);
  }
  updateBatchButtons();
});
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('conversationContainer');
  initializeMessageCopyButtons(container);
  initializeEmbedButtons(container);
  registerCodeCopyHandlers(container);
  enhanceTables(container);
  bindMessageLoadControls();
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
