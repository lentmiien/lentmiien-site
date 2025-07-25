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
  socket.emit('chat5-append', {conversation_id, prompt: send ? prompt : null, response: resp});
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

// Handle upload errors
socket.on('chat5-uploadError', (data) => {
  alert(`\nError: ${data.message}`);
});

socket.on('chat5-messages', ({id, messages}) => {
  document.getElementById("id").innerHTML = id;
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
  if (m.contentType === "text") {
    const span = document.createElement("span");
    span.innerHTML = marked.parse(m.content.text);
    document.getElementById("conversationContainer").append(span);
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
    document.getElementById("conversationContainer").append(img, p);
  }
  if (m.contentType === "tool") {
    const div = document.createElement("div");
    const i = document.createElement("i");
    i.innerText = m.content.toolOutput;
    div.append(i);
    document.getElementById("conversationContainer").append(div);
  }
  if (m.contentType === "reasoning") {
    const div = document.createElement("div");
    const i = document.createElement("i");
    i.innerText = marked.parse(m.content.text);
    div.append(i);
    document.getElementById("conversationContainer").append(div);
  }
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
