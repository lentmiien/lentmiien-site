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

function Append(send, resp) {
  showLoadingPopup();
  const conversation_id = document.getElementById("id").innerHTML;
  const prompt = editor.getMarkdown();
  // Get settings
  const tool_select = document.getElementById("tools");
  const tool_array = Array.from(tool_select.selectedOptions).map(option => option.value);
  const settings = {
    title: document.getElementById("title").value,
    category: document.getElementById("category").value,
    tags: document.getElementById("tags").value.split(", ").join(",").split(","),
    context: document.getElementById("context").value,
    tools: tool_array,
    model: document.getElementById("model").value,
    reasoning: document.getElementById("reasoning").value,
    verbosity: document.getElementById("verbosity").value,
    members: document.getElementById("members").value.split(", ").join(",").split(","),
  };
  socket.emit('chat5-append', {conversation_id, prompt: send ? prompt : null, response: resp, settings});
  if (send) editor.reset();
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

// Handle upload errors
socket.on('chat5-uploadError', (data) => {
  alert(`\nError: ${data.message}`);
});

socket.on('chat5-messages', ({id, messages}) => {
  document.getElementById("id").innerHTML = id;
  document.getElementById("conversation_title").innerHTML = document.getElementById("title").value;
  for (const m of messages) {
    AddMessageToUI(m);
  }
  hideLoadingPopup();
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

// function UpdateLoad() {
//   socket.emit('loadConversations', {category: load_category.value, tags: load_tags.value, keyword: load_keyword.value});
// }

// socket.on('displayConversations', conversation_array => {
//   
// });

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
