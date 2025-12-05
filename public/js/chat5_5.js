// Create a socket connection
const socket = io();

const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

function resolveMessageCopySource(m) {
  if (!m || typeof m !== 'object') return '';
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

function SwitchConversation(new_id) {
  if (document.getElementById("id").innerHTML === new_id) return;

  if (document.getElementById("id").innerHTML != "NEW") {
    const conversation_id = document.getElementById("id").innerHTML;
    socket.emit('chat5-leaveConversation', {conversationId: conversation_id});
  }
  socket.emit('chat5-joinConversation', {conversationId: new_id});
  document.getElementById("id").innerHTML = new_id;
  updateBatchButtons();
}

function Append(send, resp) {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  const prompt = editor.getMarkdown();
  const settings = collectChatSettings();
  socket.emit('chat5-append', {conversation_id, prompt: send ? prompt : null, response: resp, settings});
  if (send) editor.reset();
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

socket.on('chat5-messages', ({id, messages, placeholderId}) => {
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
  for (const m of messages) {
    if (m.error) {
      console.log(m.error);
    } else {
      AddMessageToUI(m);
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

function AddMessageToUI(m) {
  const ul = document.getElementsByClassName("userlabel");
  if (ul.length > 0 && ul[ul.length-1].dataset.user === m.user_id) {
    // Simply append message
    message(m);
  } else {
    // Create new userlabel
    const hr = document.createElement("hr");
    const div = document.createElement("div");
    div.classList.add("userlabel");
    div.dataset.user = m.user_id;
    const b = document.createElement("b");
    b.innerText = m.user_id;
    div.append(b);
    document.getElementById("conversationContainer").append(hr, div);
    // Append message
    message(m);
  }
  // Add raw data
  const pre = document.createElement("pre");
  pre.innerText = JSON.stringify(m, null, 2);
  document.getElementById("pills-raw").append(pre);
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

function message(m) {
  const container = document.getElementById("conversationContainer");
  if (!container) return;

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

  const copyText = resolveMessageCopySource(m);
  if (copyText) {
    const copyBtn = createMessageCopyButton(copyText);
    messageWrapper.appendChild(copyBtn);
  }

  if (m.contentType === "text") {
    const span = document.createElement("span");
    span.classList.add('chat5-message-text');
    span.id = `${m._id}textout`;
    span.innerHTML = marked.parse(m.content.text);
    body.append(span);
  }
  if (m.contentType === "image") {
    const img = document.createElement("img");
    img.classList.add('chat5-message-image');
    img.src = `/img/${m.content.image}`;
    img.alt = m.content.revisedPrompt;
    const caption = document.createElement("p");
    caption.classList.add('chat5-image-caption');
    const italics = document.createElement("i");
    italics.innerText = m.content.revisedPrompt;
    caption.append(italics);
    body.append(img, caption);
  }
  if (m.contentType === "tool") {
    const div = document.createElement("div");
    div.classList.add('chat5-message-tool');
    const italics = document.createElement("i");
    italics.innerText = m.content.toolOutput;
    div.append(italics);
    body.append(div);
  }
  if (m.contentType === "reasoning") {
    const div = document.createElement("div");
    div.classList.add('chat5-message-reasoning');
    const italics = document.createElement("i");
    italics.innerHTML = marked.parse(m.content.text);
    div.append(italics);
    body.append(div);
  }

  messageWrapper.appendChild(body);
  container.append(messageWrapper);
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
    document.getElementById(`${data.message_id}textout`).innerHTML = marked.parse(data.value);
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
  registerCodeCopyHandlers(container);
  enhanceTables(container);
});
document.addEventListener('DOMContentLoaded', initializeDraftingTool);


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
