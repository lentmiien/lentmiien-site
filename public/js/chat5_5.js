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

// Handle upload errors
socket.on('chat5-uploadError', (data) => {
  alert(`\nError: ${data.message}`);
});

socket.on('chat5-messages', ({id, messages}) => {
  SwitchConversation(id);
  document.getElementById("conversation_title").innerHTML = document.getElementById("title").value;
  for (const m of messages) {
    if (m.error) {
      console.log(m.error);
    } else {
      AddMessageToUI(m);
    }
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

// socket.on('chat5-notice', (data) => {
//   console.log(`A new message was posted to "${data.title}" (${data.id})`);
// });

(function setupChat5Notices() {
  let stylesInjected = false;

  function ensureStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const css = `
      #chat-notice-container {
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(92vw, 600px);
        z-index: 11000; /* above your modal 9999 */
        pointer-events: none; /* container ignores clicks; notices handle their own */
      }
      .chat-notice {
        background: #1f2937; /* slate-800 */
        color: #fff;
        border-radius: 8px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.25);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity .2s ease, transform .2s ease;
        pointer-events: auto; /* clickable */
      }
      .chat-notice a.chat-notice-link {
        color: #fff;
        text-decoration: underline;
        font-weight: 600;
      }
      .chat-notice .chat-notice-title {
        margin-right: 6px;
      }
      .chat-notice button.chat-notice-close {
        background: transparent;
        border: 0;
        color: #fff;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
    `;
    const style = document.createElement('style');
    style.id = 'chat-notice-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureContainer() {
    let c = document.getElementById('chat-notice-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'chat-notice-container';
      c.setAttribute('aria-live', 'polite'); // screen readers will announce politely
      document.body.appendChild(c);
    }
    return c;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeNotice(el) {
    if (!el) return;
    clearTimeout(el._timer);
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 200);
  }

  function showNotice({ id, title }) {
    // 1) Ignore if we’re already viewing this conversation
    const currentId = document.getElementById('id')?.textContent?.trim();
    if (String(id) === String(currentId)) return;

    ensureStyles();
    const container = ensureContainer();

    // 2) De-duplicate: if a notice for this id already exists, move it to top and reset timer
    const selectorSafeId = CSS && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/("|'|\\)/g, '\\$1');
    let existing = container.querySelector(`.chat-notice[data-id="${selectorSafeId}"]`);
    if (existing) {
      if (container.firstChild !== existing) container.prepend(existing);
      clearTimeout(existing._timer);
      existing._timer = setTimeout(() => removeNotice(existing), 5000);
      return;
    }

    // 3) Create notice
    const el = document.createElement('div');
    el.className = 'chat-notice';
    el.dataset.id = String(id);

    const safeTitle = escapeHtml(title || '(untitled)');
    const href = `/chat5/chat/${encodeURIComponent(String(id))}`;

    el.innerHTML = `
      <div class="chat-notice-body">
        <span class="chat-notice-title">${safeTitle}</span>
        <a class="chat-notice-link" href="${href}">Open</a>
      </div>
      <button class="chat-notice-close" aria-label="Dismiss">&times;</button>
    `;

    // Close button
    el.querySelector('.chat-notice-close')?.addEventListener('click', () => removeNotice(el));

    // Optional: clicking anywhere on the notice (except the close) opens the link
    el.addEventListener('click', (e) => {
      const isClose = (e.target.closest('.chat-notice-close') !== null);
      const isLink = (e.target.closest('a.chat-notice-link') !== null);
      if (!isClose && !isLink) {
        window.location.href = href;
      }
    });

    // 4) Insert at top and animate in
    container.prepend(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

    // 5) Auto-hide after 5s
    el._timer = setTimeout(() => removeNotice(el), 5000);
  }

  // Hook up the socket event
  if (window.socket) {
    window.socket.on('chat5-notice', showNotice);
  } else {
    // If your socket is created elsewhere, you can call window.__chat5_showNotice later
    window.__chat5_showNotice = showNotice;
  }
})();
