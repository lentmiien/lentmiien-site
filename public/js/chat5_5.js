// Create a socket connection
const socket = io();

// Setup markdown editor
const editor = new toastui.Editor({
  el: document.querySelector('#message'),
  height: '500px',
  initialEditType: 'markdown',
  // previewStyle: 'vertical',
  // theme: 'dark',
});

function Append() {
  const conversation_id = document.getElementById("id").innerHTML;
  const prompt = editor.getMarkdown();
  socket.emit('chat5-append', {conversation_id, prompt});
  editor.reset();
}

socket.on('chat5-messages', ({id, messages}) => {
  document.getElementById("id").innerHTML = id;
  for (const m of messages) {
    AddMessageToUI(m);
  }
});

function AddMessageToUI(m) {
  const ul = document.getElementsByClassName("userlabel");
  if (ul[ul.length-1].dataset.user === m.user_id) {
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
    const br = document.createElement("br");
    const i = document.createElement("i");
    i.innerText = m.content.revisedPrompt;
    document.getElementById("conversationContainer").append(img, br, i);
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
