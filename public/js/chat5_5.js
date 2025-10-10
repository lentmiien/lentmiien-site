// Create a socket connection
const socket = io();

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Setup markdown editor
const editor = new toastui.Editor({
  el: document.querySelector('#message'),
  height: '500px',
  initialEditType: 'markdown',
  // previewStyle: 'vertical',
  // theme: 'dark',
});
// Make accessible to inline scripts
window.editor = editor;

function splitInputList(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function setUpdateButtonState() {
  const idEl = document.getElementById('id');
  const btn = document.getElementById('updateSettingsButton');
  if (!idEl || !btn) return;
  btn.disabled = idEl.dataset.source !== 'conversation5';
}

function SwitchConversation(new_id) {
  if (document.getElementById("id").innerHTML === new_id) return;

  if (document.getElementById("id").innerHTML != "NEW") {
    const conversation_id = document.getElementById("id").innerHTML;
    socket.emit('chat5-leaveConversation', {conversationId: conversation_id});
  }
  socket.emit('chat5-joinConversation', {conversationId: new_id});
  document.getElementById("id").innerHTML = new_id;
}

function Append(send, resp) {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  const prompt = editor.getMarkdown();
  // Get settings
  const tool_select = document.getElementById("tools");
  const tool_array = Array.from(tool_select.selectedOptions).map(option => option.value);
  const tags = splitInputList(document.getElementById("tags").value);
  const members = splitInputList(document.getElementById("members").value);
  const maxMessagesInput = parseInt(document.getElementById("maxMessages").value, 10);
  const maxMessages = Number.isNaN(maxMessagesInput) || maxMessagesInput <= 0 ? 999 : maxMessagesInput;
  const settings = {
    title: document.getElementById("title").value,
    category: document.getElementById("category").value,
    tags,
    context: document.getElementById("context").value,
    tools: tool_array,
    model: document.getElementById("model").value,
    reasoning: document.getElementById("reasoning").value,
    verbosity: document.getElementById("verbosity").value,
    members,
    maxMessages,
  };
  socket.emit('chat5-append', {conversation_id, prompt: send ? prompt : null, response: resp, settings});
  if (send) editor.reset();
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

socket.on('chat5-messages', ({id, messages}) => {
  SwitchConversation(id);
  document.getElementById("conversation_title").innerHTML = document.getElementById("title").value;
  const idEl = document.getElementById("id");
  if (id !== "NEW") {
    idEl.dataset.source = 'conversation5';
    setUpdateButtonState();
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

function message(m) {
  const msg_div = document.createElement('div');
  if (m.hideFromBot) msg_div.classList.add("bg-secondary");
  if (m.contentType === "text") {
    const span = document.createElement("span");
    span.id = `${m._id}textout`;
    span.innerHTML = marked.parse(m.content.text);
    msg_div.append(span);
  }
  if (m.contentType === "image") {
    const img = document.createElement("img");
    img.src = `/img/${m.content.image}`;
    img.alt = m.content.revisedPrompt;
    img.style.maxHeight = "200px";
    const p = document.createElement("p");
    const i = document.createElement("i");
    i.innerText = m.content.revisedPrompt;
    p.append(i);
    msg_div.append(img, p);
  }
  if (m.contentType === "tool") {
    const div = document.createElement("div");
    const i = document.createElement("i");
    i.innerText = m.content.toolOutput;
    div.append(i);
    msg_div.append(div);
  }
  if (m.contentType === "reasoning") {
    const div = document.createElement("div");
    const i = document.createElement("i");
    i.innerText = marked.parse(m.content.text);
    div.append(i);
    msg_div.append(div);
  }
  document.getElementById("conversationContainer").append(msg_div);
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

socket.on('welcome', () => {
  if (document.getElementById("id").innerHTML != "NEW") {
    const conversation_id = document.getElementById("id").innerHTML;
    socket.emit('chat5-joinConversation', {conversationId: conversation_id});
  }
});

document.addEventListener('DOMContentLoaded', setUpdateButtonState);
